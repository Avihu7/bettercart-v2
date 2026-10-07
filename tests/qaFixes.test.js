/**
 * Regressions found in the full-flow QA (receipt → basket → menu → final list).
 */
import { describe, it, expect } from "vitest";
import { classifyReceiptLine } from "@/lib/receiptClassifier";
import { matchPatch } from "@/lib/receiptReview";
import { pricingFields } from "@/lib/pricing";
import { changeBudgetImpact } from "@/lib/basketBudget";
import { generateCandidates } from "@/lib/menuCandidates";
import { generateNutritionPlan } from "@/lib/nutritionPlanGenerator";
import { buildProductCatalog, classifyProduct } from "@/lib/mealPlanRules";
import { buildDensities } from "@/lib/mealPlanCalories";
import { weeklyBudget } from "@/lib/pricing";
import { BASKETS, ITEMS as I, P } from "./fixtures/baskets";

describe("receipt reading", () => {
  it("tuna in oil is a protein, not a fat", () => {
    expect(classifyReceiptLine({ normalized_name: "טונה בשמן" }).category).toBe("protein");
  });
  it("a catalog name that is another product (pickles, green onion) is never a confident match", () => {
    const match = name => ({ matched: true, matched_product_id: "1", matched_name: name, match_type: "partial", needs_review: false, match_confidence: 0.9, category: "vegetable" });
    const item = name => ({ normalized_name: name, original_name: name, category: "vegetable" });
    expect(matchPatch(item("מלפפונים"), match("מלפפונים במלח 7-9 5")).catalog_match_status).toBe("needs_review");
    expect(matchPatch(item("בצל"), match("בצל ירוק כשר")).catalog_match_status).toBe("needs_review");
    expect(matchPatch(item("מלפפונים"), match("מלפפונים")).catalog_match_status).toBe("matched");
  });
  it("one 170 g yogurt is one 150 g catalog pack, not two", () => {
    expect(pricingFields({ price: 5.9, packGrams: 150, soldByWeight: false, grams: 170 }).estimated_price).toBe(5.9);
  });
});

describe("menu realism", () => {
  it("onion, garlic and lemon are never a salad vegetable at breakfast", () => {
    const items = [I.bread, I.cottage, I.cucumber, P("בצל", "vegetable", 4.9, 1000, [40, 1.1, 9, 0.1], { weighed: true }), I.chicken, I.rice, I.banana];
    const catalog = buildProductCatalog(items);
    const candidates = generateCandidates({ catalog, densities: buildDensities(catalog, { days: [] }), profile: BASKETS.rich.profile });
    expect(candidates.Breakfast.flatMap(c => c.meal.items.map(i => i.food_name))).not.toContain("בצל");
  });

  it.each(["real", "rich", "kosher", "expensive"])("%s: no egg/dairy meal served with pasta, rice or potato, no oil in a yogurt breakfast", async label => {
    const { items, profile } = BASKETS[label];
    const plan = await generateNutritionPlan({ list: { items }, profile, budget: weeklyBudget(profile) });
    for (const d of plan.days) for (const m of d.meals) {
      const groups = m.items.map(i => classifyProduct(i.food_name));
      const main = groups.find(g => ["meat", "fish", "legumes", "eggs", "dairy_protein", "yogurt"].includes(g));
      if ((m.meal_type === "Lunch" || m.meal_type === "Dinner") && ["eggs", "dairy_protein"].includes(main)) {
        expect(groups.filter(g => ["grain", "starch_veg"].includes(g)), `${d.day_name} ${m.meal_name}`).toEqual([]);
      }
      if (m.meal_type === "Breakfast" && !groups.includes("bread") && !groups.includes("vegetable")) {
        expect(groups.filter(g => ["oil", "tahini"].includes(g)), `${d.day_name} ${m.meal_name}`).toEqual([]);
      }
    }
  });
});

describe("manual change warning", () => {
  const basket = [I.chicken, I.rice, I.tomato];
  const days = [{ day_name: "Sunday", meals: [{ meal_type: "Lunch", items: [{ food_name: I.chicken.name, grams: 1400 }, { food_name: I.rice.name, grams: 700 }] }] }];

  it("prices a replacement at the old product's weekly amount and warns when it goes over budget", () => {
    const salmon = { ...I.salmon };
    const impact = changeBudgetImpact({ basketItems: basket, newItems: [salmon, I.rice, I.tomato], planDays: days, limit: 100,
      replaced: { from: I.chicken.name, to: salmon.name } });
    expect(impact.verb).toBe("החלפת המוצר");
    expect(impact.increase).toBeGreaterThan(100);
    expect(impact.over).toBeGreaterThan(0);
  });
  it("says nothing when the change saves money or stays within budget", () => {
    expect(changeBudgetImpact({ basketItems: basket, newItems: [I.lentils, I.rice, I.tomato], planDays: days, limit: 100,
      replaced: { from: I.chicken.name, to: I.lentils.name } })).toBeNull();
    expect(changeBudgetImpact({ basketItems: basket, newItems: [...basket, I.banana], limit: 1000, added: I.banana })).toBeNull();
  });
  it("warns for added products without a menu, by the basket's prices", () => {
    const impact = changeBudgetImpact({ basketItems: basket, newItems: [...basket, I.salmon, I.cashew], limit: 60, added: [I.salmon, I.cashew] });
    expect(impact).toMatchObject({ verb: "הוספת המוצרים" });
    expect(impact.total).toBeGreaterThan(60);
  });
});
