import { describe, it, expect } from "vitest";
import { buildBasket, receiptToBasketItem, normalizeCategory, sameFood, basketTotals } from "@/lib/basketBuilder";

// A receipt item as stored after catalog matching
const receiptItem = (over = {}) => ({
  id: over.name || "x", original_name: over.name, normalized_name: over.name, category: "protein",
  is_food: true, is_approved_for_menu: true, catalog_match_status: "matched", catalog_needs_review: false,
  ...over,
});
const beef = receiptItem({
  name: "בשר טחון טרי", quantity: "0.744 ק\"ג", price: 59.45,
  catalog_price: 79.9, catalog_pack_grams: 1000, catalog_sold_by_weight: true, matched_product_name: "בשר טחון טרי",
  catalog_calories_per_100g: 250, catalog_protein_per_100g: 17, catalog_carbs_per_100g: 0, catalog_fat_per_100g: 20,
});
const sugar = receiptItem({
  name: "סוכר", category: "other", quantity: "1 ק\"ג", price: 5.5,
  catalog_price: 2.5, catalog_pack_grams: 100, catalog_sold_by_weight: false, matched_product_name: "סוכר 100 גרם",
});

describe("receipt item → basket item", () => {
  it("prices a weighed product by the kilo for the amount bought", () => {
    const item = receiptToBasketItem(beef);
    expect(item).toMatchObject({ estimated_price: 59.4, price_per_kg: 79.9, sold_by_weight: true, from_receipt: true });
    expect(item.calories).toBe(1860);
  });
  it("uses the receipt's own price when the catalog matched another pack size", () => {
    const item = receiptToBasketItem(sugar);
    expect(item.estimated_price).toBe(5.5);
    expect(item.price_per_kg).toBe(5.5);
  });
  it("maps category variants", () => {
    expect(normalizeCategory("מוצרי חלב")).toBe("dairy");
    expect(normalizeCategory("legumes")).toBe("protein");
    expect(normalizeCategory("???")).toBe("other");
  });
});

describe("buildBasket", () => {
  const noAdditions = async () => [];
  const noStaples = async () => [];
  const profile = { disliked_foods: ["עגבניות"], allergies: [], dietary_preferences: [] };

  it("keeps receipt food, drops disliked items and duplicates", async () => {
    const { items } = await buildBasket({
      receiptItems: [beef, receiptItem({ name: "עגבניות", category: "vegetable", quantity: "1 ק\"ג", price: 8 }),
        receiptItem({ name: "בשר טחון טרי 500 גרם", quantity: "500 גרם", price: 40 })],
      profile, weeklyBudget: 500, additions: noAdditions, staples: noStaples,
    });
    expect(items.map(i => i.name)).toEqual(["בשר טחון טרי"]);
  });

  it("drops what the profile forbids (vegetarian: no meat)", async () => {
    const { items } = await buildBasket({
      receiptItems: [beef], profile: { ...profile, dietary_preferences: ["צמחוני"] }, weeklyBudget: 500,
      additions: noAdditions, staples: noStaples,
    });
    expect(items).toEqual([]);
  });

  it("adds strong purchase-history regulars, not weak ones", async () => {
    const regular = { name: "קוטג' 5%", confidence: 1, history_score: 0.9, quality_score: 0.8, receipt_count: 5, total_receipts: 6,
      latest_item: receiptItem({ name: "קוטג' 5%", category: "dairy", quantity: "250 גרם", price: 6 }) };
    const weak = { ...regular, name: "יוגורט", history_score: 0.55, latest_item: receiptItem({ name: "יוגורט", category: "dairy", quantity: "200 גרם", price: 5 }) };
    const { items } = await buildBasket({
      receiptItems: [beef], history: [regular, weak], profile, weeklyBudget: 500, additions: noAdditions, staples: noStaples,
    });
    expect(items.map(i => i.name)).toEqual(["בשר טחון טרי", "קוטג' 5%"]);
    expect(items[1].from_history).toBe(true);
  });

  it("passes the budget left to the engine and trims optional picks first, never staples", async () => {
    let seen;
    const additions = async args => {
      seen = args.budgetLeft;
      return [
        { name: "אגוזי מלך", estimated_price: 40, from_engine: true, basket_optional: true },
        { name: "לחם מלא", estimated_price: 15, added_staple: true },
      ];
    };
    const { items, total } = await buildBasket({ receiptItems: [beef], profile, weeklyBudget: 80, additions, staples: noStaples });
    expect(seen).toBeCloseTo(80 - 59.4, 5);
    expect(items.map(i => i.name)).toEqual(["בשר טחון טרי", "לחם מלא"]);
    expect(total).toBeCloseTo(74.4, 5);
  });
});

describe("helpers", () => {
  it("sameFood / basketTotals", () => {
    expect(sameFood("עגבניות", "עגבניות שרי")).toBe(true);
    expect(basketTotals([{ estimated_price: 1.234, calories: 10 }, { estimated_price: 2, calories: 5.4 }]))
      .toEqual({ total_estimated_cost: 3.23, total_calories: 15 });
  });
});
