/**
 * Multi-receipt spending, receipt hygiene, unit normalization and meal variety
 * (the vegan-account audit).
 */
import { describe, it, expect } from "vitest";
import { receiptLines, spendClass, receiptSpending, foodName, isDiscountLine, isPlainWater } from "@/lib/receiptClassifier";
import { isBasketReady } from "@/lib/receiptReview";
import { parseQuantityGrams } from "@/lib/mealPlanCalories";
import { isLiquid } from "@/lib/basketBudget";
import { dishWord } from "@/lib/mealPlanRules";
import { scoringContext, weeklyPenalty, signature } from "@/lib/mealScoring";
import { generateCandidates } from "@/lib/menuCandidates";
import { validateMenu } from "@/lib/validateMenu";
import { buildProductCatalog } from "@/lib/mealPlanRules";
import { buildDensities } from "@/lib/mealPlanCalories";
import { BASKETS, ITEMS as I } from "./fixtures/baskets";

const line = (name, price, extra = {}) => ({ id: name + price, receipt_id: "r1", normalized_name: name, original_name: name, price,
  is_food: true, is_approved_for_menu: true, catalog_match_status: "matched", ...extra });

describe("receipt hygiene", () => {
  it("merges a discount line into the product above it", () => {
    const lines = receiptLines({ items: [
      { original_name: "מלפפון", price: 7.87 }, { original_name: "קטיף מלפפון", price: -3.42 }, { original_name: "עגבניה", price: 6 },
    ] });
    expect(lines.map(l => [l.normalized_name, l.price])).toEqual([["מלפפון", 4.45], ["עגבניה", 6]]);
    expect(lines[0].discount).toBe(3.42);
  });
  it("never puts a discount line or water in the basket", () => {
    expect(isDiscountLine(line("גדר ארוד קטיף", -0.32))).toBe(true);
    expect(isBasketReady(line("גדר ארוד קטיף", -0.32))).toBe(false);
    expect(isPlainWater("מים מינרליים")).toBe(true);
    expect(isBasketReady(line("מים מינרליים", 33))).toBe(false);
  });
  it("uses the catalog name when the receipt's reading names no food", () => {
    expect(foodName(line("חפוח אדמה", 6.38, { matched_product_name: "תפוח אדמה 1 ק\"ג" }))).toBe("תפוח אדמה 1 ק\"ג");
    expect(foodName(line("פיתוח כוסמי", 18.9, { matched_product_name: "10פיתות כוסמין700ג תנעמי" }))).toBe("10פיתות כוסמין700ג תנעמי");
    expect(foodName(line("עגבניה", 6, { matched_product_name: "עגבניה שרי" }))).toBe("עגבניה");
  });
  it("names \"10פיתות…\" by its food word", () => {
    expect(dishWord("10פיתות כוסמין700ג תנעמי")).toMatch(/^פיתות/);
  });
});

describe("spending by class across receipts", () => {
  const receipts = [{ id: "r1", purchase_date: "2026-10-04" }, { id: "r2", purchase_date: "2026-10-07" }, { id: "empty" }];
  const items = [
    line("חזה עוף טרי", 40), line("קטיף", -4), line("במבה", 6), line("מים מינרליים", 33),
    line("נוזל כלים", 15, { is_food: false }),
    { ...line("עדשים", 10), receipt_id: "r2" }, { ...line("שמפו", 20, { is_food: false }), receipt_id: "r2" },
  ];
  const s = receiptSpending(receipts, items, { purchasesPerMonth: 4 });

  it("classifies lines: menu food, other food, non-food", () => {
    expect(spendClass(line("חזה עוף טרי", 40))).toBe("food_plannable");
    expect(spendClass(line("במבה", 6))).toBe("food_non_plannable");
    expect(spendClass(line("מים מינרליים", 33))).toBe("food_non_plannable");
    expect(spendClass(line("נוזל כלים", 15, { is_food: false }))).toBe("non_food");
  });
  it("uses every receipt with lines, credits discounts to the line above, skips empty receipts", () => {
    expect(s.count).toBe(2);
    expect(s.receipts[0]).toMatchObject({ food_plannable: 36, food_non_plannable: 39, non_food: 15, total: 90 });
    expect(s.perReceipt.food_plannable).toBe(23);
    expect(s.perMonth.food_plannable).toBe(92);
  });
  // (the plan is compared with the user's budget, receipts are history only — tests/budgetModel.test.js)
});

describe("units", () => {
  it("reads a bottle multipack without a unit as litres", () => {
    expect(parseQuantityGrams("6x1", "other")).toBe(6000);
    expect(parseQuantityGrams("6×1.5", "other")).toBe(9000);
    expect(parseQuantityGrams("4x80", "other")).toBe(320);
  });
  it("treats water, milk and drinks as liquids", () => {
    expect(isLiquid({ name: "מים מינרליים", quantity: "6x1" })).toBe(true);
    expect(isLiquid({ name: "חלב 3%", quantity: "1 ליטר" })).toBe(true);
    expect(isLiquid({ name: "חזה עוף", quantity: "1 ק\"ג" })).toBe(false);
  });
});

describe("variety", () => {
  const { items, profile } = BASKETS.rich;
  const catalog = buildProductCatalog(items);
  const candidates = generateCandidates({ catalog, densities: buildDensities(catalog, { days: [] }), profile });
  const ctx = scoringContext({ catalog, densities: buildDensities(catalog, { days: [] }), profile, budget: 327, candidates });

  it("a different vegetable, or lunch instead of dinner, is the same meal", () => {
    const plate = candidates.Lunch.find(c => c.pattern === "plate" && c.main && c.carb);
    const sameButVeg = candidates.Lunch.find(c => c !== plate && signature(c) === signature(plate));
    const asDinner = candidates.Dinner.find(c => signature(c) === signature(plate));
    expect(sameButVeg).toBeTruthy();
    const repeat = weeklyPenalty([[null, plate, null, null], [null, sameButVeg, null, null], [null, null, asDinner || plate, null]], ctx).parts.mealRepeat;
    expect(repeat).toBe(4); // one signature used 3 times: (3 − 1)²
  });
  it("the validator flags the same main meal more than 3 times when the basket offers alternatives", () => {
    const meal = { meal_type: "Lunch", meal_name: "חזה עוף עם אורז", items: [{ food_name: I.chicken.name, grams: 200 }, { food_name: I.rice.name, grams: 200 }, { food_name: I.cucumber.name, grams: 100 }] };
    const plan = { days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(day_name => ({ day_name, meals: [meal, { ...meal, meal_type: "Dinner" }] })) };
    const v = validateMenu({ plan, basketItems: items, profile: { dietary_preferences: [] } });
    expect(v.failed).toContain("meal_repeat");
  });
});
