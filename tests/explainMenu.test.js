import { describe, it, expect, beforeAll } from "vitest";
import { generateNutritionPlan } from "@/lib/nutritionPlanGenerator";
import { validateMenu } from "@/lib/validateMenu";
import { explainMenu } from "@/lib/explainMenu";
import { weeklyBudget } from "@/lib/pricing";
import { BASKETS } from "./fixtures/baskets";

const explained = {};
beforeAll(async () => {
  for (const label of ["vegan", "limited", "tiny", "real", "vegetarian"]) {
    const { items, profile } = BASKETS[label];
    const budget = weeklyBudget(profile);
    const plan = await generateNutritionPlan({ list: { items }, profile, budget });
    explained[label] = explainMenu(validateMenu({ plan, basketItems: items, profile, budget }), { plan, basketItems: items, profile });
  }
}, 120000);
const text = e => e.points.map(p => p.text).join("\n");

describe("menu explanation", () => {
  it("level 1: a short summary, nothing to add", () => {
    expect(explained.vegan.level).toBe(1);
    expect(explained.vegan.points.map(p => p.area)).toEqual(["summary"]);
    expect(explained.vegan.add).toEqual([]);
  });

  it("level 2 limited by the basket: says why it repeats and what to add", () => {
    const e = explained.limited;
    expect(e.level).toBe(2);
    expect(text(e)).toMatch(/מקור החלבון היחיד לצהריים/);
    expect(text(e)).toMatch(/ארוחת הבוקר חוזרת על עצמה כי בסל אין ביצים, יוגורט, דגני בוקר/);
    expect(e.add).toEqual(expect.arrayContaining(["ביצים", "יוגורט"]));
  });

  it("level 2 by the planner: says the basket had alternatives", () => {
    expect(text(explained.vegetarian)).toMatch(/למרות שיש בסל חלופות/);
  });

  it("level 3 over budget: amount, the protein trade-off, and the way to the basket", () => {
    const e = explained.real;
    expect(e.level).toBe(3);
    expect(text(e)).toMatch(/מעל התקציב השבועי/);
    expect(text(e)).toMatch(/יעד החלבון שלך \(175 ג׳ ביום\) יקר ביחס לתקציב/);
    expect(e.budgetAction).toBe(true);
  });

  it("level 4: what is missing, without the symptoms that follow from it", () => {
    const e = explained.tiny;
    expect(e.level).toBe(4);
    expect(text(e)).toMatch(/חסרים סוגי מזון בסיסיים/);
    expect(e.points.every(p => ["coverage", "safety", "realism"].includes(p.area))).toBe(true);
    expect(e.add.length).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const { items, profile } = BASKETS.real;
    const budget = weeklyBudget(profile);
    return generateNutritionPlan({ list: { items }, profile, budget }).then(plan => {
      const again = explainMenu(validateMenu({ plan, basketItems: items, profile, budget }), { plan, basketItems: items, profile });
      expect(again).toEqual(explained.real);
    });
  });
});
