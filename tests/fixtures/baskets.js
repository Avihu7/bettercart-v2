/**
 * Test baskets — fixed inputs for the algorithm tests (no catalog, no network).
 * Prices are Shufersal-like; nutrition per 100 g is typical for the food.
 * Each basket comes with the profile it is meant to exercise.
 */
import { pricingFields } from "@/lib/pricing";
import real from "./real-basket.json";

/**
 * A basket item: name, category, pack price (or ₪/kg when weighed), pack
 * grams, per-100g kcal/protein/carbs/fat.
 */
export function P(name, category, price, grams, per100, { weighed = false } = {}) {
  const [kcal, protein, carbs, fat] = per100;
  const f = grams / 100;
  return {
    name, category, quantity: grams >= 1000 && grams % 1000 === 0 ? `${grams / 1000} ק"ג` : `${grams} גרם`,
    calories: Math.round(kcal * f), protein: protein * f, carbs: carbs * f, fat: fat * f,
    ...pricingFields({ price, packGrams: grams, soldByWeight: weighed, grams }),
  };
}

const W = { weighed: true };
export const ITEMS = {
  chicken: P("חזה עוף טרי", "protein", 32.9, 1000, [110, 23, 0, 1.5]),
  beef: P("בשר בקר טחון טרי", "protein", 79.9, 1000, [250, 17, 0, 20], W),
  turkey: P("חזה הודו טרי", "protein", 54.9, 1000, [110, 24, 0, 1], W),
  tuna: P("טונה במים", "protein", 29.9, 640, [116, 26, 0, 1]),
  salmon: P("פילה סלמון", "protein", 119.9, 1000, [208, 20, 0, 13], W),
  eggs: P("ביצים L 12 יחידות", "protein", 13.9, 720, [155, 13, 1.1, 11]),
  lentils: P("עדשים ירוקות", "protein", 8.9, 500, [350, 24, 60, 1]),
  chickpeas: P("גרגירי חומוס", "protein", 9.9, 500, [360, 19, 61, 6]),
  tofu: P("טופו במרקם קשה", "protein", 13.9, 300, [120, 13, 2, 7]),
  cottage: P("גבינת קוטג 5%", "dairy", 6.1, 250, [95, 11, 3, 5]),
  whiteCheese: P("גבינה לבנה 5%", "dairy", 5.9, 250, [96, 9, 4, 5]),
  yellowCheese: P("גבינה צהובה 28%", "dairy", 89.9, 1000, [350, 25, 1, 27], W),
  yogurt: P("יוגורט 3%", "dairy", 4.9, 200, [70, 4.5, 5, 3]),
  milk: P("חלב 3% 1 ליטר", "dairy", 6.9, 1000, [61, 3.2, 4.8, 3.3]),
  soyDrink: P("משקה סויה", "drink", 12.9, 1000, [30, 1, 1.5, 2.5]),
  rice: P("אורז פרסי", "carb", 9.9, 1000, [360, 7, 79, 0.6]),
  pasta: P("פסטה פנה", "carb", 5.9, 500, [360, 12, 72, 1.5]),
  quinoa: P("קינואה", "carb", 24.9, 500, [370, 14, 64, 6]),
  bread: P("לחם מלא", "carb", 15.9, 750, [250, 9, 45, 3]),
  pita: P("פיתות", "carb", 9.9, 500, [270, 9, 55, 1.2]),
  oats: P("שיבולת שועל", "carb", 8.9, 500, [380, 13, 60, 7]),
  potato: P("תפוח אדמה", "carb", 5.9, 1000, [80, 2, 17, 0.1], W),
  tomato: P("עגבניות", "vegetable", 9.9, 1000, [18, 0.9, 3.9, 0.2], W),
  cucumber: P("מלפפון", "vegetable", 5.9, 1000, [15, 0.7, 3.6, 0.1], W),
  pepper: P("פלפל אדום", "vegetable", 12.9, 1000, [31, 1, 6, 0.3], W),
  carrot: P("גזר", "vegetable", 4.9, 1000, [41, 0.9, 10, 0.2], W),
  lettuce: P("חסה", "vegetable", 6.9, 300, [15, 1.4, 2.9, 0.2]),
  broccoli: P("ברוקולי", "vegetable", 14.9, 1000, [34, 2.8, 7, 0.4], W),
  banana: P("בננה", "fruit", 5.9, 1000, [89, 1.1, 23, 0.3], W),
  apple: P("תפוח עץ", "fruit", 9.9, 1000, [52, 0.3, 14, 0.2], W),
  orange: P("תפוז", "fruit", 6.9, 1000, [47, 0.9, 12, 0.1], W),
  berries: P("אוכמניות", "fruit", 24.9, 250, [57, 0.7, 14, 0.3]),
  oil: P("שמן זית", "fat", 34.9, 750, [884, 0, 0, 100]),
  tahini: P("טחינה גולמית", "fat", 14.9, 500, [600, 17, 21, 54]),
  almonds: P("שקדים טבעיים", "fat", 19.9, 200, [580, 21, 20, 50]),
  cashew: P("קשיו טבעי", "fat", 34.9, 200, [553, 18, 30, 44]),
  avocado: P("אבוקדו", "fat", 18.9, 1000, [160, 2, 9, 15], W),
  coffee: P("קפה נמס", "drink", 24.9, 200, [2, 0.2, 0, 0]),
};
const I = ITEMS;

export const BASE_PROFILE = {
  daily_calories: 2200, protein_target: 140, carbs_target: 250, fat_target: 70,
  monthly_budget: 1400, dietary_preferences: [], allergies: [], favorite_foods: [], disliked_foods: [],
};

/** The test baskets: { label, items, profile, adequate } — adequate: enough food for a full week. */
export const BASKETS = {
  rich: {
    items: [I.chicken, I.beef, I.tuna, I.eggs, I.lentils, I.cottage, I.yogurt, I.milk, I.rice, I.pasta, I.bread, I.oats, I.potato,
      I.tomato, I.cucumber, I.pepper, I.carrot, I.lettuce, I.banana, I.apple, I.orange, I.oil, I.tahini, I.almonds, I.avocado, I.coffee],
    profile: BASE_PROFILE, adequate: true,
  },
  limited: {
    items: [I.chicken, I.cottage, I.rice, I.bread, I.cucumber, I.tomato, I.banana, I.oil],
    profile: BASE_PROFILE, adequate: true,
  },
  vegan: {
    items: [I.tofu, I.lentils, I.chickpeas, I.rice, I.pasta, I.bread, I.oats, I.soyDrink, I.tomato, I.cucumber, I.carrot,
      I.banana, I.apple, I.tahini, I.oil, I.almonds],
    profile: { ...BASE_PROFILE, dietary_preferences: ["טבעוני"], protein_target: 120, daily_calories: 2000, fat_target: 65 },
    adequate: true,
  },
  vegetarian: {
    items: [I.eggs, I.cottage, I.whiteCheese, I.yogurt, I.lentils, I.chickpeas, I.rice, I.pasta, I.bread, I.oats, I.milk,
      I.tomato, I.cucumber, I.pepper, I.banana, I.apple, I.oil, I.tahini],
    profile: { ...BASE_PROFILE, dietary_preferences: ["צמחוני"], protein_target: 120 },
    adequate: true,
  },
  kosher: {
    items: [I.chicken, I.beef, I.cottage, I.yogurt, I.eggs, I.rice, I.bread, I.potato, I.tomato, I.cucumber, I.pepper,
      I.banana, I.apple, I.oil, I.tahini, I.milk, I.coffee],
    profile: { ...BASE_PROFILE, dietary_preferences: ["כשר"] },
    adequate: true,
  },
  allergies: {
    // the basket has nuts and fish; the profile is allergic to both
    items: [I.chicken, I.tuna, I.salmon, I.eggs, I.cottage, I.lentils, I.rice, I.bread, I.pasta, I.tomato, I.cucumber, I.carrot,
      I.banana, I.apple, I.almonds, I.cashew, I.oil],
    profile: { ...BASE_PROFILE, allergies: ["אגוזים", "דגים"] },
    adequate: true,
  },
  expensive: {
    items: [I.salmon, I.beef, I.turkey, I.yellowCheese, I.quinoa, I.bread, I.broccoli, I.pepper, I.lettuce, I.berries, I.avocado,
      I.cashew, I.oil, I.eggs],
    profile: { ...BASE_PROFILE, monthly_budget: 900 },
    adequate: true,
  },
  tiny: {
    items: [I.chicken, I.rice, I.tomato],
    profile: BASE_PROFILE, adequate: false,
  },
  real: {
    items: real.items,
    profile: real.profile,
    adequate: true,
  },
};
