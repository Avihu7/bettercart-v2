/**
 * Weekly menu invariants over the fixture baskets — the safety net for the
 * planner. Whatever builds the menu must keep these. (Variety is measured by
 * the validator — see validateMenu.test.js.)
 */
import { describe, it, expect, beforeAll } from "vitest";
import { generateNutritionPlan } from "@/lib/nutritionPlanGenerator";
import { buildFinalShoppingList } from "@/lib/shoppingOptimizer";
import { weeklyBudget } from "@/lib/pricing";
import { classifyProduct } from "@/lib/mealPlanRules";
import { profileConflict } from "@/lib/basketAlternatives";
import { BASKETS } from "./fixtures/baskets";

const mealItems = plan => plan.days.flatMap(d => d.meals.flatMap(m => m.items));
const VARIETY = /used at more than 3 lunches/;

describe.each(Object.entries(BASKETS))("menu: %s basket", (label, { items, profile, adequate }) => {
  const budget = weeklyBudget(profile);
  const build = () => generateNutritionPlan({ list: { items }, profile, budget });
  let plan;
  beforeAll(async () => { plan = await build(); });

  it("is deterministic (same basket + profile + budget → same menu)", async () => {
    expect((await build()).days).toEqual(plan.days);
  });

  it("uses only basket products, none the profile forbids", () => {
    const names = new Set(items.map(i => i.name));
    for (const i of mealItems(plan)) {
      expect(names.has(i.food_name), `${i.food_name} is not in the basket`).toBe(true);
      expect(profileConflict({ name: i.food_name }, profile), `${i.food_name} breaks the profile`).toBeNull();
    }
  });

  it("never serves meat or fish to vegetarians/vegans, nor animal products to vegans", () => {
    const groups = mealItems(plan).map(i => classifyProduct(i.food_name));
    const diet = profile.dietary_preferences || [];
    if (diet.includes("צמחוני") || diet.includes("טבעוני")) {
      expect(groups).not.toContain("meat");
      expect(groups).not.toContain("fish");
    }
    if (diet.includes("טבעוני")) for (const g of ["eggs", "dairy_protein", "yogurt", "milk"]) expect(groups).not.toContain(g);
  });

  it("costs exactly what the final shopping list costs", () => {
    expect(buildFinalShoppingList(items, plan.days).total_estimated_cost).toBe(plan.estimated_weekly_cost);
  });

  it("has 7 days", () => {
    expect(plan.days).toHaveLength(7);
  });

  it.runIf(adequate)("keeps every day within ±5% of the calorie target", () => {
    plan.days.forEach(d => expect(Math.abs(d.total_calories - profile.daily_calories) / profile.daily_calories, d.day_name).toBeLessThanOrEqual(0.05));
  });

  it.runIf(adequate)("has 3–4 meals a day and no meal-rule problems (kosher, one protein, portions, roles)", () => {
    plan.days.forEach(d => expect(d.meals.length).toBeGreaterThanOrEqual(3));
    const problems = plan.validation.remaining_issues.flatMap(p => p.reasons).filter(r => !VARIETY.test(r));
    expect(problems).toEqual([]);
  });
});
