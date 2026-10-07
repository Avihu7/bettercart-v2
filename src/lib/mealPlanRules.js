/**
 * Meal-role rules for nutrition-plan generation.
 *
 * Shopping-list items are classified by their Hebrew name into a food group,
 * which determines the meal slots the item naturally belongs to and whether it
 * is meat / dairy / parve (for meat–dairy separation). The same rules are used
 * to build the AI prompt catalog and to validate the AI's plan afterwards.
 */

export const MEAL_TYPES = ["Breakfast", "Lunch", "Dinner", "Snacks"];

// Order matters: the first matching group wins (e.g. "קפה" before "חלב" so
// "קפה עם חלב" style names classify as coffee; "חמאת בוטנים" before dairy).
const GROUPS = [
  // Plant drinks before nuts/legumes/milk: "חלב שקדים" is a drink, not almonds or dairy
  { group: "plant_milk", terms: ["חלב שקדים", "משקה שקדים", "חלב סויה", "משקה סויה", "חלב שיבולת", "משקה שיבולת", "חלב אורז", "משקה אורז", "חלב קוקוס", "משקה קוקוס"] },
  { group: "coffee",    terms: ["קפה", "נס קפה", "אספרסו"] },
  { group: "tea",       terms: [" תה "] },
  { group: "nuts",      terms: ["שקד", "אגוז", "קשיו", "פיסטוק", "בוטנים", "גרעינים", "צימוקים", "תמרים"] },
  { group: "tahini",    terms: ["טחינה"] },
  { group: "oil",       terms: ["שמן"] },
  { group: "cereal",    terms: ["קורנפלקס", "גרנולה", "שיבולת שועל", "דגני בוקר", "קוואקר", "מוזלי"] },
  { group: "yogurt",    terms: ["יוגורט", "מעדן", "אקטיביה", "יופלה", "דנונה"] },
  // Legumes before dairy cheeses: "שעועית לבנה" (white beans) is not "לבנה" (labneh)
  { group: "legumes",   terms: ["עדשים", "חומוס", "שעועית", "אפונה", "פול", "טופו", "סויה", "סייטן"] },
  { group: "dairy_protein", terms: ["קוטג", "גבינ", "לבנה", "בולגרית", "צפתית", "ריקוטה", "מוצרלה", "שמנת", "חמאה"] },
  // Name only: categories like "חלבון חלבי" contain "חלב" but aren't milk.
  // " שוקו " as a whole word, so "שוקולד" is not read as chocolate milk
  { group: "milk",      terms: ["חלב", " שוקו "], nameOnly: true },
  { group: "eggs",      terms: ["ביצ", "חביתה", "שקשוקה"] },
  { group: "fish",      terms: ["סלמון", "דג", "טונה", "אמנון", "מושט", "בקלה", "סרדין"] },
  { group: "meat",      terms: ["עוף", "הודו", "בקר", "בשר", " כבש ", "שניצל", "קבב", "המבורגר", "פרגית", "שוקיים", "כרעיים", "נקניק"] },
  { group: "bread",     terms: ["לחם", "פיתה", "פיתות", "לחמני", "טורטיה", "באגט", "חלה", "פריכיות", "טוסט", "כריך", "סנדוויץ"] },
  { group: "grain",     terms: ["אורז", "פסטה", "ספגטי", "פתיתים", "קוסקוס", "בורגול", "קינואה", "אטריות", "נודלס"] },
  { group: "starch_veg", terms: ["תפוחי אדמה", "תפוח אדמה", "בטט", "תירס"] },
  // Avocado is a fat, eaten on bread or in a salad — not a sweet fruit snack
  { group: "avocado",   terms: ["אבוקדו"] },
  { group: "fruit",     terms: ["בננ", "תפוח", "תפוז", "אגס", "ענב", "אבטיח", "מלון", "קלמנטינ", "תות", "אפרסק", "מנגו", "אננס", "פרי", "פירות"] },
  { group: "vegetable", terms: ["עגבני", "מלפפון", "ברוקולי", "גזר", "פלפל", "חסה", "בצל", "כרוב", "קישוא", "חציל", "תרד", "ירק", "סלט", "פטרי", "כרובית", "סלק"] },
];

// Natural meal slots per group (Problem 4 in the spec). Lunch may also be a
// dairy/egg meal (shakshuka, an omelette or cheese with bread and salad) —
// kosher separation and one main protein per plate still apply.
const ROLES = {
  coffee:        ["Breakfast", "Snacks"],
  tea:           ["Breakfast", "Snacks"],
  milk:          ["Breakfast"],
  plant_milk:    ["Breakfast"],
  cereal:        ["Breakfast"],
  bread:         ["Breakfast", "Lunch", "Dinner"],
  eggs:          ["Breakfast", "Lunch", "Dinner"],
  dairy_protein: ["Breakfast", "Lunch", "Dinner"],
  yogurt:        ["Breakfast", "Dinner", "Snacks"],
  meat:          ["Lunch"],
  fish:          ["Lunch", "Dinner"],
  legumes:       ["Lunch", "Dinner"],
  grain:         ["Lunch", "Dinner"],
  starch_veg:    ["Lunch", "Dinner"],
  vegetable:     ["Breakfast", "Lunch", "Dinner"],
  fruit:         ["Breakfast", "Snacks"],
  avocado:       ["Breakfast", "Lunch", "Dinner"],
  nuts:          ["Snacks", "Breakfast"],
  tahini:        ["Lunch", "Dinner", "Breakfast"],
  oil:           ["Lunch", "Dinner", "Breakfast"],
  other:         ["Breakfast", "Lunch", "Dinner", "Snacks"],
};

// Groups that must never appear in a snack (plain milk, plain bread, raw
// staples, cooking fats, main proteins). Coffee is a drink, not a snack food.
const NOT_SNACK = new Set(["milk", "plant_milk", "bread", "grain", "starch_veg", "meat", "fish", "legumes", "oil", "tahini", "cereal", "eggs", "avocado"]);
// Realistic single-meal portion ceilings (grams) per food group.
const PORTION_CAP = {
  bread: 150, cereal: 100, milk: 300, plant_milk: 300, yogurt: 250, dairy_protein: 250, eggs: 200,
  meat: 300, fish: 250, legumes: 250, grain: 300, starch_veg: 350, vegetable: 300,
  fruit: 250, avocado: 100, nuts: 60, tahini: 60, oil: 25, coffee: 20, tea: 10,
};
const HARD_CHEESE = /צהוב|מוצרלה|בולגרית|צפתית|פרמזן/;

export function portionCap(product) {
  if (product.group === "dairy_protein" && HARD_CHEESE.test(product.name_he)) return 100;
  return PORTION_CAP[product.group];
}

const MAIN_PROTEIN = new Set(["meat", "fish", "eggs", "dairy_protein", "legumes", "yogurt"]);
const MAIN_BASE = new Set(["bread", "grain", "starch_veg", "vegetable", "cereal"]);
const DRINKS = new Set(["coffee", "tea", "milk", "plant_milk"]);
// Milk and plant milks belong in coffee/tea or with cereal/oats, not beside other food
const MILK_PARTNERS = new Set(["coffee", "tea", "cereal"]);
const hasMilkWithoutPartner = groups =>
  groups.some(g => g === "milk" || g === "plant_milk") && !groups.some(g => MILK_PARTNERS.has(g));
const DAIRY = new Set(["milk", "yogurt", "dairy_protein"]);

// Final letter forms (ך ם ן ף ץ) → regular, so "מלפפון" matches "מלפפונים"
const FINALS = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };
const unfinal = s => s.replace(/[ךםןףץ]/g, c => FINALS[c]);

export function normalizeHebrew(s) {
  return unfinal(String(s || ""))
    .replace(/[׳'`´"״]/g, "")
    .replace(/[-–—,()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function classifyProduct(name, category = "") {
  const nameText = ` ${normalizeHebrew(name)} `;
  const fullText = `${nameText}${normalizeHebrew(category)} `;
  for (const { group, terms, nameOnly } of GROUPS) {
    const text = nameOnly ? nameText.replace(/חלבונ/g, "") : fullText;
    if (terms.some(t => text.includes(unfinal(t)))) return group;
  }
  return "other";
}

function kosherType(group) {
  if (group === "meat") return "meat";
  if (DAIRY.has(group)) return "dairy";
  return "parve";
}

/**
 * Builds the product catalog sent to the AI and used for validation.
 * IDs are generated dynamically (p1, p2, …) — no DB schema change needed.
 */
export function buildProductCatalog(items) {
  return items.map((item, i) => {
    const group = classifyProduct(item.name, item.category);
    return {
      id: `p${i + 1}`,
      name_he: item.name,
      category: item.category || "",
      quantity: item.quantity || "",
      group,
      // Tofu (scramble) and canned tuna (on bread) are also breakfast foods
      meal_roles: (group === "legumes" && /טופו/.test(item.name)) || (group === "fish" && /טונה/.test(item.name))
        ? ["Breakfast", ...ROLES[group]] : ROLES[group],
      kosher: kosherType(group),
      // per-list totals, used by the AI to estimate per-portion macros
      calories: item.calories,
      protein: item.protein,
      carbs: item.carbs,
      fat: item.fat,
      price: item.estimated_price,
      // ₪ per kg as bought (src/lib/pricing.js), when known
      price_per_kg: Number(item.price_per_kg) > 0 ? Number(item.price_per_kg) : null,
    };
  });
}

/** Finds the catalog product an AI plan item refers to (ID first, then name). */
export function resolveProduct(item, catalog) {
  if (item.product_id) {
    const byId = catalog.find(p => p.id === String(item.product_id).trim());
    if (byId) return byId;
  }
  const name = normalizeHebrew(item.food_name);
  if (!name) return null;
  const exact = catalog.find(p => normalizeHebrew(p.name_he) === name);
  if (exact) return exact;
  const contains = catalog.find(p => {
    const pn = normalizeHebrew(p.name_he);
    return pn.includes(name) || name.includes(pn);
  });
  if (contains) return contains;
  // Best token overlap (≥1 shared Hebrew word of 3+ letters)
  const tokens = name.split(" ").filter(t => t.length >= 3);
  let best = null, bestScore = 0;
  for (const p of catalog) {
    const pt = normalizeHebrew(p.name_he).split(" ");
    const score = tokens.filter(t => pt.some(w => w.startsWith(t) || t.startsWith(w))).length;
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return bestScore > 0 ? best : null;
}

const HEBREW = /[֐-׿]/;
// Any letter outside the Hebrew script (Latin, CJK, …); size marks like "L"/"XL" are allowed
const NON_HEBREW_LETTER = /(?![֐-׿])\p{L}/u;

export function isHebrewText(s) {
  return HEBREW.test(s || "") && !NON_HEBREW_LETTER.test((s || "").replace(/\b[A-Z]{1,2}\b/g, ""));
}

const MEAL_TYPE_ALIASES = {
  breakfast: "Breakfast", "ארוחת בוקר": "Breakfast", "בוקר": "Breakfast",
  lunch: "Lunch", "ארוחת צהריים": "Lunch", "צהריים": "Lunch",
  dinner: "Dinner", "ארוחת ערב": "Dinner", "ערב": "Dinner",
  snacks: "Snacks", snack: "Snacks", "חטיפים": "Snacks", "חטיף": "Snacks", "ביניים": "Snacks",
};

function normalizeMealType(t) {
  return MEAL_TYPE_ALIASES[String(t || "").trim().toLowerCase()] || t;
}

const round1 = n => Math.round((Number(n) || 0) * 10) / 10;

function recomputeTotals(plan) {
  for (const day of plan.days) {
    for (const meal of day.meals) {
      meal.total_calories = Math.round(meal.items.reduce((s, i) => s + (Number(i.calories) || 0), 0));
      meal.total_protein = Math.round(meal.items.reduce((s, i) => s + (Number(i.protein) || 0), 0));
      meal.total_carbs = Math.round(meal.items.reduce((s, i) => s + (Number(i.carbs) || 0), 0));
      meal.total_fat = Math.round(meal.items.reduce((s, i) => s + (Number(i.fat) || 0), 0));
      meal.estimated_cost = round1(meal.items.reduce((s, i) => s + (Number(i.estimated_cost) || 0), 0));
    }
    day.total_calories = day.meals.reduce((s, m) => s + m.total_calories, 0);
    day.total_protein = day.meals.reduce((s, m) => s + m.total_protein, 0);
    day.total_carbs = day.meals.reduce((s, m) => s + m.total_carbs, 0);
    day.total_fat = day.meals.reduce((s, m) => s + m.total_fat, 0);
    day.estimated_cost = round1(day.meals.reduce((s, m) => s + m.estimated_cost, 0));
  }
  plan.weekly_calories = plan.days.reduce((s, d) => s + d.total_calories, 0);
  plan.estimated_weekly_cost = round1(plan.days.reduce((s, d) => s + d.estimated_cost, 0));
  return plan;
}

/**
 * Maps every plan item back to its shopping-list product (exact Hebrew name),
 * drops items that match no product, and normalizes meal types.
 * Returns the list of dropped (hallucinated) item names.
 */
export function canonicalizePlan(plan, catalog) {
  const dropped = [];
  plan.days = (plan.days || []).map(day => ({
    ...day,
    meals: (day.meals || []).map(meal => ({
      ...meal,
      meal_type: normalizeMealType(meal.meal_type),
      items: (meal.items || []).flatMap(item => {
        const product = resolveProduct(item, catalog);
        if (!product) { dropped.push(item.food_name); return []; }
        return [{ ...item, product_id: product.id, food_name: product.name_he }];
      }),
    })),
  }));
  return dropped;
}

/** Checks one meal against the meal-role rules. Returns a list of Hebrew-free reason codes. */
export function checkMeal(meal, catalog) {
  const issues = [];
  const products = meal.items.map(i => catalog.find(p => p.id === i.product_id)).filter(Boolean);
  const groups = products.map(p => p.group);
  const has = set => groups.some(g => set.has(g));

  if (!products.length) return ["empty meal"];
  if (!isHebrewText(meal.meal_name)) issues.push("meal_name missing or not Hebrew");
  if (products.some(p => p.kosher === "meat") && products.some(p => p.kosher === "dairy")) {
    issues.push("meat and dairy in the same meal");
  }
  // One main animal protein per plate; meat/poultry with fish is also not kosher
  if (groups.includes("meat") && groups.includes("fish")) issues.push("meat and fish in the same meal");
  else if (new Set(products.filter(p => p.group === "meat" || p.group === "fish").map(p => p.id)).size > 1) {
    issues.push("more than one main meat/fish protein in the meal");
  }
  const phantom = mealNameMismatches(meal.meal_name, meal.items, catalog);
  if (phantom.length) issues.push(`meal_name mentions foods not in the meal: ${phantom.join(", ")}`);
  for (const item of meal.items) {
    const p = catalog.find(c => c.id === item.product_id);
    const cap = p && portionCap(p);
    if (cap && Number(item.grams) > cap) issues.push(`unrealistic portion: ${item.grams}g ${p.name_he} (max ${cap}g)`);
  }
  if (meal.meal_type === "Snacks") {
    const bad = products.filter(p => NOT_SNACK.has(p.group) || DRINKS.has(p.group) && products.length === 1);
    if (bad.length) issues.push(`not snack foods: ${bad.map(p => p.name_he).join(", ")}`);
  } else {
    if (groups.includes("coffee") && meal.meal_type === "Dinner") issues.push("coffee at dinner");
    if (groups.every(g => DRINKS.has(g))) issues.push("drink only, not a meal");
    if (hasMilkWithoutPartner(groups)) issues.push("milk without coffee, tea or cereal");
    if (meal.meal_type === "Lunch" || meal.meal_type === "Dinner") {
      if (!has(MAIN_PROTEIN)) issues.push("main meal without a protein");
      if (!has(MAIN_BASE)) issues.push("main meal without carb/vegetable side");
    }
    if (meal.meal_type === "Breakfast" && !groups.some(g => !DRINKS.has(g) && g !== "oil")) {
      issues.push("breakfast without food");
    }
  }
  return issues;
}

// Generic dish words: satisfied by any item of their food group
const GENERIC_WORDS = new Set(["סלט", "ירקות", "ירק", "פירות", "פרי", "גבינה", "גבינות", "דג", "דגים", "חביתה", "שקשוקה", "כריך", "טוסט", "סנדוויץ"].map(unfinal));

/**
 * Food words in the dish name that don't match any item in the meal
 * (e.g. "…וקפה" without coffee, "…ברוקולי" when the meal has no broccoli).
 * Specific words must share a 3-letter prefix with an item's product name.
 */
export function mealNameMismatches(mealName, items, catalog) {
  const products = items.map(i => catalog.find(p => p.id === i.product_id)).filter(Boolean);
  const groups = products.map(p => p.group);
  const tokens = products.flatMap(p => normalizeHebrew(p.name_he).split(" "));
  const matchesItem = word => tokens.some(t => t.length >= 2 && t.startsWith(word.slice(0, 3)));
  let name = normalizeHebrew(mealName);
  const found = [];
  // "תפוחי אדמה" is two words; check it as a phrase so "תפוחי" isn't read as fruit
  if (/תפוחי? אדמה/.test(name)) {
    if (!groups.includes("starch_veg")) found.push("תפוחי אדמה");
    name = name.replace(/תפוחי? אדמה/g, " ");
  }
  const wordOk = word => {
    const group = classifyProduct(word);
    if (group === "other") return null; // not a food word
    return GENERIC_WORDS.has(word) ? groups.includes(group) : matchesItem(word);
  };
  for (const word of name.split(" ")) {
    if (word.length < 3) continue;
    // Try the word as-is and without the conjunction prefix "ו" ("וסלט" → "סלט")
    const results = [word, word.startsWith("ו") ? word.slice(1) : null]
      .filter(w => w && w.length >= 2).map(wordOk).filter(r => r !== null);
    if (results.length && !results.some(Boolean)) found.push(word);
  }
  return found;
}

export function shortProductName(name) {
  return String(name)
    .replace(/\s*[×x]\s*\d+.*$/, "")
    .replace(/\s+(?:מארז|תבנית)\s+\d+.*$/, "")
    .replace(/\s+\d[\d.,]*\s*(?:ק["״]?ג|ג['׳]?|גרם|ל['׳]?|ליטר|מ["״]?ל)?(?=\s|$).*$/, "")
    .replace(/\s+-\s*$/, "")
    .trim();
}

// Package / kashrut words that are not part of a dish name
const NOISE_WORDS = new Set(["טרי", "טריה", "ארוז", "ארוזה", "מהדרין", "כשר", "כשרה", "יח", "מארז", "שקית", "ק\"ג", "גרם"]);

/** A short, readable food name for dish names: "לחם מלא100%+שיפון-קל750ג" → "לחם מלא", "טונה במים בד"צ 960" → "טונה במים". */
export function dishWord(name) {
  const words = shortProductName(name)
    .replace(/[+/,()]/g, " ")
    .split(/\s+/)
    // "10פיתות" → "פיתות", "מלא100%" → "מלא"
    .map(w => w.replace(/^\d+/, "").replace(/\d.*$/, "").replace(/[-–]+$/, ""))
    .filter(w => w && w.length > 1 && !/["״׳']/.test(w.slice(1, -1)) && !NOISE_WORDS.has(w));
  return words.slice(0, 3).join(" ") || shortProductName(name);
}

/** Fallback dish name built from the meal's own items. */
export function nameFromItems(items) {
  const names = [...new Set(items.map(i => dishWord(i.food_name)).filter(Boolean))];
  if (names.length <= 1) return names[0] || "";
  const [first, ...rest] = names;
  const tail = rest.length === 1 ? rest[0] : `${rest.slice(0, -1).join(", ")} ו${rest.at(-1)}`;
  return `${first} עם ${tail}`;
}

/** Validates the whole plan; returns [{ dayIndex, mealIndex, reasons }]. */
export function validatePlan(plan, catalog) {
  const problems = [];
  const lunchProteins = new Map();
  plan.days.forEach((day, dayIndex) => {
    day.meals.forEach((meal, mealIndex) => {
      const reasons = checkMeal(meal, catalog);
      // Variety: the same main protein product at more than 3 lunches in a week
      if (meal.meal_type === "Lunch") {
        const main = meal.items
          .map(i => catalog.find(p => p.id === i.product_id))
          .find(p => p && MAIN_PROTEIN.has(p.group));
        if (main) {
          const n = (lunchProteins.get(main.id) || 0) + 1;
          lunchProteins.set(main.id, n);
          if (n > 3) reasons.push(`${main.name_he} used at more than 3 lunches`);
        }
      }
      if (reasons.length) problems.push({ dayIndex, mealIndex, reasons });
    });
  });
  return problems;
}

/**
 * Last-resort deterministic repair for meals still invalid after regeneration:
 * separate meat from dairy and remove non-snack items from snacks.
 */
export function forceRepair(plan, catalog) {
  for (const day of plan.days) {
    for (const meal of day.meals) {
      const product = i => catalog.find(p => p.id === i.product_id);
      const kinds = meal.items.map(i => product(i)?.kosher);
      if (kinds.includes("meat") && kinds.includes("dairy")) {
        meal.items = meal.items.filter(i => product(i)?.kosher !== "dairy");
      }
      // Milk only goes with coffee/tea or cereal/oats — otherwise it leaves the meal
      const groupsHere = meal.items.map(i => product(i)?.group);
      if (hasMilkWithoutPartner(groupsHere) && meal.items.some(i => !["milk", "plant_milk"].includes(product(i)?.group))) {
        meal.items = meal.items.filter(i => !["milk", "plant_milk"].includes(product(i)?.group));
      }
      // Keep only the largest meat/fish portion (meat with fish is not served together)
      const mains = meal.items.filter(i => ["meat", "fish"].includes(product(i)?.group));
      if (mains.length > 1) {
        const keep = mains.reduce((a, b) => (Number(b.grams) > Number(a.grams) ? b : a));
        meal.items = meal.items.filter(i => !mains.includes(i) || i === keep);
      }
      if (meal.meal_type === "Snacks") {
        const kept = meal.items.filter(i => !NOT_SNACK.has(product(i)?.group));
        if (kept.length) meal.items = kept;
      }
      // Scale oversized portions (and their macros/cost) down to the cap
      meal.items = meal.items.map(i => {
        const cap = product(i) && portionCap(product(i));
        const grams = Number(i.grams) || 0;
        if (!cap || grams <= cap) return i;
        const f = cap / grams;
        const scaled = { ...i, grams: cap };
        for (const k of ["calories", "protein", "carbs", "fat", "estimated_cost"]) scaled[k] = round1((Number(i[k]) || 0) * f);
        return scaled;
      });
      // Dish name still inconsistent with the items (or missing) — rebuild it
      if (!isHebrewText(meal.meal_name) || mealNameMismatches(meal.meal_name, meal.items, catalog).length) {
        meal.meal_name = nameFromItems(meal.items);
      }
    }
  }
  return plan;
}

export { recomputeTotals };
