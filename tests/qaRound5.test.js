/**
 * Manual QA, round 5 (2026-10-08): the weekly menu had no breakfast on any day,
 * every "בנייה מחדש" said there was nothing else, and the menu was saved anyway.
 * Root cause: the only bread in the basket was "10פיתות כוסמין700ג תנעמי", and the
 * meal-name check read its word as "10פיתות", so every breakfast named "…פיתות…"
 * was rejected; the basket had no second breakfast base (eggs / yogurt / cereal).
 * The profile and basket are the QA account's real ones (tests/fixtures/qaRound5State.json).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { generateNutritionPlan, menuDifference, IncompleteMenuError } from "@/lib/nutritionPlanGenerator";
import { mealNameMismatches, buildProductCatalog, classifyProduct } from "@/lib/mealPlanRules";
import { validateMenu } from "@/lib/validateMenu";
import { planMissingMeals } from "@/lib/flowData";
import { selectCandidates, needHave, BASKET_NEEDS } from "@/lib/smartBasketEngine";
import { sameBasketItems } from "@/lib/basketBuilder";
import { itemGroup, itemPer100g } from "@/lib/basketAlternatives";
import { basketBudget } from "@/lib/pricing";
import { ITEMS as I, BASE_PROFILE } from "./fixtures/baskets";
import STATE from "./fixtures/qaRound5State.json";

const { profile: PROFILE, basket: BASKET } = STATE;
const list = { items: BASKET };
const budget = basketBudget(PROFILE, list);
const MAIN_MEALS = ["Breakfast", "Lunch", "Dinner"];
const BREAKFAST_BASES = ["bread", "eggs", "yogurt", "cereal"];
const breakfastBases = items => new Set(items.map(i => classifyProduct(i.name, i.category)).filter(g => BREAKFAST_BASES.includes(g)));

describe("a quantity glued to a product word does not break its meal name", () => {
  it("\"10פיתות\" is the word \"פיתות\"", () => {
    const catalog = buildProductCatalog([{ name: "10פיתות כוסמין700ג תנעמי", category: "carb" }, { name: "גבינה בולגרית 5%", category: "dairy" }]);
    const items = catalog.map(p => ({ product_id: p.id, food_name: p.name_he, grams: 100 }));
    expect(mealNameMismatches("גבינה בולגרית עם פיתות כוסמין", items, catalog)).toEqual([]);
    // a food that really is not in the meal is still caught
    expect(mealNameMismatches("גבינה בולגרית עם אורז", items, catalog)).toEqual(["אורז"]);
  });
});

describe("the QA account's real profile and basket", () => {
  let first, again;
  beforeAll(async () => {
    first = await generateNutritionPlan({ list, profile: PROFILE, budget });
    again = await generateNutritionPlan({ list, profile: PROFILE, budget, previous: first });
  }, 300000);

  it("the basket already supports breakfast (bread + cheese / cottage)", () => {
    expect(breakfastBases(BASKET).has("bread")).toBe(true);
  });

  it("the weekly menu has breakfast, lunch and dinner every day", () => {
    expect(first.days).toHaveLength(7);
    expect(planMissingMeals(first)).toEqual([]);
    for (const d of first.days) for (const t of MAIN_MEALS) expect(d.meals.find(m => m.meal_type === t)?.items.length, `${d.day_name}/${t}`).toBeGreaterThan(0);
  });

  it("is a valid menu (not level 4)", () => {
    expect(validateMenu({ plan: first, basketItems: BASKET, profile: PROFILE, budget }).level).toBeLessThanOrEqual(2);
  });

  it("\"בנייה מחדש\" returns a different complete menu, not the same one or \"nothing else\"", () => {
    expect(first.alternative.of).toBeGreaterThanOrEqual(2);
    expect(again.alternative.exhausted).toBe(false);
    expect(menuDifference(first.days, again.days)).toBeGreaterThanOrEqual(0.25);
    expect(planMissingMeals(again)).toEqual([]);
    expect(validateMenu({ plan: again, basketItems: BASKET, profile: PROFILE, budget }).level).toBeLessThanOrEqual(2);
  });
});

describe("a menu missing a meal is never saved or shown", () => {
  it("a basket that cannot make breakfast: the generator refuses with a clear message, no menu", async () => {
    const items = [I.chicken, I.rice, I.potato, I.tomato, I.cucumber, I.oil];
    const err = await generateNutritionPlan({ list: { items }, profile: BASE_PROFILE, budget: 400 }).catch(e => e);
    expect(err).toBeInstanceOf(IncompleteMenuError);
    expect(err.missing).toContain("Breakfast");
    expect(err.message).toMatch(/ארוחת בוקר/);
  });

  it("a saved menu without breakfasts (as the QA run saved) is found and kept off the page", () => {
    const saved = { days: ["Sunday", "Monday"].map(day_name => ({ day_name, meals: ["Lunch", "Dinner", "Snacks"].map(meal_type => ({ meal_type, items: [{ food_name: "x", grams: 100 }] })) })) };
    expect(planMissingMeals(saved)).toEqual(["Sunday/Breakfast", "Monday/Breakfast"]);
    const complete = { days: [{ day_name: "Sunday", meals: MAIN_MEALS.map(meal_type => ({ meal_type, items: [{ food_name: "x", grams: 100 }] })) }] };
    expect(planMissingMeals(complete)).toEqual([]);
  });
});

describe("the smart basket adds a breakfast backup when the receipt has bread only", () => {
  const pool = [I.chicken, I.tuna, I.eggs, I.lentils, I.cottage, I.yogurt, I.rice, I.bread, I.oats, I.potato, I.cucumber, I.pepper,
    I.lettuce, I.banana, I.apple, I.orange, I.oil, I.tahini, I.almonds]
    .map(item => { const group = itemGroup(item); return { item, group, per100: itemPer100g(item, group), pricePer100: item.price_per_kg / 10, source: "catalog" }; });
  // the QA receipt: pitas for bread, cheese and cottage, vegetables, salmon, quinoa, potato
  const receipt = BASKET.filter(i => i.from_receipt);

  it("the QA receipt alone has one breakfast base (bread)", () => {
    expect([...breakfastBases(receipt)]).toEqual(["bread"]);
  });

  it("with a normal budget, eggs / yogurt / cereal are added, with a breakfast reason", () => {
    const added = selectCandidates(pool, receipt, { budgetLeft: 250, hasReceipt: true, favorites: PROFILE.favorite_foods });
    const basket = [...receipt, ...added];
    expect(breakfastBases(basket).size).toBeGreaterThanOrEqual(2);
    expect(needHave(BASKET_NEEDS.find(n => n.key === "breakfast"), basket)).toBeGreaterThanOrEqual(1);
    expect(added.some(i => /ארוחת הבוקר|ארוחות הבוקר/.test(i.reason))).toBe(true);
  });

  it("a basket that already has eggs gets no extra breakfast product", () => {
    const added = selectCandidates(pool, [...receipt, I.eggs], { budgetLeft: 250, hasReceipt: true });
    expect(added.filter(i => i.basket_need === "breakfast")).toEqual([]);
  });
});

describe("duplicate baskets: \"בחירה מחדש\" that gives the same basket is not saved again", () => {
  // the QA run saved this basket 5 times in under 2 seconds
  it("the same products (in any order) are the same basket", () => {
    expect(sameBasketItems(BASKET, [...BASKET].reverse())).toBe(true);
  });
  it("a changed quantity, a removed or an added product is a different basket", () => {
    expect(sameBasketItems(BASKET, BASKET.map((i, k) => (k === 0 ? { ...i, quantity: "2 ק\"ג" } : i)))).toBe(false);
    expect(sameBasketItems(BASKET, BASKET.slice(1))).toBe(false);
    expect(sameBasketItems(BASKET, [...BASKET, I.eggs])).toBe(false);
  });
});
