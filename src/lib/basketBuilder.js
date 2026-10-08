/**
 * Smart basket builder — deterministic, no AI. The intermediate step between
 * the user's receipts and the weekly menu: raw ingredients the menu is built
 * from, not the final shopping list (that one is derived from the menu).
 *
 *   receipt items (recognized, menu-fit food, not disliked / forbidden)
 *     + strong purchase-history regulars
 *     → smart additions for the week's needs (src/lib/smartBasketEngine.js)
 *     → missing staples / protein completion (src/lib/basketAlternatives.js)
 *     → budget trim (optional picks first, staples never)
 *
 * No network here: purchase history and catalog lookups are passed in.
 */
import { classifyProduct, normalizeHebrew } from "@/lib/mealPlanRules";
import { parseQuantityGrams, plausiblePer100g } from "@/lib/mealPlanCalories";
import { applyReceiptRules, foodName, isDiscountLine, categoryOf, spendClass } from "@/lib/receiptClassifier";
import { isNonFoodName } from "@/lib/nonFood";
import { productHealthScore } from "@/lib/healthScore";
import { pricingFields, isWeighedGroup } from "@/lib/pricing";
import { buildSmartAdditions } from "@/lib/smartBasketEngine";
import { missingStaples, isDisliked, profileConflict, isSupplement, itemRole } from "@/lib/basketAlternatives";
import { requireProfile } from "@/lib/profileGuard";

// Pack size assumed when a receipt line has no readable quantity
const DEFAULT_PACK_GRAMS = 500;

// ─── Receipt item → basket item ──────────────────────────────────────────────

/**
 * Price and nutrition for an item: the catalog's when it is matched with
 * confidence; otherwise the receipt's price and no nutrition (the caller uses
 * typical values for the food group). Nutrition the receipt AI once estimated
 * is never used.
 */
export function getEffectiveItemData(item) {
  const hasStrongCatalogMatch =
    ["matched", "approved"].includes(item.catalog_match_status) && !item.catalog_needs_review;
  const catalog = k => (hasStrongCatalogMatch && item[`catalog_${k}_per_100g`] != null ? item[`catalog_${k}_per_100g`] : null);

  return {
    ...item,
    effective_price:
      hasStrongCatalogMatch && item.catalog_price != null
        ? item.catalog_price
        : item.price,
    effective_calories_per_100g: catalog("calories"),
    effective_protein_per_100g: catalog("protein"),
    effective_carbs_per_100g: catalog("carbs"),
    effective_fat_per_100g: catalog("fat"),
    data_source: hasStrongCatalogMatch ? "catalog" : "receipt",
  };
}

export const SHOPPING_CATEGORIES = ["protein", "carb", "fat", "vegetable", "fruit", "dairy", "snack", "drink", "other"];

// Maps category variants ("carbs", "legumes", "מוצרי חלב", …) onto the category keys above
const CATEGORY_ALIASES = [
  [/^(carbs?|grains?|bread|pasta|rice|cereals?)$|פחמימ|דגנ|לחם|כוללי/i, "carb"],
  [/^(legumes?|plant_protein|meat|poultry|fish|eggs?|proteins?)$|חלבון|קטני|עו[פף]|בשר|דג/i, "protein"],
  [/^(dairy_products|milk)$|חלב/i, "dairy"],
  [/^(fats?|oils?|healthy_fats?|nuts?)$|שומנ|שמן|אגוז|שקד/i, "fat"],
  [/^vegetables?$|ירק/i, "vegetable"],
  [/^fruits?$|פרי|פירות|פרות/i, "fruit"],
  [/^(snacks?|sweets?|favorite)$|חטי[פף]|מתוק/i, "snack"],
  [/^(drinks?|beverages?)$|משק[הא]|שתי/i, "drink"],
];

export function normalizeCategory(category) {
  const c = String(category || "").trim();
  if (SHOPPING_CATEGORIES.includes(c)) return c;
  return CATEGORY_ALIASES.find(([re]) => re.test(c))?.[1] || "other";
}

/**
 * A food product the user added to the basket from the catalog search
 * ("הוספת מוצר מזון"), as a basket item priced by its catalog pack.
 * product: a /api/products/search result. Returns { item } or { error } (Hebrew)
 * for a product the basket must not take: not food, a supplement, or one that
 * breaks the profile's diet / allergies.
 */
export function userAddedItem(product, profile) {
  const name = String(product?.original_product_name || "").trim();
  if (!name || isNonFoodName(name)) return { error: "זה לא מוצר מזון" };
  const category = categoryOf(name);
  if (isSupplement({ name })) return { error: "תוסף תזונה — לא חלק מהתפריט" };
  const conflict = profileConflict({ name, category }, profile);
  if (conflict) return { error: conflict.text };
  const group = classifyProduct(name, category);
  const pack = Number(product.pack_grams);
  const grams = pack >= 20 && pack <= 5000 ? pack : parseQuantityGrams(name, group) || (product.sold_by_weight ? 1000 : DEFAULT_PACK_GRAMS);
  const price = Number(product.price) || 0;
  const n = plausiblePer100g({ name_he: name, group }, product.calories_per_100g != null ? {
    kcal: Number(product.calories_per_100g), protein: Number(product.protein_per_100g) || 0,
    carbs: Number(product.carbs_per_100g) || 0, fat: Number(product.fat_per_100g) || 0,
  } : null);
  const f = grams / 100;
  const per = v => (v == null ? null : Math.round(Number(v) * f * 10) / 10);
  return {
    item: {
      name,
      category: group === "avocado" ? "fat" : category,
      quantity: grams >= 1000 && grams % 1000 === 0 ? `${grams / 1000} ק"ג` : `${Math.round(grams)} גרם`,
      estimated_price: price,
      ...(price > 0 ? pricingFields({ price, packGrams: grams, soldByWeight: !!product.sold_by_weight, grams }) : {}),
      calories: n ? Math.round(n.kcal * f) : null,
      protein: n ? per(n.protein) : null,
      carbs: n ? per(n.carbs) : null,
      fat: n ? per(n.fat) : null,
      health_score: productHealthScore(name),
      reason: "הוספת את המוצר לסל.",
      user_added: true,
      catalog_product_id: product.product_id != null ? String(product.product_id) : null,
      catalog_chain: product.chain ?? null,
      catalog_name: name,
      catalog_price: price || null,
      catalog_calories_per_100g: product.calories_per_100g ?? null,
      catalog_protein_per_100g: product.protein_per_100g ?? null,
      catalog_carbs_per_100g: product.carbs_per_100g ?? null,
      catalog_fat_per_100g: product.fat_per_100g ?? null,
    },
  };
}

/**
 * A recognized receipt item as a basket item: the receipt is the basis of the
 * basket, so these go in directly (catalog values when the match is confirmed).
 */
export function receiptToBasketItem(raw) {
  // category and menu suitability by the rules (or the user's own edit)
  const i = getEffectiveItemData(applyReceiptRules(raw));
  // the catalog name when the receipt's reading names no food ("חפוח אדמה" → "תפוח אדמה 1 ק"ג")
  const name = foodName(i);
  const group = classifyProduct(name, normalizeCategory(i.category));
  // Avocado is a healthy fat in the basket, whatever the receipt called it
  const category = group === "avocado" ? "fat" : normalizeCategory(i.category);
  const parsed = parseQuantityGrams(i.quantity, group) || parseQuantityGrams(i.matched_product_name, group);
  // Catalog price with its real unit: a weighed product's price is per kg, a
  // packed one's per pack — never the price of the receipt's own amount —
  // unless the catalog matched a different pack size than the one bought
  // (e.g. 100 g for a 1 kg bag): then the receipt's own price is the truer one
  const receiptPrice = Number(i.price) || 0;
  const packGrams = Number(i.catalog_pack_grams) || 0;
  const otherPack = !i.catalog_sold_by_weight && parsed && packGrams && receiptPrice > 0 &&
    (parsed / packGrams > 1.5 || parsed / packGrams < 0.67);
  const catalogPriced = i.data_source === "catalog" && Number(i.catalog_price) > 0 && packGrams > 0 && !otherPack;
  const grams = parsed || (catalogPriced ? packGrams : DEFAULT_PACK_GRAMS);
  const f = grams / 100;
  // Catalog nutrition when plausible for the food group, else its typical values
  const n = plausiblePer100g({ name_he: name, group }, i.effective_calories_per_100g != null ? {
    kcal: Number(i.effective_calories_per_100g), protein: Number(i.effective_protein_per_100g) || 0,
    carbs: Number(i.effective_carbs_per_100g) || 0, fat: Number(i.effective_fat_per_100g) || 0,
  } : null);
  const per = v => (v == null ? null : Math.round(Number(v) * f * 10) / 10);
  const pricing = catalogPriced
    ? pricingFields({ price: Number(i.catalog_price), packGrams: Number(i.catalog_pack_grams), soldByWeight: !!i.catalog_sold_by_weight, grams })
    : receiptPrice > 0
      ? pricingFields({ price: receiptPrice, packGrams: grams, soldByWeight: isWeighedGroup(group, name), grams })
      : {};
  return {
    name,
    category,
    quantity: parsed && i.quantity ? i.quantity : `${grams} גרם`,
    estimated_price: Number(i.effective_price ?? i.price ?? 0) || 0,
    ...pricing,
    calories: Math.round((n?.kcal || 0) * f),
    protein: per(n?.protein),
    carbs: per(n?.carbs),
    fat: per(n?.fat),
    nutrition_source: n?.source || null,
    // deterministic, from the product (the same score the receipt table shows)
    health_score: productHealthScore(name),
    reason: "נמצא בקבלה שלך, ולכן נשאר בסל.",
    from_receipt: true,
    receipt_item_id: i.id,
    ...(i.data_source === "catalog" ? {
      catalog_product_id: i.matched_product_id ?? null,
      catalog_chain: i.catalog_chain ?? null,
      catalog_name: i.matched_product_name ?? null,
      catalog_price: i.catalog_price ?? null,
    } : {}),
  };
}

/**
 * True when two baskets hold the same products in the same quantities (order
 * aside). "בחירה מחדש" that gives the same basket is not saved as a new one.
 */
export function sameBasketItems(a, b) {
  const key = items => (items || []).map(i => `${i.name}|${i.quantity ?? ""}`).sort().join("\n");
  return key(a) === key(b);
}

/**
 * Basket items whose receipt line was corrected after the basket was built (a
 * new match or an approved suggestion — e.g. "גרעיני דיריז מתוק" approved as
 * corn): the saved basket still has the old name and values. receiptItems: the
 * receipt's current lines. Returns [{ index, from, item }] — item: the basket
 * item rebuilt from the corrected line (its reason and flags kept).
 */
export function correctedReceiptItems(basketItems, receiptItems) {
  const byId = new Map((receiptItems || []).map(r => [r.id, r]));
  return (basketItems || []).flatMap((b, index) => {
    const line = b.from_receipt && b.receipt_item_id != null ? byId.get(b.receipt_item_id) : null;
    if (!line) return [];
    const fresh = receiptToBasketItem(line);
    if (fresh.name === b.name) return [];
    return [{ index, from: b.name, item: { ...b, ...fresh, reason: b.reason, from_receipt: true } }];
  });
}

// ─── Basket helpers ──────────────────────────────────────────────────────────

export const sameFood = (a, b) => {
  const [x, y] = [normalizeHebrew(a), normalizeHebrew(b)];
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

/** Basket totals after an item was added, removed or replaced. */
export function basketTotals(items) {
  return {
    total_estimated_cost: Math.round(items.reduce((s, i) => s + (Number(i.estimated_price) || 0), 0) * 100) / 100,
    total_calories: Math.round(items.reduce((s, i) => s + (Number(i.calories) || 0), 0)),
  };
}

// A basket this small, or without a protein, carb or vegetable, limits the weekly menu
const MIN_VARIED_BASKET = 8;
export function basketLooksThin(items) {
  const roles = new Set(items.map(itemRole));
  return items.length < MIN_VARIED_BASKET || !["protein", "carb", "vegetable"].every(r => roles.has(r) || (r === "protein" && roles.has("dairy")));
}

// ─── Purchase history (soft preference) ──────────────────────────────────────
// Scores come from GET /api/purchase-history (server/purchaseHistory.js).
// History never overrides diet, allergies, disliked foods, nutrition or budget:
// candidates are filtered by those first, and history only reorders/adds
// among what already fits.
const HISTORY_TOP = 10;
// A product counts as a "regular" — added to the basket by itself — only with
// a strong combined score AND decent quality (frequent alone is not enough)
export const REGULAR_MIN_SCORE = 0.72;
const REGULAR_MIN_QUALITY = 0.6;
const MAX_REGULARS = 5;

// ─── The basket ──────────────────────────────────────────────────────────────

/**
 * Builds the week's basket.
 *   receiptItems  recognized receipt items ready for the basket (isBasketReady)
 *   history       purchase-history products (GET /api/purchase-history)
 *   weeklyBudget  ₪ for the week
 *   additions / staples  injectable for tests (default: the catalog-backed engines)
 * Returns { items, total }.
 */
export async function buildBasket({
  receiptItems, history = [], profile, weeklyBudget,
  additions = buildSmartAdditions, staples = missingStaples,
}) {
  // Never a basket without the user's goals and preferences (src/lib/profileGuard.js)
  requireProfile(profile);
  const disliked = profile?.disliked_foods || [];
  // The receipt is the basis of the basket: its recognized, menu-fit food
  // items (not disliked) go in as they are; the engine only adds around them
  const receiptBasket = [];
  for (const item of receiptItems.map(receiptToBasketItem)) {
    if (isDisliked(item.name, disliked)) continue;
    if (profileConflict(item, profile) || isSupplement(item)) continue;
    if (receiptBasket.some(b => sameFood(b.name, item.name))) continue;
    receiptBasket.push(item);
  }
  // Purchase history: only products that fit this user at all, above neutral.
  // A single receipt is not a pattern — history needs at least 2 (confidence 0.4).
  // Each product is known by the same name as a receipt line (foodName: the
  // product the user picked or approved — never an old receipt's misreading).
  const fitting = history
    .filter(h => h.confidence >= 0.4 && h.history_score > 0.5)
    .map(h => (h.latest_item ? { ...h, name: foodName(h.latest_item) } : h))
    // menu food by the rules (or the user's edit), as for receipt lines: not
    // non-food, water, spices or discount lines (src/lib/receiptReview.js isBasketReady)
    .filter(h => !h.latest_item || (applyReceiptRules(h.latest_item).is_approved_for_menu &&
      !isDiscountLine(h.latest_item) && spendClass(h.latest_item) === "food_plannable"))
    .filter(h => !profileConflict({ name: h.name, category: h.latest_item?.category }, profile))
    .filter(h => !isSupplement({ name: h.name }) && !isDisliked(h.name, disliked));
  const historyCandidates = fitting.slice(0, HISTORY_TOP);
  // Strong regulars go in by themselves (like receipt items), unless already there
  const historyBasket = [];
  for (const h of historyCandidates) {
    if (historyBasket.length >= MAX_REGULARS) break;
    if (h.history_score < REGULAR_MIN_SCORE || h.quality_score < REGULAR_MIN_QUALITY || !h.latest_item) continue;
    if ([...receiptBasket, ...historyBasket].some(b => sameFood(b.name, h.name))) continue;
    historyBasket.push({
      ...receiptToBasketItem(h.latest_item),
      name: h.name,
      reason: `רכשת את המוצר ב-${h.receipt_count} מתוך ${h.total_receipts} הקניות האחרונות, והוא מתאים לסל השבועי.`,
      from_receipt: false,
      from_history: true,
      history_score: h.history_score,
      history_receipt_count: h.receipt_count,
      history_total_receipts: h.total_receipts,
    });
  }
  // The receipt (and strong regulars) are the anchor; the engine adds
  // what the week still needs around it — deterministic, no AI
  const anchor = [...receiptBasket, ...historyBasket];
  const anchorCost = anchor.reduce((s, i) => s + (i.estimated_price || 0), 0);
  // History products that are not regulars compete with catalog candidates
  const historyItems = historyCandidates
    .filter(h => h.latest_item && !anchor.some(b => sameFood(b.name, h.name)))
    .map(h => ({ item: { ...receiptToBasketItem(h.latest_item), name: h.name, from_receipt: false }, history: h }));
  const added = await additions({
    basket: anchor,
    historyItems,
    profile,
    budgetLeft: weeklyBudget - anchorCost,
    hasReceipt: receiptBasket.length > 0,
  });
  let items = [...anchor, ...added];
  // Safety net (and protein completion): bread/grains/fat if still missing,
  // then protein sources until the menu can reach the protein target
  items = [...items, ...await staples(items, profile, historyCandidates)];
  let total = items.reduce((sum, i) => sum + (i.estimated_price || 0), 0);
  // Over budget: drop optional picks first (most expensive first), then
  // history regulars, then vegetables/fruit/dairy needs, then protein
  // sources, receipt items only as a last resort; staples and protein
  // completion never
  const trimRank = i => (i.added_staple ? 0 : i.from_receipt ? 1 : i.basket_need === "protein" ? 2
    : i.basket_need ? 3 : i.from_history ? 4 : 5);
  while (total > weeklyBudget && items.some(i => !i.added_staple)) {
    const maxIdx = items.reduce((mi, item, idx, arr) =>
      trimRank(item) > trimRank(arr[mi]) || (trimRank(item) === trimRank(arr[mi]) && item.estimated_price > arr[mi].estimated_price) ? idx : mi, 0);
    total -= items[maxIdx].estimated_price || 0;
    items = items.filter((_, idx) => idx !== maxIdx);
  }
  return { items, total };
}
