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

// Plain water adds nothing to a meal — food, but not part of the menu
const PLAIN_WATER = /^\s*(מים|מי ברז|מי מעיין|סודה|מים מוגזים|מי סודה|מי עדן|נביעות|מי נביעות|נביעות טבעיות)(?![א-ת])/;
export const isPlainWater = name => PLAIN_WATER.test(String(name || ""));

/** A discount line on the receipt ("קטיף מלפפון −3.42"): money, not a product. */
export const isDiscountLine = item => Number(item?.price) < 0;

const STRONG_MATCH = new Set(["matched", "approved"]);
/**
 * The name to treat a receipt item as: the user's chosen product, else the
 * receipt's reading — unless that reading names no food group (an OCR slip such
 * as "חפוח אדמה" or "פיתוח כוסמי") and the catalog matched it with confidence:
 * then the catalog product ("תפוח אדמה 1 ק"ג", "10פיתות כוסמין").
 */
export function foodName(item) {
  const name = (item?.catalog_match_type === "manual" && item.matched_product_name) || item?.normalized_name || item?.original_name || "";
  if (classifyProduct(name) !== "other") return name;
  const matched = STRONG_MATCH.has(item?.catalog_match_status) && !item?.catalog_needs_review && item?.matched_product_name;
  return matched && classifyProduct(matched) !== "other" ? matched : name;
}

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
  const rule = classifyReceiptLine({ ...item, normalized_name: foodName(item) });
  const userSaidNotFood = USER_FOOD_DECISION.has(item.catalog_match_status);
  const isFood = userSaidNotFood ? false : rule.is_food;
  return {
    ...item,
    is_food: isFood,
    category: isFood ? rule.category : "other",
    is_approved_for_menu: isFood && rule.is_approved_for_menu && !isDiscountLine(item),
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
  const read = lines
    .map(l => ({
      original_name: String(l.original_name || l.normalized_name || "").trim(),
      normalized_name: String(l.normalized_name || l.original_name || "").trim(),
      quantity: l.quantity ?? l.estimated_quantity ?? null,
      price: Number(l.price) || null,
    }))
    .filter(l => l.original_name || l.normalized_name);
  // A discount line lowers the price of the product above it — it is not a product
  const out = [];
  for (const l of read) {
    if (isDiscountLine(l) && out.length) {
      const prev = out[out.length - 1];
      prev.price = Math.round(((prev.price || 0) + l.price) * 100) / 100;
      prev.discount = Math.round(((prev.discount || 0) - l.price) * 100) / 100;
    } else if (!isDiscountLine(l)) out.push(l);
  }
  return out;
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

// ─── Spending classes ───────────────────────────────────────────────────────

/**
 * What a receipt line's money was spent on:
 *   food_plannable      food the weekly menu can use (menu-fit, has a food group, not plain water)
 *   food_non_plannable  food outside the menu: treats, sweet drinks, water, spices…
 *   non_food            household, cleaning, hygiene
 * Discount lines belong to the line above them (see receiptSpending).
 */
export function spendClass(raw) {
  const item = applyReceiptRules(raw);
  if (!item.is_food) return "non_food";
  const name = foodName(raw);
  const plannable = item.is_approved_for_menu && !isPlainWater(name) && classifyProduct(name) !== "other";
  return plannable ? "food_plannable" : "food_non_plannable";
}

const CLASSES = ["food_plannable", "food_non_plannable", "non_food"];
const round2 = n => Math.round(n * 100) / 100;

/**
 * Spending from all of a user's receipts, split by class.
 *   receipts: [{ id, purchase_date, created_date }]; items: their receipt items
 *   (in receipt order — a discount line is credited to the line above it).
 * Returns { receipts: [{ id, date, food_plannable, food_non_plannable, non_food, total }],
 *           count, perReceipt: {...averages}, perMonth: {...} } — perMonth uses the
 * profile's purchases per month (default 4). Receipts with no lines are left out.
 */
export function receiptSpending(receipts, items, { purchasesPerMonth = 4 } = {}) {
  const rows = [];
  for (const r of receipts || []) {
    const lines = (items || []).filter(i => i.receipt_id === r.id);
    if (!lines.length) continue;
    const sums = Object.fromEntries(CLASSES.map(c => [c, 0]));
    let last = "food_non_plannable";
    for (const l of lines) {
      const price = Number(l.price) || 0;
      const cls = isDiscountLine(l) ? last : spendClass(l);
      sums[cls] += price;
      if (!isDiscountLine(l)) last = cls;
    }
    rows.push({ id: r.id, date: r.purchase_date || String(r.created_date || "").slice(0, 10),
      ...Object.fromEntries(CLASSES.map(c => [c, round2(sums[c])])), total: round2(CLASSES.reduce((s, c) => s + sums[c], 0)) });
  }
  const avg = c => (rows.length ? round2(rows.reduce((s, r) => s + r[c], 0) / rows.length) : 0);
  const perReceipt = Object.fromEntries([...CLASSES, "total"].map(c => [c, avg(c)]));
  const perMonth = Object.fromEntries(Object.entries(perReceipt).map(([c, v]) => [c, Math.round(v * purchasesPerMonth)]));
  return { receipts: rows, count: rows.length, perReceipt, perMonth };
}

/**
 * "Before / after" for the menu, food against food:
 *   before = the user's monthly spending on food the menu replaces (food_plannable,
 *            from all receipts × purchases per month); without receipts, the
 *            stated monthly budget
 *   after  = the menu's weekly purchase cost × 30/7
 * Food outside the menu and non-food items are reported beside it, never
 * counted as savings. Returns the before_after fields saved with the plan.
 */
export function spendingComparison({ spending, monthlyBudget, weeklyMenuCost }) {
  const after = Math.round((Number(weeklyMenuCost) || 0) * 30 / 7);
  const fromReceipts = spending?.count > 0 && spending.perMonth.food_plannable > 0;
  const before = fromReceipts ? spending.perMonth.food_plannable : Math.round(Number(monthlyBudget) || after);
  const savings = Math.max(0, before - after);
  return {
    previous_monthly_spending: before,
    estimated_new_monthly_spending: after,
    monthly_savings: savings,
    yearly_savings: savings * 12,
    comparison_basis: fromReceipts ? "receipts_food" : "budget",
    receipts_counted: spending?.count || 0,
    // the rest of what the receipts show, per month — not part of the comparison
    monthly_food_non_plannable: fromReceipts ? spending.perMonth.food_non_plannable : null,
    monthly_non_food: fromReceipts ? spending.perMonth.non_food : null,
    monthly_receipts_total: fromReceipts ? spending.perMonth.total : null,
  };
}
