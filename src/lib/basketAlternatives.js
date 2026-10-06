/**
 * Replacement options for a single item of the smart basket (step 2).
 *
 * Alternatives stay in the item's replacement family — the same kind of food
 * with the same culinary use and kosher type: cottage → another dairy product,
 * tuna → another fish, chicken → another meat, tofu → another plant protein,
 * rice → another carb, apple → another fruit. Within the family they are ranked
 * by how close their per-100g nutrition is to the original.
 * Each option is a real product looked up in the active Shufersal catalog —
 * nothing is invented. Options that conflict with the user's diet, allergies
 * or disliked foods, or that are already in the basket, are never offered.
 */

import { classifyProduct, normalizeHebrew, buildProductCatalog, portionCap } from "@/lib/mealPlanRules";
import { parseQuantityGrams, plausiblePer100g, buildDensities } from "@/lib/mealPlanCalories";
import { productHealthScore } from "@/lib/healthScore";

// Nutritional role of a basket item, from its meal-planning food group
const ROLE_BY_GROUP = {
  meat: "protein", fish: "protein", eggs: "protein", legumes: "protein",
  dairy_protein: "dairy", yogurt: "dairy",
  milk: "milk", plant_milk: "milk",
  grain: "carb", bread: "carb", starch_veg: "carb", cereal: "carb",
  vegetable: "vegetable",
  fruit: "fruit",
  nuts: "fat", tahini: "fat", oil: "fat", avocado: "fat",
};

const ROLE_LABELS = {
  protein: "מקור חלבון", dairy: "מוצר חלבי", milk: "משקה לבוקר ולקפה",
  carb: "מקור פחמימה", vegetable: "ירק", fruit: "פרי", fat: "מקור שומן בריא",
};

// Health score (0–10) of a basic, unprocessed product in each role

// Replacement family: an item is only replaced within its own family, so the
// food's culinary use and kosher type (meat / dairy / parve) never change.
const FAMILY_BY_GROUP = {
  meat: "meat_protein", fish: "fish_protein", eggs: "egg_protein", legumes: "plant_protein",
  dairy_protein: "dairy_protein", yogurt: "dairy_protein", milk: "milk", plant_milk: "plant_drink",
  grain: "carbohydrate", bread: "carbohydrate", starch_veg: "carbohydrate", cereal: "carbohydrate",
  vegetable: "vegetable", fruit: "fruit",
  nuts: "fat", tahini: "fat", oil: "fat", avocado: "fat",
};

// What the replacement dialog says it looks for
const FAMILY_LABELS = {
  meat_protein: "מקור חלבון בשרי דומה", fish_protein: "דג או מוצר דגים דומה", egg_protein: "חלופה דומה לביצים",
  plant_protein: "מקור חלבון צמחי דומה", dairy_protein: "מוצר חלבי דומה", milk: "חלב דומה",
  plant_drink: "משקה צמחי דומה", carbohydrate: "מקור פחמימה דומה", vegetable: "ירק אחר", fruit: "פרי אחר",
  fat: "מקור שומן בריא דומה",
};

const KOSHER_BY_GROUP = { meat: "meat", dairy_protein: "dairy", yogurt: "dairy", milk: "dairy" };
const kosherOf = group => KOSHER_BY_GROUP[group] || "parve";

/**
 * Candidate products, searched by name prefix in the Shufersal catalog.
 *   animal:   meat | fish | egg | dairy — for vegan/vegetarian/lactose rules
 *   allergens: matched against the profile's allergy labels
 *   gluten:   excluded for "ללא גלוטן" and wheat allergy
 *   skip:     product names that are prepared/flavored variants, not the staple
 *   grams:    package weight when the catalog has none (per-unit items)
 *   ref:      typical per-100g values for this product type
 *   family / group: explicit replacement family / food group when the name alone misleads
 */
const CANDIDATES = [
  // Protein sources
  { label: "חזה עוף", term: "חזה עוף", role: "protein", category: "protein", animal: "meat", skip: /פרוס|מעושן|ממולא|שניצל/ },
  { label: "חזה הודו", term: "חזה הודו טרי", role: "protein", category: "protein", animal: "meat" },
  { label: "בשר בקר טחון", term: "בשר בקר טחון", role: "protein", category: "protein", animal: "meat" },
  { label: "שוקיים עוף", term: "שוקיים עוף", role: "protein", category: "protein", animal: "meat",
    ref: { kcal: 175, protein: 21, carbs: 0, fat: 10 } },
  { label: "פילה סלמון", term: "פילה סלמון", role: "protein", category: "protein", animal: "fish", allergens: ["דגים"], skip: /מעושן/,
    ref: { kcal: 208, protein: 20, carbs: 0, fat: 13 } },
  { label: "טונה", term: "טונה במים", role: "protein", category: "protein", animal: "fish", allergens: ["דגים"],
    ref: { kcal: 116, protein: 26, carbs: 0, fat: 1 } },
  { label: "סרדינים", term: "סרדינים", role: "protein", category: "protein", animal: "fish", allergens: ["דגים"], skip: /חריף|רוטב/,
    ref: { kcal: 210, protein: 24, carbs: 0, fat: 12 } },
  { label: "פילה אמנון", term: "אמנון", role: "protein", category: "protein", animal: "fish", allergens: ["דגים"], skip: /שלם|עם עור|ג'מבו|ענק/,
    ref: { kcal: 96, protein: 20, carbs: 0, fat: 1.7 } },
  { label: "ביצים", term: "ביצים", role: "protein", category: "protein", animal: "egg", allergens: ["ביצים"], grams: 720, skip: /אטריות|נודלס|קרם|חלבון ביצה/ },
  { label: "טופו", term: "טופו", role: "protein", category: "protein", allergens: ["סויה"], skip: /קריספי|בטעם|מטוגן/ },
  { label: "עדשים", term: "עדשים", role: "protein", category: "protein", skip: /שימורי|מבושל|מרק/ },
  { label: "גרגירי חומוס", term: "גרגירי חומוס", role: "protein", category: "protein" },
  // Dense plant proteins (values as eaten: soaked / cooked)
  { label: "חלבון סויה מיובש", term: "חלבון סויה", group: "legumes", role: "protein", category: "protein", allergens: ["סויה"],
    ref: { kcal: 110, protein: 17, carbs: 6, fat: 1 } },
  { label: "פולי סויה", term: "פולי סויה", group: "legumes", role: "protein", category: "protein", allergens: ["סויה"],
    ref: { kcal: 173, protein: 17, carbs: 10, fat: 9 } },
  { label: "סייטן", term: "סייטן", group: "legumes", role: "protein", category: "protein", gluten: true, allergens: ["חיטה"],
    ref: { kcal: 140, protein: 25, carbs: 6, fat: 2 } },
  // explicit group: "לבנה" would otherwise read as the dairy spread
  { label: "שעועית לבנה", term: "שעועית לבנה", group: "legumes", role: "protein", category: "protein", skip: /מוקפאת|ברוטב/ },
  // Protein-rich dairy
  { label: "קוטג'", term: "קוטג", same: /קוטג/, role: "dairy", category: "dairy", animal: "dairy", allergens: ["חלב"], skip: /זיתים|שום|שמיר|פלפל|עם /, grams: 250,
    ref: { kcal: 98, protein: 11, carbs: 3.5, fat: 5 } },
  { label: "גבינה לבנה", term: "גבינה לבנה", role: "dairy", category: "dairy", animal: "dairy", allergens: ["חלב"], skip: /זיתים|שום|שמיר|עם |\+/,
    ref: { kcal: 96, protein: 9, carbs: 4, fat: 5 } },
  { label: "יוגורט חלבון", term: "יוגורט חלבון", role: "dairy", category: "dairy", animal: "dairy", allergens: ["חלב"], skip: /משקה|תות|וניל|\+/,
    ref: { kcal: 60, protein: 10, carbs: 4, fat: 0.5 } },
  { label: "יוגורט", term: "יוגורט", role: "dairy", category: "dairy", animal: "dairy", allergens: ["חלב"], skip: /עיזים|משקה|אננס|תות|בננ|וניל|פירות|חלבון|\+/,
    ref: { kcal: 70, protein: 4.5, carbs: 5, fat: 3 } },
  { label: "ריקוטה", term: "ריקוטה", role: "dairy", category: "dairy", animal: "dairy", allergens: ["חלב"], skip: /פרסקה/,
    ref: { kcal: 110, protein: 9, carbs: 4, fat: 5 } },
  { label: "לבנה", term: "לבנה", role: "dairy", category: "dairy", animal: "dairy", allergens: ["חלב"], skip: /זעתר|שמן|\+/,
    ref: { kcal: 160, protein: 7, carbs: 4, fat: 11 } },
  { label: "גבינה צהובה", term: "גבינה צהובה", role: "dairy", category: "dairy", animal: "dairy", allergens: ["חלב"], skip: /מגורדת/,
    ref: { kcal: 300, protein: 27, carbs: 1, fat: 21 } },
  // Milk / plant drinks
  { label: "חלב", term: "חלב 3%", role: "milk", category: "dairy", animal: "dairy", allergens: ["חלב"] },
  { label: "חלב 1%", term: "חלב 1%", role: "milk", category: "dairy", animal: "dairy", allergens: ["חלב"] },
  { label: "משקה סויה מועשר חלבון", term: "משקה סויה מועשר", group: "plant_milk", role: "milk", family: "plant_drink", category: "drink", allergens: ["סויה"],
    ref: { kcal: 45, protein: 3.5, carbs: 2, fat: 2 } },
  { label: "משקה סויה", term: "משקה סויה", role: "milk", family: "plant_drink", category: "drink", allergens: ["סויה"], skip: /שוקולד|וניל|קפה|אגוזי|GO/i, grams: 1000 },
  { label: "משקה שיבולת שועל", term: "משקה שיבולת שועל", role: "milk", family: "plant_drink", category: "drink", gluten: true, skip: /וניל|הקצפה|קקאו/ },
  // Carbs
  { label: "אורז מלא", term: "אורז מלא", role: "carb", category: "carb" },
  { label: "אורז", term: "אורז פרסי", role: "carb", category: "carb" },
  { label: "פסטה", term: "פסטה", role: "carb", category: "carb", gluten: true, allergens: ["חיטה"] },
  { label: "בורגול", term: "בורגול", role: "carb", category: "carb", gluten: true, allergens: ["חיטה"] },
  { label: "קינואה", term: "קינואה", role: "carb", category: "carb", skip: /טונה|\+/ },
  { label: "לחם מלא", term: "לחם מלא", role: "carb", category: "carb", gluten: true, allergens: ["חיטה"] },
  // Gluten-free breakfast carbs
  { label: "פריכיות אורז", term: "פריכיות אורז", group: "bread", role: "carb", category: "carb",
    ref: { kcal: 387, protein: 8, carbs: 81, fat: 3 } },
  { label: "פריכיות תירס", term: "פריכיות תירס", group: "bread", role: "carb", category: "carb",
    ref: { kcal: 380, protein: 8, carbs: 80, fat: 3 } },
  { label: "פיתות", term: "פיתות", group: "bread", role: "carb", category: "carb", gluten: true, allergens: ["חיטה"] },
  { label: "תפוחי אדמה", term: "תפוח אדמה", role: "carb", category: "carb", same: /תפוחי? אדמה/, skip: /מיקרו|יחידה|בייבי/ },
  { label: "בטטה", term: "בטטה", role: "carb", category: "carb", skip: /צ'?יפס|ציפס|קריספי|מוקפא|פריפלצת/ },
  { label: "שיבולת שועל", term: "שיבולת שועל מלאה", role: "carb", category: "carb", gluten: true },
  // Vegetables
  { label: "מלפפון", term: "מלפפון", role: "vegetable", category: "vegetable", skip: /חמוצ|בחומץ|כבוש/ },
  { label: "עגבנייה", term: "עגבניה", role: "vegetable", category: "vegetable", skip: /מרוסק|מקולפ|רסק|מיובש|רוטב/ },
  { label: "פלפל אדום", term: "פלפל אדום", role: "vegetable", category: "vegetable", skip: /קלוי|ממולא|חריף/ },
  { label: "גזר", term: "גזר", role: "vegetable", category: "vegetable", skip: /זרעים|קוריאני|גמדי|מוקפא|מיץ/ },
  { label: "ברוקולי", term: "ברוקולי", role: "vegetable", category: "vegetable" },
  { label: "קישוא", term: "קישוא", role: "vegetable", category: "vegetable", skip: /טעם|ממולא/ },
  { label: "כרובית", term: "כרובית", role: "vegetable", category: "vegetable" },
  { label: "חסה", term: "חסה", role: "vegetable", category: "vegetable", grams: 300 },
  // Fruits
  { label: "תפוח עץ", term: "תפוח עץ", role: "fruit", category: "fruit", same: /תפוח(ים)? עץ|תפוחים(?! ?אדמה)|^תפוח(?! ?אדמה|י אדמה)/, skip: /מיובש|רסק|מיץ|מחית/ },
  { label: "בננה", term: "בננה", role: "fruit", category: "fruit", skip: /מיובש|צ'?יפס/ },
  { label: "תפוז", term: "תפוז", role: "fruit", category: "fruit", skip: /מיץ/ },
  { label: "אגס", term: "אגס", role: "fruit", category: "fruit", skip: /מיץ|ספרינג/ },
  { label: "קלמנטינה", term: "קלמנטינה", role: "fruit", category: "fruit" },
  { label: "אפרסק", term: "אפרסק", role: "fruit", category: "fruit", skip: /חצאים|שימור|סירופ/ },
  // Healthy fats
  { label: "שמן זית", term: "שמן זית", role: "fat", category: "fat", skip: /תרסיס|ספריי/ },
  { label: "טחינה", term: "טחינה", role: "fat", category: "fat", skip: /חלבה|מתוק|קקאו/ },
  { label: "שקדים", term: "שקדים טבעי", role: "fat", category: "fat", allergens: ["אגוזים"] },
  { label: "אגוזי מלך", term: "אגוזי מלך", role: "fat", category: "fat", allergens: ["אגוזים"], skip: /שמן/ },
  { label: "אבוקדו", term: "אבוקדו", role: "fat", category: "fat", grams: 1000 },
  { label: "חמאת בוטנים", term: "חמאת בוטנים", role: "fat", category: "fat", allergens: ["בוטנים"], skip: /מתוק|שוקולד/ },
];

const candidateGroup = c => c.group || classifyProduct(c.label);
const familyOf = c => c.family || FAMILY_BY_GROUP[candidateGroup(c)] || null;

const has = (arr, ...vals) => vals.some(v => (arr || []).includes(v));

/** Whether a candidate breaks the user's diet or allergies. */
function violatesProfile(c, profile) {
  const diet = profile?.dietary_preferences || [];
  const allergies = profile?.allergies || [];
  if (has(diet, "vegan", "טבעוני") && c.animal) return true;
  if (has(diet, "vegetarian", "צמחוני") && ["meat", "fish"].includes(c.animal)) return true;
  if (has(diet, "ללא לקטוז") && c.animal === "dairy") return true;
  if ((has(diet, "ללא גלוטן") || has(allergies, "חיטה")) && c.gluten) return true;
  if (has(allergies, "פירות ים") && c.animal === "fish" && /שרימפ|קלמר/.test(c.label)) return true;
  return (c.allergens || []).some(a => allergies.includes(a));
}

// Supplements and powders are not meal ingredients — never basket food
const SUPPLEMENT = /ספירולינה|כלורלה|אבקת חלבון|חלבון מי גבינה|פרוטאין|protein|ויטמין|מולטי ויטמין|תוסף|קולגן|כמוסות|טבליות|כורכומין|אבקת סופרפוד|סופרפוד|גריל חלבון|whey|BCAA|קריאטין/i;
export const isSupplement = item => SUPPLEMENT.test(String(item?.name || ""));

// ─── Diet / allergy check for any basket or receipt item ────────────────────
const ANIMAL_BY_GROUP = { meat: "meat", fish: "fish", eggs: "egg", dairy_protein: "dairy", yogurt: "dairy", milk: "dairy" };
// Plant-based versions of dairy-looking products ("יוגורט סויה", "גבינה טבעונית")
const PLANT_BASED = /סויה|שקדים|שיבולת|קוקוס|צמחי|טבעוני|אורז/;
const GLUTEN = /לחם|פיתה|פיתות|פסטה|ספגטי|בורגול|קוסקוס|פתיתים|לחמני|טורטיה|באגט|חלה|קמח|אטריות|נודלס|סייטן|שיבולת שועל|קורנפלקס|גרנולה|עוגיות|עוגה|ופל|בייגל|קרקר/;
const ALLERGEN_NAMES = {
  "בוטנים": /בוטנ|במבה/, "אגוזים": /אגוז|שקד|קשיו|פקאן|פיסטוק|לוז/,
  "סויה": /סויה|טופו|אדממה/, "פירות ים": /שרימפ|קלמר|פירות ים|סרטן|לובסטר/,
};
const DIET_LABEL = { vegan: "הטבעונית", vegetarian: "הצמחונית" };

/**
 * Why an item cannot be in this user's basket, or null:
 * { kind: "allergy" | "diet", text } — allergies (milk, eggs, fish, wheat,
 * peanuts, nuts, soy, seafood) and diets (vegan, vegetarian, lactose-free,
 * gluten-free), from the item's food group and name.
 */
export function profileConflict(item, profile) {
  const name = String(item?.name || "");
  const diet = profile?.dietary_preferences || [];
  const allergies = profile?.allergies || [];
  const group = itemGroup({ name, category: item?.category });
  const animal = ANIMAL_BY_GROUP[group] === "dairy" && PLANT_BASED.test(name) ? null : ANIMAL_BY_GROUP[group];
  // Breads/cakes made from rice, corn or buckwheat (or labelled gluten-free) are fine
  const glutenFreeGrain = /ללא גלוטן|אורז|תירס|כוסמת/.test(name);
  const gluten = !glutenFreeGrain && (GLUTEN.test(name) || group === "bread");

  if (allergies.includes("חלב") && animal === "dairy") return { kind: "allergy", text: "מכיל אלרגן: חלב" };
  if (allergies.includes("ביצים") && animal === "egg") return { kind: "allergy", text: "מכיל אלרגן: ביצים" };
  if (allergies.includes("דגים") && animal === "fish") return { kind: "allergy", text: "מכיל אלרגן: דגים" };
  if (allergies.includes("חיטה") && gluten) return { kind: "allergy", text: "מכיל אלרגן: חיטה" };
  for (const [allergen, re] of Object.entries(ALLERGEN_NAMES)) {
    if (allergies.includes(allergen) && re.test(name)) return { kind: "allergy", text: `מכיל אלרגן: ${allergen}` };
  }
  if (has(diet, "vegan", "טבעוני") && (animal || /דבש/.test(name))) return { kind: "diet", text: `לא מתאים לתזונה ${DIET_LABEL.vegan} שלך` };
  if (has(diet, "vegetarian", "צמחוני") && ["meat", "fish"].includes(animal)) return { kind: "diet", text: `לא מתאים לתזונה ${DIET_LABEL.vegetarian} שלך` };
  if (has(diet, "ללא לקטוז") && animal === "dairy") return { kind: "diet", text: "מכיל לקטוז" };
  if (has(diet, "ללא גלוטן") && gluten) return { kind: "diet", text: "מכיל גלוטן" };
  return null;
}

// Disliked entries that mean a whole food family rather than one product
const DISLIKED_FAMILIES = [
  [/^(פירות|פרי|פרות)$/, "fruit"],
  [/^(ירקות|ירק)$/, "vegetable"],
  [/^(דגים|דג)$/, "fish"],
  [/^(בשר|עוף)$/, "meat"],
];

/**
 * Whether a product falls under the profile's "disliked foods" — by name
 * ("טונה", "בננה") or by family ("פירות" covers every fruit).
 */
export function isDisliked(name, disliked = [], group = classifyProduct(name)) {
  const n = normalizeHebrew(name);
  return disliked.some(d => {
    const term = normalizeHebrew(d);
    if (term.length < 2) return false;
    const family = DISLIKED_FAMILIES.find(([re]) => re.test(term))?.[1];
    if (family) return family === group;
    return n.includes(term);
  });
}

// Stem of a one-word label for fuzzy matching ("ביצים" → "ביצ" matches "ביצה", "בננה" → "בננות")
const stem = w => {
  const t = w.replace(/(ימ|ות|ה)$/, "");
  return t.length >= 3 ? t : w;
};

// Drinks and juices are never offered in place of a food (except in the milk role)
const DRINK_NAME = /מיץ|משקה|נקטר|תפוזינה|ליטר|מ"ל|מל(?![א-ת])/;

/** Whether a basket item name already refers to this candidate food. */
function mentions(name, c) {
  if (c.same) return c.same.test(name);
  const n = normalizeHebrew(name);
  const label = normalizeHebrew(c.label);
  if (n.includes(label)) return true;
  if (label.includes(" ")) return false;
  const s = stem(label);
  return s.length >= 3 && n.split(" ").some(w => w.startsWith(s));
}

// Package weight of a catalog product: per-kg items ("1") count as 1 kg,
// obviously wrong ml-scaled values are re-read from the name.
function packageGrams(p, c, group) {
  const q = Number(p.quantity_in_grams);
  if (q === 1) return 1000;
  if (q >= 50 && q <= 5000) return q;
  return parseQuantityGrams(p.original_product_name, group) || c.grams || null;
}

async function searchCandidate(c) {
  const params = new URLSearchParams({ q: c.term, match: "prefix", limit: "15" });
  const res = await fetch(`/api/products/search?${params}`, { credentials: "include" });
  if (!res.ok) return null;
  const { results = [], active_catalog_chain } = await res.json();
  const group = candidateGroup(c);
  const options = results
    .filter(p => p.price > 0 && !(c.skip && c.skip.test(p.original_product_name)))
    // (oils are sold by volume, so "מ״ל" is fine for the fat role)
    .filter(p => c.role === "milk" || c.role === "fat" || !DRINK_NAME.test(p.original_product_name))
    .map(p => {
      const grams = packageGrams(p, c, group);
      if (!grams) return null;
      // Catalog values are often a whole-category average (e.g. one figure for
      // every yogurt), so a candidate's typical values for its type win
      const per100 = c.ref ? { ...c.ref, source: "reference" } : plausiblePer100g({ name_he: p.original_product_name, group }, {
        kcal: p.calories_per_100g, protein: p.protein_per_100g, carbs: p.carbs_per_100g, fat: p.fat_per_100g,
      });
      if (!per100) return null;
      return { candidate: c, product: p, grams, per100, group, chain: p.chain || active_catalog_chain };
    })
    .filter(Boolean);
  if (!options.length) return null;
  // Household-size packages first; among those, the lowest price per 100 g wins
  const household = options.filter(o => o.grams <= 1500);
  return (household.length ? household : options).reduce((best, o) => (o.product.price / o.grams < best.product.price / best.grams ? o : best));
}

// Nutritional distance between two per-100g profiles: how far apart protein,
// calories, fat and carbs are (not "more protein is better")
function nutritionDistance(a, b) {
  return Math.abs(a.protein - b.protein) / 10 + Math.abs(a.kcal - b.kcal) / 100 +
    Math.abs(a.fat - b.fat) / 10 + Math.abs(a.carbs - b.carbs) / 20;
}

// Food group of a basket item. Packing liquids are ignored, so "טונה בשמן זית"
// is fish (a protein source), not oil.
const PACKING = /\s*ב(שמן( זית| קנולה| צמחי| סויה| חמניות)?|מים|מי מלח|רוטב[^,]*)(?=\s|$)/g;
function itemGroup(item) {
  const stripped = String(item.name || "").replace(PACKING, " ");
  const group = classifyProduct(stripped, item.category);
  return group === "other" ? classifyProduct(item.name, item.category) : group;
}

/** Per-100g values of an existing basket item (list totals ÷ package weight, or the group reference). */
function itemPer100g(item, group) {
  const grams = parseQuantityGrams(item.quantity, group);
  const f = grams ? 100 / grams : 0;
  return plausiblePer100g({ name_he: item.name, group }, f ? {
    kcal: item.calories * f, protein: (item.protein || 0) * f, carbs: (item.carbs || 0) * f, fat: (item.fat || 0) * f,
  } : null);
}

export function itemRole(item) {
  return ROLE_BY_GROUP[itemGroup(item)] || null;
}

/** The item's replacement family (see FAMILY_BY_GROUP), or null. */
export function itemFamily(item) {
  const name = String(item.name || "");
  if (/משקה (סויה|שיבולת|שקדים|אורז)/.test(name)) return "plant_drink";
  return FAMILY_BY_GROUP[itemGroup(item)] || null;
}

/**
 * Up to `max` replacement options for `item`, best match first.
 * Returns [] when the item has no replaceable role or nothing suitable exists.
 */
export async function findAlternatives(item, basketItems, profile, { max = 5 } = {}) {
  const family = itemFamily(item);
  if (!family) return [];
  const kosher = kosherOf(itemGroup(item));
  const disliked = profile?.disliked_foods || [];
  const others = basketItems.filter(b => b !== item);

  // Strict: same family and same kosher type only — never widened to another kind of food
  const eligible = CANDIDATES.filter(c =>
    familyOf(c) === family &&
    (c.family === "plant_drink" || kosherOf(candidateGroup(c)) === kosher) &&
    !violatesProfile(c, profile) &&
    !isDisliked(c.label, disliked, candidateGroup(c)) &&
    // never the same food again, never something already in the basket
    !mentions(item.name, c) &&
    !others.some(b => mentions(b.name, c))
  );

  const found = (await Promise.all(eligible.map(c => searchCandidate(c).catch(() => null))))
    .filter(Boolean)
    .filter(o => !isDisliked(o.product.original_product_name, disliked, o.group))
    .filter(o => !basketItems.some(b => normalizeHebrew(b.name) === normalizeHebrew(o.product.original_product_name)));

  const current = itemPer100g(item, itemGroup(item));
  const pricePer100 = o => o.product.price / o.grams * 100;
  // For protein foods: the daily protein the basket can still reach after the swap
  const proteinTarget = profile?.protein_target;
  const kcalTarget = profile?.daily_calories;
  const proteinFamily = ["meat_protein", "fish_protein", "egg_protein", "plant_protein", "dairy_protein"].includes(family);
  return found
    .map(o => {
      const option = { ...o, family };
      if (proteinFamily && proteinTarget && kcalTarget) {
        const swapped = basketItems.map(b => (b === item ? buildReplacementItem(o) : b));
        option.proteinAfter = proteinCeiling(swapped, kcalTarget);
        option.keepsProteinGoal = proteinReachable(option.proteinAfter, proteinTarget);
      }
      // closest per-100g nutrition first; price only breaks near-ties
      option.score = (current ? nutritionDistance(current, o.per100) : 0) + pricePer100(o) / 1000;
      return option;
    })
    // options that keep the protein goal reachable come first
    .sort((a, b) => Number(b.keepsProteinGoal ?? true) - Number(a.keepsProteinGoal ?? true) || a.score - b.score)
    .slice(0, max);
}

/**
 * The basket item for a chosen alternative. Built from the catalog product only,
 * so nothing (name, nutrition, price, score, catalog ids) is carried over from the replaced item.
 */
export function buildReplacementItem(option) {
  const role = ROLE_LABELS[option.candidate.role] || "מוצר";
  return catalogItem(option, { reason: `החלפה שבחרת — ${role} שמתאים לתפריט שלך.`, user_replaced: true });
}

function catalogItem(option, extra) {
  const { product: p, grams, per100, candidate: c } = option;
  const f = grams / 100;
  const round1 = v => Math.round(v * 10) / 10;
  return {
    name: p.original_product_name,
    category: c.category,
    quantity: grams >= 1000 && grams % 1000 === 0 ? `${grams / 1000} ק"ג` : `${Math.round(grams)} גרם`,
    estimated_price: p.price,
    calories: Math.round(per100.kcal * f),
    protein: round1(per100.protein * f),
    carbs: round1(per100.carbs * f),
    fat: round1(per100.fat * f),
    health_score: productHealthScore(p.original_product_name),
    ...extra,
    catalog_product_id: String(p.product_id),
    catalog_chain: option.chain,
    catalog_name: p.original_product_name,
    catalog_price: p.price,
    catalog_price_per_100g: Math.round(p.price / f * 100) / 100,
    catalog_calories_per_100g: p.calories_per_100g ?? null,
    catalog_protein_per_100g: p.protein_per_100g ?? null,
    catalog_carbs_per_100g: p.carbs_per_100g ?? null,
    catalog_fat_per_100g: p.fat_per_100g ?? null,
    nutrition_source: per100.source,
  };
}

/** Display name for an option card. */
export const optionLabel = o => o.candidate.label;
export const roleLabel = item => ROLE_LABELS[itemRole(item)] || null;
export const familyLabel = item => FAMILY_LABELS[itemFamily(item)] || null;

// ─── Basket staples ──────────────────────────────────────────────────────────
// A weekly menu can only use basket products, so a basket without bread/grains
// or a healthy fat cannot reach the calorie target. These needs are checked
// after the AI builds the basket and filled from the Shufersal catalog.
const STAPLE_NEEDS = [
  { groups: ["bread", "cereal"], count: 1, labels: ["לחם מלא", "פיתות", "שיבולת שועל", "פריכיות אורז", "פריכיות תירס"],
    reason: "הוספנו לחם לארוחות הבוקר והערב, כדי שהתפריט יגיע ליעד הקלורי שלך." },
  { groups: ["grain", "starch_veg"], count: 2, labels: ["אורז", "פסטה", "תפוחי אדמה", "בטטה", "אורז מלא", "בורגול", "קינואה"],
    reason: "הוספנו מקור פחמימה לארוחות הצהריים והערב, כדי שהתפריט יגיע ליעד הקלורי שלך." },
  { groups: ["oil", "tahini", "nuts"], count: 2, labels: ["שמן זית", "טחינה", "שקדים"],
    reason: "הוספנו מקור שומן בריא לבישול ולסלטים." },
];

/**
 * Real Shufersal products for the staple needs the basket is missing, as basket
 * items. Respects diet, allergies and disliked foods, and never duplicates a
 * product already in the basket. Returns [] when nothing is missing.
 */
export async function missingStaples(basketItems, profile, history = []) {
  const disliked = profile?.disliked_foods || [];
  const items = [...basketItems];
  const added = [];
  for (const need of STAPLE_NEEDS) {
    let have = items.filter(i => need.groups.includes(itemGroup(i))).length;
    for (const label of need.labels) {
      if (have >= need.count) break;
      const c = CANDIDATES.find(x => x.label === label);
      if (!c || violatesProfile(c, profile) || isDisliked(c.label, disliked, candidateGroup(c))) continue;
      if (items.some(b => mentions(b.name, c))) continue;
      const option = await searchCandidate(c).catch(() => null);
      if (!option || isDisliked(option.product.original_product_name, disliked, option.group)) continue;
      const item = catalogItem(option, { reason: need.reason, added_staple: true });
      items.push(item);
      added.push(item);
      have++;
    }
  }
  added.push(...await missingProtein(items, profile, history));
  return added;
}

// ─── Basket sufficiency ──────────────────────────────────────────────────────
// A weekly menu can only use basket products. These checks estimate whether
// the basket can feed the profile's targets at all, so a basket that cannot
// (e.g. a vegan basket with too few protein sources) is completed when built,
// and a remove/replace that would break it is flagged before it happens.

const MEAL_SHARE = { Breakfast: 0.25, Lunch: 0.35, Dinner: 0.27, Snacks: 0.13 };
// Share of a meal's calories its protein food may realistically take
const PROTEIN_FOOD_SHARE = 0.6;
const PROTEIN_SOURCES = new Set(["meat", "fish", "eggs", "dairy_protein", "yogurt", "legumes", "milk", "plant_milk"]);

/**
 * Highest daily protein (g) a realistic menu from these basket items can reach
 * within the calorie target: per meal, the most protein-dense product allowed
 * in it, at a realistic portion; the rest of the day adds ~3 g per 100 kcal.
 */
export function proteinCeiling(items, kcalTarget) {
  if (!kcalTarget) return null;
  const catalog = buildProductCatalog(items);
  const densities = buildDensities(catalog, { days: [] });
  let protein = 0;
  let kcalUsed = 0;
  for (const [meal, share] of Object.entries(MEAL_SHARE)) {
    const budget = kcalTarget * share * PROTEIN_FOOD_SHARE;
    let best = null;
    for (const p of catalog) {
      const d = densities.get(p.id);
      if (!PROTEIN_SOURCES.has(p.group) || !p.meal_roles?.includes(meal) || !d || d.kcal <= 0) continue;
      const grams = Math.min(portionCap(p) || 200, budget * 100 / d.kcal);
      const option = { protein: grams * d.protein / 100, kcal: grams * d.kcal / 100 };
      if (!best || option.protein > best.protein) best = option;
    }
    if (best) { protein += best.protein; kcalUsed += best.kcal; }
  }
  protein += Math.max(0, kcalTarget - kcalUsed) * 0.03;
  return Math.round(protein);
}

// The ceiling is an optimistic estimate (real menus land ~10% lower), so the
// basket needs a margin above the target for the menu to reach it day after day.
// One rule for the whole app: the replacement dialog and the basket check agree.
export const PROTEIN_MARGIN = 1.1;
export const proteinReachable = (ceiling, target) => ceiling >= target * PROTEIN_MARGIN;

/** Hebrew explanation for a basket whose protein ceiling misses the margin. */
export function proteinShortText(ceiling, target) {
  return ceiling >= target
    ? `עם המוצרים בסל החלבון יגיע בקושי ליעד (כ-${ceiling} גרם ביום, יעד ${target} גרם) — אין מספיק מרווח כדי שכל יום בתפריט יעמוד ביעד`
    : `עם המוצרים בסל אפשר להגיע לכ-${ceiling} גרם חלבון ביום — פחות מהיעד של ${target} גרם`;
}

/**
 * Can a good weekly menu be built from this basket for this profile?
 * Returns { ok, issues: [{ key, text }], proteinCeiling }.
 */
export function basketSufficiency(items, profile) {
  const groups = items.map(itemGroup);
  const count = set => groups.filter(g => set.includes(g)).length;
  const issues = [];
  if (!count(["bread", "cereal"])) issues.push({ key: "bread", text: "אין בסל לחם או דגני בוקר לארוחות הבוקר והערב" });
  if (!count(["grain", "starch_veg"])) issues.push({ key: "carb", text: "אין בסל אורז, פסטה או תפוחי אדמה לארוחות הצהריים והערב" });
  if (!count(["oil", "tahini", "nuts", "avocado"])) issues.push({ key: "fat", text: "אין בסל מקור שומן בריא (שמן זית, טחינה, אגוזים)" });
  const target = profile?.protein_target;
  const ceiling = proteinCeiling(items, profile?.daily_calories);
  if (target && ceiling != null && !proteinReachable(ceiling, target)) {
    issues.push({ key: "protein", text: proteinShortText(ceiling, target) });
  }
  return { ok: issues.length === 0, issues, proteinCeiling: ceiling };
}

/**
 * Real Shufersal protein sources to add when the basket cannot reach the
 * profile's protein target (at most 3, the ones that raise the ceiling most).
 * Respects diet, allergies, disliked foods and products already in the basket.
 * Purchase history only breaks near-ties (within 1 g of protein ceiling):
 * a product the user buys regularly wins over an equally useful one.
 */
async function missingProtein(basketItems, profile, history = []) {
  const target = profile?.protein_target;
  const kcal = profile?.daily_calories;
  if (!target || !kcal || proteinCeiling(basketItems, kcal) >= target * 1.2) return [];
  const disliked = profile?.disliked_foods || [];
  const eligible = CANDIDATES.filter(c =>
    (["protein", "dairy"].includes(c.role) || c.label === "משקה סויה מועשר חלבון") &&
    !violatesProfile(c, profile) &&
    !isDisliked(c.label, disliked, candidateGroup(c)) &&
    !basketItems.some(b => mentions(b.name, c)));
  const options = (await Promise.all(eligible.map(c => searchCandidate(c).catch(() => null))))
    .filter(o => o && !isDisliked(o.product.original_product_name, disliked, o.group))
    .map(o => catalogItem(o, { reason: "הוספנו מקור חלבון כדי שהתפריט יגיע ליעד החלבון שלך.", added_staple: true }));
  // 0.5 = neutral (no history), so without history the order is unchanged
  const historyScore = o => history.find(h => mentions(h.name, { label: o.name }) || mentions(o.name, { label: h.name }))?.history_score ?? 0.5;
  const items = [...basketItems];
  const added = [];
  for (let n = 0; n < 3 && proteinCeiling(items, kcal) < target * 1.2; n++) {
    let best = null;
    for (const o of options) {
      if (added.includes(o)) continue;
      const gain = proteinCeiling([...items, o], kcal);
      const h = historyScore(o);
      const better = !best ||
        (Math.abs(gain - best.gain) < 1 && h !== best.h ? h > best.h
          : gain > best.gain || (gain === best.gain && o.estimated_price < best.item.estimated_price));
      if (better) best = { item: o, gain, h };
    }
    if (!best || best.gain <= proteinCeiling(items, kcal)) break;
    items.push(best.item);
    added.push(best.item);
  }
  return added;
}
