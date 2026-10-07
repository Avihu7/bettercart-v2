import { describe, it, expect } from "vitest";
import { catalogPack, catalogPricePer100g, pricingFields, purchaseCost, weeklyBudget, basketBudget } from "@/lib/pricing";
import { buildFinalShoppingList } from "@/lib/shoppingOptimizer";

describe("catalog pack weights", () => {
  it("reads a per-kg row (\"1קילוגרם\", quantity 1) as 1000 g sold by weight", () => {
    const beef = { quantity_in_grams: 1, package_unit: "1קילוגרם", original_product_name: "בשר טחון טרי", price: 79.9 };
    expect(catalogPack(beef)).toEqual({ grams: 1000, soldByWeight: true });
    expect(catalogPricePer100g(beef)).toBe(7.99);
  });
  it("keeps a 1 kg bag with the weight in its name a packed product", () => {
    expect(catalogPack({ quantity_in_grams: 1, package_unit: "1קילוגרם", original_product_name: "אורז פרסי 1 ק\"ג" }))
      .toEqual({ grams: 1000, soldByWeight: false });
  });
  it("converts kg and litre fractions, keeps gram packs", () => {
    expect(catalogPack({ quantity_in_grams: 0.5, package_unit: "1קילוגרם", original_product_name: "x" }).grams).toBe(500);
    expect(catalogPack({ quantity_in_grams: 250, package_unit: "100 גרם" }).grams).toBe(250);
    expect(catalogPack({ quantity_in_grams: 1500, package_unit: "1ליטר" }).grams).toBe(1500);
  });
  it("fixes \"100 מיליליטר\" rows stored ×1000 from the volume in the name", () => {
    expect(catalogPack({ quantity_in_grams: 50000, package_unit: "100 מיליליטר", original_product_name: "סרום 50 מ\"ל" }).grams).toBe(50);
  });
  it("rejects impossible pack weights", () => {
    expect(catalogPack({ quantity_in_grams: 500000, package_unit: "100 מיליליטר", original_product_name: "מים" }).grams).toBeNull();
  });
});

describe("item pricing", () => {
  const beef = { name: "בשר טחון טרי", quantity: "0.744 ק\"ג", ...pricingFields({ price: 79.9, packGrams: 1000, soldByWeight: true, grams: 744 }) };
  it("prices a weighed receipt amount by the kilo", () => {
    expect(beef.estimated_price).toBe(59.4);
    expect(beef.price_per_kg).toBe(79.9);
  });
  it("buys weighed products by the gram and packed ones in whole packs", () => {
    expect(purchaseCost(beef, 1800).cost).toBe(143.8);
    const cottage = pricingFields({ price: 6.5, packGrams: 250, soldByWeight: false, grams: 250 });
    expect(purchaseCost(cottage, 600)).toMatchObject({ cost: 19.5, packs: 3 });
  });
  it("rounds float pack weights (\"1.005 ליטר\")", () => {
    expect(pricingFields({ price: 11, packGrams: 1004.9999, soldByWeight: false, grams: 1004.9999 }).pack_grams).toBe(1005);
  });
  it("derives the weekly budget from the monthly one, or a higher accepted amount", () => {
    expect(weeklyBudget({ monthly_budget: 1400 })).toBe(327);
    expect(basketBudget({ monthly_budget: 1400 }, { accepted_budget: 360 })).toBe(360);
  });
});

describe("final list cost", () => {
  it("buys what the menu eats (+10%), rounded up to 100 g for weighed products", () => {
    const beef = { name: "בשר טחון טרי", category: "protein", quantity: "0.744 ק\"ג",
      ...pricingFields({ price: 79.9, packGrams: 1000, soldByWeight: true, grams: 744 }) };
    const days = [{ day_name: "Sunday", meals: [{ meal_type: "Lunch", items: [{ food_name: "בשר טחון טרי", grams: 1575 }] }] }];
    const list = buildFinalShoppingList([beef], days);
    expect(list.items[0]).toMatchObject({ purchase_grams: 1800, estimated_price: 143.8 });
    expect(list.total_estimated_cost).toBe(143.8);
  });
});
