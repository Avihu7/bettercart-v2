/**
 * Review state of receipt items before they reach the smart basket (step 2).
 *
 * Uses the existing catalog fields; catalog_match_status carries the state:
 *   matched           confidently recognized (automatic)
 *   approved          confirmed or re-matched by the user
 *   needs_review      possible match — the user must decide
 *   possible_non_food the name looks like a non-food product (toothpaste, soap…)
 *   not_found         no good enough catalog match
 *   not_checked       catalog matching has not run yet
 *   non_food          the user marked it as not food (kept on the receipt)
 *   ignored           the user chose to leave it out of the flow
 * Only matched/approved food items may be used to build the smart basket.
 */
import { applyReceiptRules, spendClass, foodName } from "@/lib/receiptClassifier";
import { isNonFoodName } from "@/lib/nonFood";

// Common household / personal-care products that are never food
const NON_FOOD = /משחת\s*שיניים|מש\.?\s*שיניים|מברשת\s*שיניים|מרידול|קולגייט|שמפו|מרכך\s*(שיער|כביסה)|סבון|דאודורנט|נייר\s*(טואלט|סופג)|חיתולים|מגבונים|חומר\s*ניקוי|אקונומיקה|נוזל\s*כלים|אבקת\s*כביסה|ג'?ל\s*כביסה|תחליב\s*רחצה/;

export const looksNonFood = text => NON_FOOD.test(String(text || "")) || isNonFoodName(text);

const UNRESOLVED = new Set(["not_checked", "needs_review", "possible_non_food", "not_found"]);
const BASKET_READY = new Set(["matched", "approved"]);
// User decisions that a new catalog matching run must not overwrite
const USER_DECIDED = new Set(["approved", "non_food", "ignored"]);

const statusOf = item => item.catalog_match_status || "not_checked";

/** A food item still waiting for the user's decision. */
export const isUnresolved = item => !!item.is_food && UNRESOLVED.has(statusOf(item));

/** May this receipt item be used to build the smart basket? */
// Food and menu suitability by the rules (or the user's own edit), never the receipt AI.
// Only food the menu can use: not water, spices, treats or discount lines.
export const isBasketReady = raw => {
  const item = applyReceiptRules(raw);
  return !!item.is_food && !!item.is_approved_for_menu && BASKET_READY.has(statusOf(item)) && !item.catalog_needs_review &&
    spendClass(raw) === "food_plannable";
};

/** Should (re)running catalog matching touch this item? */
export const needsMatching = item => !!item.is_food && !USER_DECIDED.has(statusOf(item));

/** Excluded by the user (shown with the non-food rows). */
export const isExcluded = item => !item.is_food || statusOf(item) === "ignored";

// Catalog categories that agree with each AI category ("other" is unknown — neutral)
const CATEGORY_MATCH = {
  protein: ["protein", "legume"], carb: ["carb", "bakery"], fat: ["fat"], vegetable: ["vegetable"],
  fruit: ["fruit"], dairy: ["dairy"], snack: ["snack", "sweet"], drink: ["drink"],
};
function categoriesAgree(aiCategory, catalogCategory) {
  if (!catalogCategory || catalogCategory === "other" || !aiCategory || aiCategory === "other") return true;
  return (CATEGORY_MATCH[aiCategory] || [aiCategory]).includes(catalogCategory);
}

const firstWord = s => String(s || "").replace(/[׳'"״.]/g, "").trim().split(/\s+/)[0] || "";
const unfinal = s => s.replace(/[ךםןףץ]/g, c => ({ ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" })[c]);
const sameFirstWord = (a, b) => {
  const [x, y] = [unfinal(firstWord(a)), unfinal(firstWord(b))];
  return x.length >= 2 && (x === y || (x.length >= 3 && (y.startsWith(x) || x.startsWith(y))));
};

// Every catalog field, so a new decision never leaves values from an older candidate
export const EMPTY_CATALOG = {
  matched_product_id: null, matched_product_name: null, catalog_chain: null,
  catalog_price: null, catalog_price_per_100g: null, catalog_category: null,
  catalog_pack_grams: null, catalog_sold_by_weight: null,
  catalog_calories_per_100g: null, catalog_protein_per_100g: null,
  catalog_carbs_per_100g: null, catalog_fat_per_100g: null,
  catalog_match_type: null, catalog_match_confidence: null,
};

// Words that make a catalog product a different product than the plain one
const PRODUCT_CHANGING = /במלח|כבוש|כבושים|חמוצ|מוחמץ|מיובש|ברוטב|מטוגן|מעושן|ממולא|ירוק|בטעם|מצופה|שימורי|בשמן|במים|מתוק/;
function changesProduct(receiptName, catalogName) {
  const words = String(catalogName || "").match(new RegExp(PRODUCT_CHANGING.source, "g")) || [];
  return words.some(w => !String(receiptName || "").includes(w));
}

/**
 * Item patch for one /api/products/match-items result.
 * Recognized automatically only when: no non-food signal, and an exact/strong
 * match, or a ≥0.78 match whose first word agrees with the receipt name —
 * and in both cases the catalog category agrees with the item's category.
 * Everything else is left for the user (needs_review / possible_non_food / not_found).
 */
export function matchPatch(item, match) {
  const name = item.normalized_name || item.original_name;
  const candidateName = match?.matched_name || match?.best_candidate?.matched_name;
  const nonFood = looksNonFood(name) || looksNonFood(item.original_name) || looksNonFood(candidateName);
  const patch = { ...EMPTY_CATALOG };

  if (match?.matched) {
    Object.assign(patch, {
      matched_product_id: match.matched_product_id,
      matched_product_name: match.matched_name,
      catalog_chain: match.chain,
      catalog_price: match.price ?? null,
      catalog_price_per_100g: match.price_per_100g ?? null,
      catalog_pack_grams: match.pack_grams ?? null,
      catalog_sold_by_weight: match.sold_by_weight ?? null,
      catalog_category: match.category ?? null,
      catalog_calories_per_100g: match.calories_per_100g ?? null,
      catalog_protein_per_100g: match.protein_per_100g ?? null,
      catalog_carbs_per_100g: match.carbs_per_100g ?? null,
      catalog_fat_per_100g: match.fat_per_100g ?? null,
      catalog_match_type: match.match_type,
      catalog_match_confidence: match.match_confidence,
    });
    const agree = categoriesAgree(item.category, match.category);
    const strong = match.match_type === "exact" || !match.needs_review;
    const plausible = match.match_confidence >= 0.78 && sameFirstWord(name, match.matched_name);
    // A catalog name that turns the product into another one ("מלפפונים במלח" for
    // cucumbers, "בצל ירוק" for onions) is never a confident match
    const changes = changesProduct(name, match.matched_name);
    const confident = !nonFood && agree && !changes && (strong || plausible);
    patch.catalog_match_status = nonFood ? "possible_non_food" : confident ? "matched" : "needs_review";
    patch.catalog_needs_review = !confident;
    // Missing AI nutrition is only filled from a confident match
    if (confident) {
      for (const k of ["calories", "protein", "carbs", "fat"]) {
        if (item[`${k}_per_100g`] == null && match[`${k}_per_100g`] != null) patch[`${k}_per_100g`] = match[`${k}_per_100g`];
      }
    }
    return patch;
  }

  // No match good enough — keep the best guess to show the user, nothing else
  const best = match?.best_candidate;
  if (best) {
    Object.assign(patch, {
      matched_product_id: best.matched_product_id,
      matched_product_name: best.matched_name,
      catalog_chain: best.chain ?? null,
      catalog_price: best.price ?? null,
      catalog_category: best.category ?? null,
      catalog_match_type: best.match_type ?? null,
      catalog_match_confidence: best.match_confidence ?? null,
    });
  }
  patch.catalog_match_status = nonFood ? "possible_non_food" : "not_found";
  patch.catalog_needs_review = true;
  return patch;
}

/** Item patch when the user picks a catalog product in "שינוי התאמה". */
// First word of a product name, without quotes/final letters ("קוטג' תנובה" → "קוטג")
const headWord = name => String(name || "").replace(/[׳'"״]/g, "").trim().split(/\s+/)[0]
  ?.replace(/[ךםןףץ]/g, c => ({ ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" })[c]) || "";

export function manualMatchPatch(product, item = null) {
  // The receipt reading's nutrition describes what the AI read. When the user
  // picks a different product (e.g. "קורנפלקס" → "פתיתים אורז"), take the
  // catalog's nutrition instead. (The health score is recomputed by the server
  // from the chosen product on save — src/lib/healthScore.js.)
  const differentProduct = item && headWord(product.original_product_name) !== headWord(item.normalized_name || item.original_name);
  return {
    ...EMPTY_CATALOG,
    ...(differentProduct ? {
      calories_per_100g: product.calories_per_100g ?? null,
      protein_per_100g: product.protein_per_100g ?? null,
      carbs_per_100g: product.carbs_per_100g ?? null,
      fat_per_100g: product.fat_per_100g ?? null,
    } : {}),
    // the item is now known by the product the user chose (the receipt text stays in original_name)
    normalized_name: product.original_product_name,
    matched_product_id: String(product.product_id),
    matched_product_name: product.original_product_name,
    catalog_chain: product.chain ?? null,
    catalog_price: product.price ?? null,
    catalog_price_per_100g: product.price_per_100g ?? null,
    catalog_pack_grams: product.pack_grams ?? null,
    catalog_sold_by_weight: product.sold_by_weight ?? null,
    catalog_category: product.category ?? null,
    catalog_calories_per_100g: product.calories_per_100g ?? null,
    catalog_protein_per_100g: product.protein_per_100g ?? null,
    catalog_carbs_per_100g: product.carbs_per_100g ?? null,
    catalog_fat_per_100g: product.fat_per_100g ?? null,
    catalog_match_type: "manual",
    catalog_match_confidence: 1,
    catalog_match_status: "approved",
    catalog_needs_review: false,
    is_food: true,
  };
}

/**
 * The name to show for a receipt item — the same rule the basket uses
 * (foodName): the product the user picked or approved, else the receipt's reading.
 */
export const receiptItemName = i => foodName(i);

/**
 * Splits a receipt line the reading merged from two products ("צמד פטריח מגורב
 * 6 גרם 250 5% קוטג" = mushrooms + cottage): the second product, picked from the
 * catalog, becomes a new line on the same receipt with its share of the price;
 * the original line keeps the rest. The receipt text stays in original_name.
 * Returns { update: patch for the original line, create: the new line }.
 */
export function splitLine(item, product, secondPrice) {
  const total = Number(item.price) || 0;
  const price = Math.min(Math.max(Number(secondPrice) || 0, 0), Math.max(total, 0));
  return {
    update: { price: Math.round((total - price) * 100) / 100 },
    create: {
      receipt_id: item.receipt_id,
      original_name: item.original_name,
      quantity: "",
      price,
      ...manualMatchPatch(product, { normalized_name: "" }),
    },
  };
}

/** Patches for the other review actions. */
export const approvePatch = () => ({ catalog_match_status: "approved", catalog_needs_review: false });
export const nonFoodPatch = () => ({ ...EMPTY_CATALOG, catalog_match_status: "non_food", catalog_needs_review: false, is_food: false, is_approved_for_menu: false });
export const ignorePatch = () => ({ catalog_match_status: "ignored", catalog_needs_review: false });

/** Short Hebrew reason shown on an item awaiting review. */
export function reviewReason(item) {
  switch (statusOf(item)) {
    case "possible_non_food": return "נראה כמו מוצר שאינו מזון";
    case "not_found": return item.matched_product_name ? "התאמה חלשה בקטלוג" : "לא נמצאה התאמה בקטלוג";
    case "not_checked": return "עדיין לא הותאם לקטלוג";
    default: return "התאמה לא ודאית";
  }
}
