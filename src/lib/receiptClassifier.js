/**
 * Receipt line classification and receipt insights — deterministic, no AI.
 *
 * The receipt AI only reads the receipt (store, date, total, and per line:
 * the printed name, a clean Hebrew name, quantity, price). Everything decided
 * about a line is decided here, from the product name:
 *   is_food              not cosmetics / cleaning / household (src/lib/nonFood.js)
 *   category             from the food group (src/lib/mealPlanRules.js)
 *   is_approved_for_menu food, health score ≥ 4, not a supplement
 *   reasoning            a short Hebrew explanation of the decision
 * Nutrition comes from the catalog match, or typical values for the food
 * group — never from the AI.
 */
import { classifyProduct } from "@/lib/mealPlanRules";
import { productHealthScore } from "@/lib/healthScore";
import { isNonFoodName } from "@/lib/nonFood";
import { isSupplement, itemGroup } from "@/lib/basketAlternatives";

// Food group → basket category
const CATEGORY_BY_GROUP = {
  meat: "protein", fish: "protein", eggs: "protein", legumes: "protein",
  dairy_protein: "dairy", yogurt: "dairy", milk: "dairy",
  plant_milk: "drink", coffee: "drink", tea: "drink",
  grain: "carb", bread: "carb", starch_veg: "carb", cereal: "carb",
  vegetable: "vegetable", fruit: "fruit",
  oil: "fat", tahini: "fat", nuts: "fat", avocado: "fat",
};
const DRINK = /משקה|מיץ|קולה|סודה|(^| )מים( |$)|מי עדן|נביעות|ספרייט|פאנטה|נקטר|בירה|(^| )יין( |$)|אייס/;
const MENU_MIN_HEALTH = 4;

/** The basket category of a food product name. */
export function categoryOf(name) {
  // packing liquids aside ("טונה בשמן" is fish, not oil)
  const group = itemGroup({ name });
  if (CATEGORY_BY_GROUP[group]) return CATEGORY_BY_GROUP[group];
  if (DRINK.test(name)) return "drink";
  const score = productHealthScore(name);
  return score != null && score <= 3 ? "snack" : "other";
}

/** Food / category / menu suitability for one receipt line, from its name. */
export function classifyReceiptLine(line) {
  const name = line.normalized_name || line.original_name || "";
  if (isNonFoodName(name) || isNonFoodName(line.original_name)) {
    return { is_food: false, category: "other", is_approved_for_menu: false, reasoning: "לא מוצר מזון" };
  }
  const score = productHealthScore(name);
  const supplement = isSupplement({ name });
  const approved = !supplement && score != null && score >= MENU_MIN_HEALTH;
  return {
    is_food: true,
    category: categoryOf(name),
    is_approved_for_menu: approved,
    reasoning: supplement ? "תוסף תזונה — לא חלק מהתפריט"
      : approved ? `ציון בריאות ${score}/10 — מתאים לתפריט`
        : `ציון בריאות ${score ?? "?"}/10 — לא נכנס לתפריט הבריא`,
  };
}

// Catalog statuses the user chose ("this is not food", "ignore") — rules never override them
const USER_FOOD_DECISION = new Set(["non_food", "ignored"]);

/**
 * A stored receipt item with the rule-based decisions applied: category,
 * menu suitability and food/non-food come from the rules, so receipts saved
 * before the AI stopped deciding (or by any other path) are judged the same
 * way. A row the user edited by hand (user_edited) keeps the user's choices,
 * and so does a "not food" / "ignore" decision.
 */
export function applyReceiptRules(item) {
  if (!item || item.user_edited === true || item.user_edited === 1) return item;
  const rule = classifyReceiptLine(item);
  const userSaidNotFood = USER_FOOD_DECISION.has(item.catalog_match_status);
  const isFood = userSaidNotFood ? false : rule.is_food;
  return {
    ...item,
    is_food: isFood,
    category: isFood ? rule.category : "other",
    is_approved_for_menu: isFood && rule.is_approved_for_menu,
    reasoning: rule.reasoning,
  };
}

/**
 * The receipt AI's answer as plain lines, whatever shape it came in: the
 * extraction schema ({ items }) or the older one ({ food_items, non_food_items }).
 * Only what the receipt says is kept — no AI judgments.
 */
export function receiptLines(result) {
  const lines = Array.isArray(result?.items) ? result.items : [
    ...(result?.food_items || []),
    ...(result?.non_food_items || []).map(i => ({ original_name: i.name, normalized_name: i.name, price: i.price })),
  ];
  return lines
    .map(l => ({
      original_name: String(l.original_name || l.normalized_name || "").trim(),
      normalized_name: String(l.normalized_name || l.original_name || "").trim(),
      quantity: l.quantity ?? l.estimated_quantity ?? null,
      price: Number(l.price) || null,
    }))
    .filter(l => l.original_name || l.normalized_name);
}

// ─── Insights ────────────────────────────────────────────────────────────────

const GROUP_LABELS = {
  meat: "בשר ועוף", fish: "דגים", eggs: "ביצים", legumes: "קטניות", dairy_protein: "גבינות", yogurt: "יוגורטים",
  milk: "חלב", plant_milk: "משקאות צמחיים", grain: "אורז ופסטה", bread: "לחם", starch_veg: "תפוחי אדמה ובטטה",
  cereal: "דגני בוקר", vegetable: "ירקות", fruit: "פירות", oil: "שמנים", tahini: "טחינה", nuts: "אגוזים",
  avocado: "אבוקדו", coffee: "קפה", tea: "תה",
};
const CATEGORY_LABELS = {
  protein: "חלבונים", dairy: "מוצרי חלב", carb: "פחמימות", vegetable: "ירקות", fruit: "פירות",
  fat: "שומנים", snack: "חטיפים ומתוקים", drink: "משקאות", other: "אחר",
};

/**
 * Insights from a receipt's items (same shape the receipt page shows):
 * main food groups, where the money went, low-health items, and what to add —
 * computed from the items' names, categories, prices and health scores.
 */
export function receiptInsights(items) {
  const food = (items || []).filter(i => i.is_food !== false && i.is_food !== 0);
  const nameOf = i => i.normalized_name || i.original_name || "";
  const groups = new Map();
  for (const i of food) {
    const g = itemGroup({ name: nameOf(i) });
    if (GROUP_LABELS[g]) groups.set(g, (groups.get(g) || 0) + 1);
  }
  const spend = new Map();
  for (const i of food) spend.set(i.category || "other", (spend.get(i.category || "other") || 0) + (Number(i.price) || 0));
  const low = food.filter(i => (i.health_score ?? productHealthScore(nameOf(i))) <= 3).map(nameOf);
  const has = g => groups.has(g);

  const improvements = [];
  if (!has("vegetable")) improvements.push("אין בקבלה ירקות — כדאי להוסיף ירקות טריים לארוחות");
  if (!has("fruit")) improvements.push("אין בקבלה פירות — פרי הוא נשנוש בריא וזול");
  if (!["meat", "fish", "eggs", "legumes", "dairy_protein"].some(has)) improvements.push("אין בקבלה מקור חלבון — כדאי להוסיף ביצים, קטניות, עוף או קוטג'");
  if (low.length >= 2) improvements.push(`יש בקבלה ${low.length} מוצרים עם ציון בריאות נמוך — אפשר להחליף חלק מהם בפרי, אגוזים או יוגורט`);
  if (food.some(i => DRINK.test(nameOf(i)) && productHealthScore(nameOf(i)) <= 3)) improvements.push("משקאות ממותקים — כדאי להחליף במים או בסודה");

  return {
    main_food_preferences: [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => GROUP_LABELS[g]),
    frequent_categories: [...groups.keys()].map(g => GROUP_LABELS[g]),
    high_spending_categories: [...spend.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 2)
      .map(([c, v]) => `${CATEGORY_LABELS[c] || c} (₪${Math.round(v)})`),
    less_healthy_patterns: low.length ? [`מוצרים עם ציון בריאות נמוך: ${low.slice(0, 4).join(", ")}`] : [],
    recommended_improvements: improvements,
  };
}
