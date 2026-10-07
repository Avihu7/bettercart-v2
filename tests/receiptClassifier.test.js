import { describe, it, expect } from "vitest";
import { classifyReceiptLine, applyReceiptRules, receiptLines, receiptInsights, categoryOf } from "@/lib/receiptClassifier";
import { isNonFoodName } from "@/lib/nonFood";
import { isBasketReady } from "@/lib/receiptReview";

describe("food vs non-food (shared with the catalog repair)", () => {
  it.each(["שמפו הד אנד שולדרס", "מש.שיניים קולגייט 75מל", "סרום אורז 30מ\"ל", "קרם גוף", "סלמון לחתול 85 גר", "נוזל כלים תפוח"])(
    "%s is not food", name => expect(isNonFoodName(name)).toBe(true));
  it.each(["וופל קרם קקאו", "קרם קוקוס 400 מ\"ל", "חזה עוף טרי", "תבלין סומק", "מסקרפונה 250 גרם", "טונה בשמן זית"])(
    "%s is food", name => expect(isNonFoodName(name)).toBe(false));
});

describe("receipt line classification (no AI)", () => {
  it("decides food, category and menu suitability from the name", () => {
    expect(classifyReceiptLine({ normalized_name: "חזה עוף טרי" })).toMatchObject({ is_food: true, category: "protein", is_approved_for_menu: true });
    expect(classifyReceiptLine({ normalized_name: "קוקה קולה 1.5 ליטר" })).toMatchObject({ is_food: true, category: "drink", is_approved_for_menu: false });
    expect(classifyReceiptLine({ normalized_name: "במבה 80 גרם" })).toMatchObject({ is_food: true, category: "snack", is_approved_for_menu: false });
    expect(classifyReceiptLine({ normalized_name: "שמפו 700 מל" })).toMatchObject({ is_food: false, is_approved_for_menu: false });
  });
  it("maps food groups to basket categories", () => {
    expect(categoryOf("גבינת קוטג 5%")).toBe("dairy");
    expect(categoryOf("לחם מלא")).toBe("carb");
    expect(categoryOf("טחינה גולמית")).toBe("fat");
    expect(categoryOf("משקה סויה")).toBe("drink");
  });
});

describe("stored receipt items are judged by the rules", () => {
  // As saved by the old AI pipeline: the AI said cola was fine for the menu and chicken was a snack
  const cola = { normalized_name: "קוקה קולה", category: "drink", is_food: true, is_approved_for_menu: true, catalog_match_status: "matched" };
  const chicken = { normalized_name: "חזה עוף", category: "snack", is_food: true, is_approved_for_menu: false, catalog_match_status: "matched" };

  it("overrides old AI decisions", () => {
    expect(applyReceiptRules(cola).is_approved_for_menu).toBe(false);
    expect(applyReceiptRules(chicken)).toMatchObject({ category: "protein", is_approved_for_menu: true });
    expect(isBasketReady(cola)).toBe(false);
    expect(isBasketReady(chicken)).toBe(true);
  });
  it("keeps the user's own edits and \"not food\" decisions", () => {
    expect(applyReceiptRules({ ...cola, user_edited: true }).is_approved_for_menu).toBe(true);
    expect(applyReceiptRules({ ...chicken, catalog_match_status: "non_food" }).is_food).toBe(false);
  });
});

describe("receipt AI answer → plain lines", () => {
  it("keeps only what the receipt says, from either schema", () => {
    const lines = receiptLines({ food_items: [{ original_name: "ח.עוף", normalized_name: "חזה עוף", estimated_quantity: "1 ק\"ג", price: 32.9,
      category: "snack", is_approved_for_menu: false, calories_per_100g: 999 }], non_food_items: [{ name: "שמפו", price: 15 }] });
    expect(lines).toEqual([
      { original_name: "ח.עוף", normalized_name: "חזה עוף", quantity: "1 ק\"ג", price: 32.9 },
      { original_name: "שמפו", normalized_name: "שמפו", quantity: null, price: 15 },
    ]);
  });
});

describe("receipt insights (no AI)", () => {
  it("summarizes groups, spending, low-health items and what to add", () => {
    const items = [
      { normalized_name: "חזה עוף", category: "protein", price: 32.9, is_food: true },
      { normalized_name: "קוקה קולה", category: "drink", price: 8, is_food: true },
      { normalized_name: "במבה", category: "snack", price: 5, is_food: true },
    ];
    const insights = receiptInsights(items);
    expect(insights.main_food_preferences).toEqual(["בשר ועוף"]);
    expect(insights.high_spending_categories[0]).toMatch(/חלבונים/);
    expect(insights.less_healthy_patterns[0]).toMatch(/קוקה קולה/);
    expect(insights.recommended_improvements.join(" ")).toMatch(/ירקות/);
  });
});
