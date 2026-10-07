/**
 * Prices and costs — one model for the whole flow (receipt → basket → menu →
 * final list), so every step computes the same number for the same food.
 *
 * Every basket item carries:
 *   price_per_kg    ₪ per kg (or per litre) — the true unit price
 *   sold_by_weight  true for products weighed at the counter (meat, produce…):
 *                   any amount can be bought, cost = grams × price_per_kg
 *   pack_grams      the pack size for products sold in packs:
 *                   cost = packs needed × pack price
 *
 * Kept free of "@/" imports: the server uses it too.
 */

// The catalog import stored packages priced per kg ("1קילוגרם") with the
// weight in kg (quantity 1 → 1 g), which made their price per 100 g 1000× too high
const KG_UNIT = /קילוגרם|ק"ג|קג/;
const LITRE_UNIT = /ליטר/;

/**
 * A catalog row's real pack weight in grams, and whether its price is per kg
 * (a weighed product). Row: { quantity_in_grams, package_unit, original_product_name }.
 */
// Larger than any household pack: an import error, not a weight
const MAX_PACK_GRAMS = 20000;

export function catalogPack(row) {
  const q = Number(row?.quantity_in_grams);
  const unit = String(row?.package_unit || "");
  if (KG_UNIT.test(unit) && q > 0 && q < 50) {
    // "1קילוגרם" with quantity 1 is a weighed product priced per kg
    return { grams: Math.round(q * 1000), soldByWeight: unit.startsWith("1") && q === 1 && !nameWeight(row) };
  }
  if (LITRE_UNIT.test(unit) && q > 0 && q < 50) return { grams: Math.round(q * 1000), soldByWeight: false };
  // "100 מיליליטר" rows were stored ×1000 ("50 מ"ל" → 50000): the name has the real volume
  const named = nameWeight(row);
  if (named && q === named * 1000) return { grams: named, soldByWeight: false };
  if (q >= 1 && q <= MAX_PACK_GRAMS) return { grams: q, soldByWeight: false };
  return { grams: nameWeight(row), soldByWeight: false };
}

// The weight written in a product name ("חזה עוף טרי 1 ק"ג" → 1000), or null — a packed product
function nameWeight(row) {
  const m = String(row?.original_product_name || "").replace(/[״]/g, '"')
    .match(/(\d+(?:\.\d+)?)\s*(ק"ג|קג|קילו|ליטר|גרם|גר|ג'|מ"ל|מל)(?![א-ת])/);
  if (!m) return null;
  const g = parseFloat(m[1]) * (/ק"ג|קג|קילו|ליטר/.test(m[2]) ? 1000 : 1);
  return g >= 1 && g <= MAX_PACK_GRAMS ? g : null;
}

/** Corrected price per 100 g for a catalog row, or null. */
export function catalogPricePer100g(row) {
  const { grams } = catalogPack(row);
  return grams && row?.price > 0 ? Math.round(row.price / grams * 100 * 1000) / 1000 : null;
}

const round1 = n => Math.round(n * 10) / 10;

/** ₪ per gram of an item, from its pricing fields (or its price ÷ quantity for older items). */
export function pricePerGram(item, quantityGrams = null) {
  if (Number(item?.price_per_kg) > 0) return item.price_per_kg / 1000;
  if (Number(item?.pack_grams) > 0 && Number(item?.pack_price) > 0) return item.pack_price / item.pack_grams;
  if (quantityGrams > 0 && Number(item?.estimated_price) > 0) return item.estimated_price / quantityGrams;
  return null;
}

/**
 * What buying `grams` of an item costs: weighed products by the gram, packed
 * products by whole packs. Returns { cost, purchaseGrams, packs } or null
 * when the item has no usable price.
 */
export function purchaseCost(item, grams, fallbackQuantityGrams = null) {
  if (!(grams > 0)) return { cost: 0, purchaseGrams: 0, packs: 0 };
  const packGrams = Number(item?.pack_grams) || 0;
  const packPrice = Number(item?.pack_price) || 0;
  if (!item?.sold_by_weight && packGrams > 0 && packPrice > 0) {
    const packs = Math.max(1, Math.ceil(grams / packGrams - 1e-9));
    return { cost: round1(packs * packPrice), purchaseGrams: packs * packGrams, packs };
  }
  const perGram = pricePerGram(item, fallbackQuantityGrams);
  if (!perGram) return null;
  return { cost: round1(grams * perGram), purchaseGrams: grams, packs: null };
}

/**
 * Pricing fields for a basket item.
 *   price      ₪ for `packGrams` grams (a pack, or 1 kg for weighed products)
 *   grams      the amount the basket item holds (receipt quantity / pack)
 */
export function pricingFields({ price, packGrams: rawPack, soldByWeight, grams }) {
  const packGrams = Math.round(rawPack); // "1.005 ליטר" parses to 1004.999…
  if (!(price > 0) || !(packGrams > 0)) return {};
  const perKg = Math.round(price / packGrams * 1000 * 100) / 100;
  const amount = grams > 0 ? grams : packGrams;
  const estimated = soldByWeight
    ? round1(perKg * amount / 1000)
    : round1(Math.max(1, Math.ceil(amount / packGrams - 1e-9)) * price);
  return {
    price_per_kg: perKg,
    sold_by_weight: !!soldByWeight,
    pack_grams: soldByWeight ? null : packGrams,
    pack_price: soldByWeight ? null : price,
    estimated_price: estimated,
  };
}

// Food groups usually bought by weight when nothing says otherwise (no catalog pack)
const WEIGHED_GROUPS = new Set(["meat", "fish", "vegetable", "fruit", "avocado", "starch_veg"]);
const PACKED_NAME = /טונה|שימורי|קופסה|קפוא|מארז|\d+\s*(?:גרם|גר|ג'|יח)/;
export const isWeighedGroup = (group, name = "") => WEIGHED_GROUPS.has(group) && !PACKED_NAME.test(name);

/**
 * The weekly food budget from the profile: the monthly budget over 30 days,
 * or the per-visit budget × visits per week.
 */
export function weeklyBudget(profile) {
  return Math.round(profile?.monthly_budget
    ? profile.monthly_budget * 7 / 30
    : (profile?.budget_per_purchase || 500) * Math.max(1, (profile?.purchases_per_month || 4) / 4.3));
}

/** The budget a basket is held to: the weekly budget, or a higher amount the user accepted. */
export function basketBudget(profile, basket) {
  return Math.max(weeklyBudget(profile), Number(basket?.accepted_budget) || 0);
}
