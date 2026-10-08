/**
 * Regression: every generated day has breakfast, lunch and dinner.
 * (A vegan basket with bread, nut butter, nuts and fruit but no tofu/cheese/
 * eggs/yogurt/cereal produced no breakfast at all — no breakfast pattern
 * worked without a protein food, and "3+ meals a day" passed on L+D+S.)
 */
import { describe, it, expect } from "vitest";
import { generateNutritionPlan } from "@/lib/nutritionPlanGenerator";
import { validateMenu } from "@/lib/validateMenu";
import { weeklyPenalty } from "@/lib/mealScoring";
import { weeklyBudget } from "@/lib/pricing";
import { classifyProduct } from "@/lib/mealPlanRules";
import { BASKETS, BASE_PROFILE, P, ITEMS as I } from "./fixtures/baskets";

const SLOTS = ["Breakfast", "Lunch", "Dinner"];
const missingSlots = plan => plan.days.flatMap(d => SLOTS.filter(t => !d.meals.some(m => m.meal_type === t && m.items.length)).map(t => `${d.day_name}/${t}`));

// The vegan account's rebuilt basket (2026-10-07): no breakfast protein at all
const VEGAN_NO_BREAKFAST_PROTEIN = [
  P("עגבניות חתוכות דק400*3ג", "vegetable", 12.9, 1200, [20, 1, 4, 0.2]),
  P("מלפפון", "vegetable", 8.9, 1000, [15, 0.7, 3.6, 0.1], { weighed: true }),
  P("חמאת בוטנים טבעית 510 גר", "fat", 9.9, 510, [600, 25, 15, 50]),
  P("חסה קטיף כהלכה", "vegetable", 6.9, 300, [15, 1.4, 2.9, 0.2]),
  P("גרגירי חומוס מוקפאים 800", "protein", 9.9, 800, [140, 8, 22, 2.5]),
  P("גזר ארוז", "vegetable", 3.9, 1000, [41, 0.9, 10, 0.2], { weighed: true }),
  P("סייטן בסגנון טבעי 500 גר", "protein", 19.9, 500, [140, 25, 6, 2]),
  P("שעועית לבנה מבושלת אחלה 400 גרם", "protein", 5.9, 400, [110, 7, 18, 0.5]),
  P("פיתות מרקם מיוחד8 אקספרס", "carb", 12.5, 800, [270, 9, 55, 1.2]),
  P("תפוח אדמה 1 ק\"ג", "carb", 5.9, 1000, [80, 2, 17, 0.1]),
  P("פסטה ספרלה \"יש\" 500 גרם", "carb", 2.9, 500, [360, 12, 72, 1.5]),
  P("אגוזי מלך 200 גרם", "fat", 15.9, 200, [650, 15, 14, 65]),
  P("קלמנטינה", "fruit", 4.9, 1000, [47, 0.9, 12, 0.1], { weighed: true }),
  P("תפוח עץ סטרקינג*מולדבה", "fruit", 7.9, 1000, [52, 0.3, 14, 0.2], { weighed: true }),
];
const VEGAN_PROFILE = { ...BASE_PROFILE, dietary_preferences: ["טבעוני"], daily_calories: 1462, protein_target: 113, fat_target: 49, carbs_target: 142, monthly_budget: 1700 };

describe("every day has breakfast, lunch and dinner", () => {
  it("the vegan basket without a breakfast protein still gets a breakfast every day", async () => {
    const plan = await generateNutritionPlan({ list: { items: VEGAN_NO_BREAKFAST_PROTEIN }, profile: VEGAN_PROFILE, budget: weeklyBudget(VEGAN_PROFILE) });
    expect(missingSlots(plan)).toEqual([]);
    // a vegan, realistic breakfast: bread or fruit, with a spread or nuts — no animal products
    for (const d of plan.days) {
      const groups = d.meals.find(m => m.meal_type === "Breakfast").items.map(i => classifyProduct(i.food_name));
      expect(groups.some(g => ["bread", "fruit"].includes(g)), d.day_name).toBe(true);
      for (const g of ["meat", "fish", "eggs", "dairy_protein", "yogurt", "milk"]) expect(groups).not.toContain(g);
    }
    const v = validateMenu({ plan, basketItems: VEGAN_NO_BREAKFAST_PROTEIN, profile: VEGAN_PROFILE, budget: weeklyBudget(VEGAN_PROFILE) });
    expect(v.failed).not.toContain("meal_slots");
    // QA round 7: a valid menu (not level 4) — no token second legume (35 g seitan beside beans)
    expect(v.level).toBeLessThan(4);
    const tiny = plan.days.flatMap(d => d.meals.flatMap(m => m.items.filter(i => classifyProduct(i.food_name) === "legumes" && i.grams < 50).map(i => `${d.day_name}/${m.meal_type} ${i.food_name} ${i.grams}g`)));
    expect(tiny).toEqual([]);
  });

  it.each(Object.entries(BASKETS).filter(([, b]) => b.adequate))("%s basket: breakfast, lunch and dinner every day", async (label, { items, profile }) => {
    const plan = await generateNutritionPlan({ list: { items }, profile, budget: weeklyBudget(profile) });
    expect(missingSlots(plan)).toEqual([]);
  });

  it("the validator fails a week with a missing breakfast", () => {
    const meal = (type, item) => ({ meal_type: type, meal_name: "ארוחה", items: [{ food_name: item.name, grams: 100, calories: 0, protein: 0, carbs: 0, fat: 0 }] });
    const plan = { days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(day_name => ({ day_name,
      meals: [meal("Lunch", I.chicken), meal("Dinner", I.lentils), meal("Snacks", I.banana)] })) };
    const v = validateMenu({ plan, basketItems: [I.chicken, I.lentils, I.banana, I.rice, I.tomato, I.bread], profile: { dietary_preferences: [] } });
    expect(v.failed).toContain("meal_slots");
    expect(v.level).toBe(4);
  });

  it("(sanity) the weekly penalty is unchanged by an empty slot", () => {
    expect(weeklyPenalty([[null, null, null, null]], { W: {}, kcal: 2000 }).penalty).toBe(0);
  });
});
