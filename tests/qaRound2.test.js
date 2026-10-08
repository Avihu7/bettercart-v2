/**
 * Manual QA, round 2 (2026-10-08): corrected receipt names, merged receipt lines,
 * favorite proteins, "בנייה מחדש" alternatives and whole-week variety.
 */
import { describe, it, expect } from "vitest";
import { foodName } from "@/lib/receiptClassifier";
import { receiptItemName, splitLine, isBasketReady } from "@/lib/receiptReview";
import { receiptToBasketItem, userAddedItem } from "@/lib/basketBuilder";
import { isFavorite } from "@/lib/basketAlternatives";
import { selectCandidates } from "@/lib/smartBasketEngine";
import { generateNutritionPlan, menuDifference } from "@/lib/nutritionPlanGenerator";
import { validateMenu } from "@/lib/validateMenu";
import { buildFinalShoppingList } from "@/lib/shoppingOptimizer";
import { weeklyBudget } from "@/lib/pricing";
import { BASKETS, BASE_PROFILE, ITEMS as I } from "./fixtures/baskets";

// The QA account's receipt lines, as saved after review
const approved = (original, matched, extra = {}) => ({
  id: original, receipt_id: "r1", original_name: original, normalized_name: original, matched_product_name: matched,
  catalog_match_type: "token", catalog_match_status: "approved", catalog_needs_review: 0, is_food: 1, price: 10, quantity: "", ...extra,
});
const CORN = approved("גרעיני דיריז מתוק", "גרעיני תירס מתוק יכין550");
const COTTAGE = approved("צמד פטריח מגורב 6 גרם 250 5% קוטג", "קוטג' תנובה 5% 250 גרם", { price: 21.9 });
const CUCUMBER = { ...approved("מקפפן", "מלפפון"), normalized_name: "מלפפון", catalog_match_type: "manual" };

describe("a corrected receipt line is known by its corrected product", () => {
  it("an approved catalog suggestion names the item, as a hand-picked product does", () => {
    expect(foodName(CORN)).toBe("גרעיני תירס מתוק יכין550");
    expect(foodName(COTTAGE)).toBe("קוטג' תנובה 5% 250 גרם");
    expect(foodName(CUCUMBER)).toBe("מלפפון");
    for (const i of [CORN, COTTAGE, CUCUMBER]) expect(receiptItemName(i)).toBe(foodName(i));
  });

  it("an unconfirmed suggestion does not rename the item", () => {
    expect(foodName({ ...CORN, catalog_match_status: "needs_review", catalog_needs_review: 1 })).toBe("גרעיני דיריז מתוק");
  });

  it("the corrected name reaches the basket, the menu and the final list — the OCR text never shows", async () => {
    expect(isBasketReady(CORN)).toBe(true); // corn, not a snack, once it is known as corn
    const fromReceipt = [CORN, COTTAGE, CUCUMBER].map(receiptToBasketItem);
    expect(fromReceipt.map(i => i.name)).toEqual(["גרעיני תירס מתוק יכין550", "קוטג' תנובה 5% 250 גרם", "מלפפון"]);

    const items = [...fromReceipt, I.chicken, I.tuna, I.eggs, I.lentils, I.rice, I.bread, I.tomato, I.pepper, I.banana, I.apple, I.oil];
    const profile = BASE_PROFILE;
    const plan = await generateNutritionPlan({ list: { items }, profile, budget: weeklyBudget(profile) });
    const menuNames = plan.days.flatMap(d => d.meals.flatMap(m => m.items.map(i => i.food_name)));
    const listNames = buildFinalShoppingList(items, plan.days).items.map(l => l.name);
    for (const ocr of ["דיריז", "פטריח", "מקפפן"]) {
      expect(menuNames.join("|")).not.toContain(ocr);
      expect(listNames.join("|")).not.toContain(ocr);
    }
  }, 60000);
});

describe("a receipt line the reading merged from two products", () => {
  const mushrooms = { product_id: 77, original_product_name: "פטריות שמפיניון 250 גרם", price: 6.9, chain: "shufersal", category: "vegetable",
    pack_grams: 250, calories_per_100g: 22, protein_per_100g: 3, carbs_per_100g: 3, fat_per_100g: 0.3 };

  it("splits into two lines on the same receipt; the prices add up to the original", () => {
    const { update, create } = splitLine(COTTAGE, mushrooms, 6.9);
    expect(update.price + create.price).toBeCloseTo(21.9, 2);
    expect(create).toMatchObject({ receipt_id: "r1", original_name: COTTAGE.original_name, price: 6.9,
      normalized_name: "פטריות שמפיניון 250 גרם", matched_product_name: "פטריות שמפיניון 250 גרם",
      catalog_match_type: "manual", catalog_match_status: "approved", is_food: true });
    // the new line uses the catalog's nutrition, not the merged line's reading
    expect(create.calories_per_100g).toBe(22);
    expect(foodName(create)).toBe("פטריות שמפיניון 250 גרם");
  });

  it("never gives the second product more than the line cost", () => {
    const { update, create } = splitLine(COTTAGE, mushrooms, 50);
    expect(create.price).toBe(21.9);
    expect(update.price).toBe(0);
  });
});

describe("protein additions respect an omnivore's favorite foods", () => {
  const favorites = ["חזה עוף", "בשר טחון"];
  it("matches a favorite by its words", () => {
    expect(isFavorite("חזה עוף טרי 1 ק\"ג", favorites)).toBe(true);
    expect(isFavorite("בשר בקר טחון קפוא", favorites)).toBe(true);
    expect(isFavorite("חזה הודו טרי", favorites)).toBe(false);
    expect(isFavorite("סייטן בסגנון טבעי 500 גר", favorites)).toBe(false);
  });

  // The QA basket: salmon and cheese — the engine wants a third kind of protein.
  // Seitan scores higher than chicken (health 10 vs 8) — the user's favorites decide.
  const entry = (name, price, grams, per100, group) => ({
    item: { name, category: "protein", estimated_price: price, quantity: `${grams} גרם` }, group, per100, pricePer100: price / grams * 100, source: "catalog",
  });
  const pool = [
    entry("סייטן בסגנון טבעי 500 גר", 19.9, 500, { kcal: 140, protein: 25, carbs: 6, fat: 2 }, "legumes"),
    entry("חזה עוף טרי 1 ק\"ג", 32.9, 1000, { kcal: 110, protein: 23, carbs: 0, fat: 1.5 }, "meat"),
    entry("בשר בקר טחון קפוא", 19.9, 500, { kcal: 250, protein: 18, carbs: 0, fat: 20 }, "meat"),
    // the catalog's price range reaches far above these (as in the live catalog)
    entry("סטייק אנטריקוט טרי", 120, 1000, { kcal: 220, protein: 20, carbs: 0, fat: 15 }, "meat"),
  ];
  const basket = [
    { name: "פילה סלמון טרי", category: "protein", estimated_price: 75, quantity: "600 גרם" },
    { name: "גבינה בולגרית 5%", category: "dairy", estimated_price: 17, quantity: "300 גרם" },
    I.bread, I.rice, I.potato, I.oil, I.tahini, I.cucumber, I.pepper, I.lettuce, I.carrot, I.banana, I.apple, I.yogurt,
  ];
  const proteinAdded = added => added.filter(i => i.basket_need === "protein").map(i => i.name);

  it("a liked animal protein is added before seitan", () => {
    const added = selectCandidates(pool, basket, { favorites });
    expect(proteinAdded(added)).toEqual(["חזה עוף טרי 1 ק\"ג"]);
    expect(added.find(i => i.basket_need === "protein").reason).toMatch(/המזונות האהובים שלך/);
  });

  it("without favorites, the scores decide (unchanged behavior)", () => {
    expect(proteinAdded(selectCandidates(pool, basket, { favorites: [] }))).toEqual(["סייטן בסגנון טבעי 500 גר"]);
  });

  it("the budget still comes first: a favorite that does not fit is not forced in", () => {
    const added = selectCandidates(pool, basket, { favorites: ["חזה עוף"], budgetLeft: 25 });
    expect(proteinAdded(added)).not.toContain("חזה עוף טרי 1 ק\"ג");
  });
});

describe("\"בנייה מחדש\": a different valid menu each time, deterministically", () => {
  const { items, profile } = BASKETS.rich;
  const budget = weeklyBudget(profile);
  const validate = plan => validateMenu({ plan, basketItems: items, profile, budget });

  it("alternative #2 differs from #1 in its meals, and both are valid", async () => {
    const first = await generateNutritionPlan({ list: { items }, profile, budget });
    const second = await generateNutritionPlan({ list: { items }, profile, budget, previous: first });
    expect(first.alternative.index).toBe(0);
    expect(second.alternative.index).toBe(1);
    expect(second.alternative.exhausted).toBe(false);
    expect(menuDifference(first.days, second.days)).toBeGreaterThanOrEqual(0.25);
    const [v1, v2] = [validate(first), validate(second)];
    expect(v1.level).toBe(1);
    expect(v2.level).toBeLessThanOrEqual(2); // never a safety, realism, nutrition or budget miss
    expect(v2.failed.filter(id => ["coverage", "safety", "realism", "nutrition", "budget"].includes(v2.checks.find(c => c.id === id).area))).toEqual([]);
    // the menu and its final list still agree on cost
    expect(buildFinalShoppingList(items, second.days).total_estimated_cost).toBe(second.estimated_weekly_cost);
  }, 60000);

  it("is deterministic, and cycles through the alternatives", async () => {
    const first = await generateNutritionPlan({ list: { items }, profile, budget });
    const a = await generateNutritionPlan({ list: { items }, profile, budget, previous: first });
    const b = await generateNutritionPlan({ list: { items }, profile, budget, previous: first });
    expect(a.days).toEqual(b.days);
    let current = a;
    for (let n = 1; n < a.alternative.of; n++) current = await generateNutritionPlan({ list: { items }, profile, budget, previous: current });
    expect(current.alternative.index).toBe(0); // back to the first menu
  }, 120000);

  it("a basket with nothing to vary says so instead of returning the same menu as new", async () => {
    const { items: few, profile: p } = BASKETS.tiny;
    const first = await generateNutritionPlan({ list: { items: few }, profile: p, budget: weeklyBudget(p) });
    const again = await generateNutritionPlan({ list: { items: few }, profile: p, budget: weeklyBudget(p), previous: first });
    expect(again.alternative.exhausted).toBe(true);
  }, 60000);
});

describe("variety the user sees: not the same foods moved between meals", () => {
  const meal = (type, ...items) => ({ meal_type: type, meal_name: "ארוחה", items: items.map(p => ({ food_name: p.name, grams: 100, calories: 0, protein: 0, carbs: 0, fat: 0 })) });
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  // cheese on bread for breakfast, lunch and dinner; a different vegetable each time
  const week = DAYS.map((day_name, d) => ({ day_name, meals: [
    meal("Breakfast", I.cottage, I.bread, I.tomato),
    meal("Lunch", d % 2 ? I.cottage : I.chicken, d % 2 ? I.bread : I.rice, I.cucumber),
    meal("Dinner", I.cottage, I.bread, I.pepper),
  ] }));

  it("flags the same meal under different meal types when the basket has alternatives", () => {
    const basket = [I.chicken, I.tuna, I.eggs, I.lentils, I.cottage, I.rice, I.pasta, I.bread, I.potato, I.tomato, I.cucumber, I.pepper];
    // (no nutrition targets: these test meals carry no calories)
    const v = validateMenu({ plan: { days: week }, basketItems: basket, profile: { dietary_preferences: [] } });
    expect(v.failed).toEqual(expect.arrayContaining(["cross_meal_repeat", "product_repeat"]));
    const cross = v.checks.find(c => c.id === "cross_meal_repeat").data;
    expect(cross.crossMeal[0]).toMatchObject({ meal: `${I.cottage.name}|${I.bread.name}` });
    expect(cross.sameDayCore.length).toBeGreaterThan(0);
    expect(v.level).toBe(2);
  });

  it("reports it as limited — not a planner failure — when the basket lacks alternatives", () => {
    const basket = [I.chicken, I.cottage, I.rice, I.bread, I.tomato, I.cucumber, I.pepper];
    const v = validateMenu({ plan: { days: week }, basketItems: basket, profile: BASE_PROFILE });
    expect(v.failed).not.toContain("cross_meal_repeat");
    expect(v.limited).toContain("cross_meal_repeat");
  });

  it("the planner keeps a rich basket's week varied across meal types", async () => {
    const { items, profile } = BASKETS.rich;
    const plan = await generateNutritionPlan({ list: { items }, profile, budget: weeklyBudget(profile) });
    const v = validateMenu({ plan, basketItems: items, profile, budget: weeklyBudget(profile) });
    expect(v.failed).not.toContain("cross_meal_repeat");
    expect(v.failed).not.toContain("product_repeat");
  }, 60000);
});

describe("adding a food product to the basket from the catalog", () => {
  const product = (name, extra = {}) => ({ product_id: 1, original_product_name: name, price: 34.9, chain: "shufersal", pack_grams: 750,
    calories_per_100g: 884, protein_per_100g: 0, carbs_per_100g: 0, fat_per_100g: 100, ...extra });

  it("becomes a basket item priced by its catalog pack", () => {
    const { item, error } = userAddedItem(product("שמן זית 750 מ\"ל"), BASE_PROFILE);
    expect(error).toBeUndefined();
    expect(item).toMatchObject({ name: "שמן זית 750 מ\"ל", category: "fat", quantity: "750 גרם", estimated_price: 34.9, user_added: true });
    expect(item.fat).toBeGreaterThan(600);
  });

  it("refuses non-food, supplements and products the profile cannot eat", () => {
    expect(userAddedItem(product("משחת שיניים קולגייט"), BASE_PROFILE).error).toBeTruthy();
    expect(userAddedItem(product("אבקת חלבון וניל"), BASE_PROFILE).error).toBeTruthy();
    expect(userAddedItem(product("חזה עוף טרי 1 ק\"ג", { pack_grams: 1000 }), { ...BASE_PROFILE, dietary_preferences: ["טבעוני"] }).error).toBeTruthy();
  });
});
