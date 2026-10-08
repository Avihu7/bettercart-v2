/**
 * Manual QA, round 4 (2026-10-08): the menu was valid by the numbers but not a
 * menu a meat eater would eat — 10 g of sardines, a second protein on a plate,
 * cheese and bread as the main lunch again and again.
 * The basket is the one from the QA run (tests/fixtures/qaRound4Basket.json).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { generateNutritionPlan } from "@/lib/nutritionPlanGenerator";
import { classifyProduct, checkMeal, buildProductCatalog } from "@/lib/mealPlanRules";
import { validateMenu } from "@/lib/validateMenu";
import { basketBudget } from "@/lib/pricing";
import BASKET from "./fixtures/qaRound4Basket.json";

const OMNIVORE = {
  dietary_preferences: [], allergies: [], favorite_foods: ["חזה עוף", "בשר טחון"], disliked_foods: [],
  daily_calories: 2674, protein_target: 158, monthly_budget: 1700, purchases_per_month: 4, goal: "maintain",
};
const PLATE = new Set(["meat", "fish", "legumes"]);
const groupOf = item => classifyProduct(item.food_name);
const mains = plan => plan.days.flatMap(d => d.meals.filter(m => m.meal_type === "Lunch" || m.meal_type === "Dinner").map(m => ({ day: d.day_name, ...m })));
const plan = profile => generateNutritionPlan({ list: { items: BASKET }, profile, budget: basketBudget(profile, { items: BASKET }) });

describe("canned fish is a protein, not cooking oil", () => {
  it("fish in oil classifies as fish; oil and cereals stay what they are", () => {
    expect(classifyProduct("סרדינים בשמן סויה 120 גר")).toBe("fish");
    expect(classifyProduct("טונה בשמן 3x160 ג")).toBe("fish");
    expect(classifyProduct("שמן זית 750 מ\"ל")).toBe("oil");
    expect(classifyProduct("דגני בוקר קורנפלקס")).toBe("cereal");
  });
});

describe.each([["an omnivore with chicken / meat favorites", OMNIVORE], ["no profile", undefined]])("the menu for %s", (_, profile) => {
  let menu;
  beforeAll(async () => { menu = await plan(profile); }, 120000);

  it("no meat, fish or legume item is a token amount (no 10 g of sardines)", () => {
    // by name too: the bug was canned fish read as cooking oil
    const tiny = menu.days.flatMap(d => d.meals.flatMap(m => m.items.filter(i => (PLATE.has(groupOf(i)) || /סרדינ|טונה/.test(i.food_name)) && i.grams < 60)
      .map(i => `${d.day_name}/${m.meal_type}: ${i.food_name} ${i.grams}g`)));
    expect(tiny).toEqual([]);
  });

  it("one main protein per plate: no chicken on a soy plate, no soy on a cheese plate", () => {
    const mixed = mains(menu).filter(m => {
      const groups = m.items.map(groupOf);
      const plate = new Set(m.items.filter(i => PLATE.has(groupOf(i))).map(i => i.food_name));
      return plate.size > 1 || (plate.size === 1 && groups.includes("dairy_protein"));
    }).map(m => `${m.day}/${m.meal_type}: ${m.items.map(i => i.food_name).join(" + ")}`);
    expect(mixed).toEqual([]);
  });

  it("cheese / eggs with bread is the lunch at most once a week when meat, fish or legumes are in the basket", () => {
    const light = menu.days.map(d => d.meals.find(m => m.meal_type === "Lunch"))
      .filter(m => m && !m.items.some(i => PLATE.has(groupOf(i))));
    expect(light.length).toBeLessThanOrEqual(1);
  });

  it("chicken, meat or fish makes real main meals (≥ 100 g), not only the basket", () => {
    const animal = mains(menu).filter(m => m.items.some(i => ["meat", "fish"].includes(groupOf(i)) && i.grams >= 100));
    expect(animal.length).toBeGreaterThanOrEqual(3);
    if (profile) expect(animal.filter(m => m.items.some(i => i.food_name.includes("חזה עוף"))).length).toBeGreaterThanOrEqual(2);
  });

  it("the menu still meets its quality bar", () => {
    if (!profile) return;
    expect(validateMenu({ plan: menu, basketItems: BASKET, profile, budget: basketBudget(profile, { items: BASKET }) }).level).toBeLessThanOrEqual(2);
  });
});

describe("a plate that only adds up on paper is not a realistic meal", () => {
  const catalog = buildProductCatalog([
    { name: "פולי סויה 450 גרם", category: "protein" }, { name: "סרדינים בשמן סויה 120 גר", category: "protein" },
    { name: "חזה עוף טרי 1 ק\"ג", category: "protein" }, { name: "תפוח אדמה 1 ק\"ג", category: "carb" },
    { name: "עגבניה", category: "vegetable" },
  ]);
  const id = name => catalog.find(p => p.name_he.startsWith(name)).id;
  const meal = items => ({ meal_type: "Lunch", meal_name: "ארוחת צהריים", items: items.map(([n, g]) => ({ product_id: id(n), food_name: n, grams: g })) });

  it("a token protein portion is flagged", () => {
    const issues = checkMeal(meal([["פולי סויה", 200], ["תפוח אדמה", 260], ["עגבניה", 120], ["סרדינים", 10]]), catalog);
    expect(issues.join("|")).toMatch(/unrealistic portion: 10g סרדינים.*min/);
  });

  it("two main proteins on one plate are flagged", () => {
    const issues = checkMeal(meal([["פולי סויה", 250], ["חזה עוף", 80], ["תפוח אדמה", 200], ["עגבניה", 120]]), catalog);
    expect(issues.join("|")).toMatch(/more than one main protein/);
  });

  it("a normal plate passes", () => {
    const issues = checkMeal(meal([["חזה עוף", 180], ["תפוח אדמה", 250], ["עגבניה", 120]]), catalog);
    expect(issues.filter(i => /portion|main protein/.test(i))).toEqual([]);
  });
});
