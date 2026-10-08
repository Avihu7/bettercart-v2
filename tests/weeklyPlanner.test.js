import { describe, it, expect } from "vitest";
import { generateCandidates, MEAL_TYPES } from "@/lib/menuCandidates";
import { scoringContext, scoreMeal, weeklyPenalty, PLANNER_VARIANTS } from "@/lib/mealScoring";
import { planWeek } from "@/lib/weeklyPlanner";
import { buildProductCatalog, checkMeal, classifyProduct } from "@/lib/mealPlanRules";
import { buildDensities } from "@/lib/mealPlanCalories";
import { weeklyBudget } from "@/lib/pricing";
import { BASKETS } from "./fixtures/baskets";

const setup = label => {
  const { items, profile } = BASKETS[label];
  const catalog = buildProductCatalog(items);
  return { items, profile, catalog, densities: buildDensities(catalog, { days: [] }), budget: weeklyBudget(profile) };
};
const MAIN = new Set(["meat", "fish", "legumes", "eggs", "dairy_protein", "yogurt"]);
const mainOf = meal => meal.items.find(i => MAIN.has(classifyProduct(i.food_name)))?.food_name;

describe("candidate meals", () => {
  const { catalog, densities, profile } = setup("rich");
  const candidates = generateCandidates({ catalog, densities, profile });

  it("generates several candidates for every meal type of a rich basket", () => {
    for (const t of MEAL_TYPES) expect(candidates[t].length, t).toBeGreaterThan(3);
  });
  it("keeps only meals that pass every meal rule, from basket products", () => {
    const names = new Set(catalog.map(p => p.name_he));
    for (const c of Object.values(candidates).flat()) {
      expect(checkMeal(c.meal, catalog), c.meal.meal_name).toEqual([]);
      c.meal.items.forEach(i => expect(names.has(i.food_name)).toBe(true));
    }
  });
  it("offers more than one breakfast pattern", () => {
    expect(new Set(candidates.Breakfast.map(c => c.pattern)).size).toBeGreaterThanOrEqual(4);
  });
  it("is deterministic", () => {
    const again = generateCandidates({ catalog, densities, profile });
    expect(again.Lunch.map(c => c.meal)).toEqual(candidates.Lunch.map(c => c.meal));
  });
});

describe("scoring", () => {
  const { catalog, densities, profile, budget } = setup("rich");
  const candidates = generateCandidates({ catalog, densities, profile });
  const ctx = scoringContext({ catalog, densities, profile, budget, candidates });

  it("rewards a meal whose fat share is closer to the target's", () => {
    const off = c => Math.abs(c.nutrition.fat * 9 / c.nutrition.kcal - ctx.fatShare);
    const sorted = [...candidates.Lunch].sort((a, b) => off(a) - off(b));
    const [near, far] = [sorted[0], sorted.at(-1)];
    expect(scoreMeal(near, ctx).parts.fat).toBeGreaterThan(scoreMeal(far, ctx).parts.fat);
  });
  it("rewards a cheaper protein per gram", () => {
    const plate = name => candidates.Lunch.find(c => c.main?.name_he === name && c.pattern === "plate");
    expect(scoreMeal(plate("עדשים ירוקות"), ctx).parts.proteinPrice).toBeGreaterThan(scoreMeal(plate("בשר בקר טחון טרי"), ctx).parts.proteinPrice);
  });
  it("penalizes a week that repeats the same lunch", () => {
    const lunch = candidates.Lunch[0];
    const other = candidates.Lunch.find(c => c.main && lunch.main && c.main.id !== lunch.main.id);
    const same = Array.from({ length: 7 }, () => [null, lunch, null, null]);
    const mixed = Array.from({ length: 7 }, (_, i) => [null, i % 2 ? lunch : other, null, null]);
    expect(weeklyPenalty(same, ctx).penalty).toBeGreaterThan(weeklyPenalty(mixed, ctx).penalty);
  });
});

describe("weekly planner", () => {
  it("is deterministic and local search never lowers the objective", () => {
    const { catalog, densities, profile, budget } = setup("rich");
    const a = planWeek({ catalog, densities, profile, budget });
    const b = planWeek({ catalog, densities, profile, budget });
    expect(b.days).toEqual(a.days);
    expect(a.stats.objective).toBeGreaterThanOrEqual(a.stats.greedyObjective);
  });

  it("varies a rich basket: ≤3 lunches per protein, 3+ proteins, 2+ breakfast patterns, rotating carbs", () => {
    const { catalog, densities, profile, budget } = setup("rich");
    const { days } = planWeek({ catalog, densities, profile, budget });
    const lunches = days.map(d => mainOf(d.meals.find(m => m.meal_type === "Lunch")));
    const counts = lunches.reduce((m, p) => m.set(p, (m.get(p) || 0) + 1), new Map());
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(3);
    const mains = days.flatMap(d => d.meals.filter(m => m.meal_type !== "Snacks").map(mainOf)).filter(Boolean);
    expect(new Set(mains).size).toBeGreaterThanOrEqual(3);
    const breakfasts = days.map(d => d.meals.find(m => m.meal_type === "Breakfast").meal_name);
    expect(new Set(breakfasts).size).toBeGreaterThanOrEqual(2);
    const carbs = days.flatMap(d => d.meals.filter(m => m.meal_type === "Lunch").flatMap(m => m.items))
      .filter(i => ["grain", "starch_veg", "bread"].includes(classifyProduct(i.food_name))).map(i => i.food_name);
    expect(new Set(carbs).size).toBeGreaterThanOrEqual(2);
  });

  it("does not chase the 3-lunch rule when the basket cannot satisfy it", () => {
    // limited: chicken is the only meat; spreading lunches would cost protein
    const { catalog, densities, profile, budget } = setup("limited");
    const { days } = planWeek({ catalog, densities, profile, budget });
    const chickenLunches = days.filter(d => mainOf(d.meals.find(m => m.meal_type === "Lunch")) === "חזה עוף טרי").length;
    expect(chickenLunches).toBeGreaterThanOrEqual(4);
  });

  it("never plans a forbidden product (vegan)", () => {
    const { catalog, densities, profile, budget } = setup("vegan");
    const { days } = planWeek({ catalog: catalog, densities, profile, budget });
    const groups = days.flatMap(d => d.meals.flatMap(m => m.items.map(i => classifyProduct(i.food_name))));
    for (const g of ["meat", "fish", "eggs", "dairy_protein", "yogurt", "milk"]) expect(groups).not.toContain(g);
  });

  it("has a protein-first, a budget-first and a variety-first variant", () => {
    expect(PLANNER_VARIANTS.map(v => v.name)).toEqual(["balanced", "protein", "budget", "variety"]);
  });
});
