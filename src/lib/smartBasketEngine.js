/**
 * Smart basket engine — deterministic, explainable additions around the
 * user's receipt (no AI). The same inputs always give the same basket.
 *
 *   receipt items + history regulars   (the basket's anchor, chosen by the page)
 *        ↓
 *   candidate pool: catalog CANDIDATES (basketAlternatives) + purchase history
 *        ↓
 *   hard filters: diet, allergies, disliked foods, supplements, duplicates
 *        ↓
 *   phase 2 — weekly needs: protein variety, bread, grains, fats, vegetables,
 *             fruit, a second breakfast base (eggs / yogurt / cereal), breakfast dairy; within each need the user's favorite
 *             foods first (profile.favorite_foods), then the best candidateScore
 *   phase 3 — a few optional personal picks (variety / strong history / healthy)
 *        ↓
 *   (the page then runs missingStaples → missingProtein, and the budget trim)
 *
 * candidateScore = 0.30·nutritionalFit + 0.25·health + 0.20·history
 *                + 0.15·price + 0.10·variety       (each 0..1)
 */
import {
  CANDIDATES, candidateGroup, violatesProfile, mentions, searchCandidate, catalogItem,
  itemGroup, itemFamily, itemPer100g, profileConflict, isSupplement, isDisliked, isFavorite,
} from "@/lib/basketAlternatives";
import { normalizeHebrew } from "@/lib/mealPlanRules";
import { parseQuantityGrams } from "@/lib/mealPlanCalories";
import { productHealthScore } from "@/lib/healthScore";

export const WEIGHTS = { nutrition: 0.30, health: 0.25, history: 0.20, price: 0.15, variety: 0.10 };

// What a weekly basket needs, in this order. `staple` needs are the ones
// missingStaples also guarantees (never trimmed for budget); the others can
// be trimmed after optional picks and history regulars.
export const BASKET_NEEDS = [
  { key: "protein", roles: ["protein", "dairy"], count: 3, byKind: true,
    reason: "הוספנו את המוצר כי הוא מקור חלבון איכותי שמתאים ליעד שלך." },
  { key: "bread", groups: ["bread", "cereal"], count: 1, staple: true,
    reason: "הוספנו לחם לארוחות הבוקר והערב, כדי שהתפריט יגיע ליעד הקלורי שלך." },
  { key: "grain", groups: ["grain", "starch_veg"], count: 2, staple: true,
    reason: "הוספנו מקור פחמימה כדי להשלים את הסל לשבוע." },
  // A cooking oil first (trimmable on a tight budget), then healthy fats by score
  { key: "oil", groups: ["oil"], count: 1,
    reason: "הוספנו שמן לבישול ולסלטים." },
  // avocado already in the basket counts as a healthy fat (never a fruit
  // serving), but the fats the engine adds are oil, tahini and nuts
  { key: "fat", groups: ["oil", "tahini", "nuts", "avocado"], pick: ["oil", "tahini", "nuts"], count: 2, staple: true,
    reason: "הוספנו מקור שומן בריא לסל." },
  { key: "vegetable", roles: ["vegetable"], count: 4,
    reason: "הוספנו ירק כדי שבסל יהיו מספיק ירקות לשבוע." },
  { key: "fruit", roles: ["fruit"], count: 2,
    reason: "הוספנו פרי כדי להשלים את הסל לשבוע." },
  // Breakfast needs a second base beside bread: with bread alone, one product the
  // menu cannot use leaves the week without breakfasts. Trimmable on a tight budget.
  { key: "breakfast", groups: ["eggs", "yogurt", "cereal"], count: 1,
    reason: "הוספנו מוצר לארוחת הבוקר, כדי שיהיו בתפריט ארוחות בוקר מגוונות." },
  { key: "dairy", roles: ["dairy"], count: 1,
    reason: "הוספנו מוצר חלבי לארוחות הבוקר." },
];

// Same order of magnitude as the AI additions it replaces (6–12 around a
// receipt, 12–18 for an empty basket); optional picks are capped separately
const MAX_ADDITIONS_WITH_RECEIPT = 12;
const MAX_ADDITIONS_EMPTY = 18;
const MAX_OPTIONAL = 4;
const OPTIONAL_MIN_SCORE = 0.6;
const OPTIONAL_ROLES = ["vegetable", "fruit", "dairy"];
const STRONG_HISTORY = 0.65;

const REASON_HISTORY = "המוצר נרכש אצלך בתדירות גבוהה, בעל ציון בריאות טוב ומתאים לסל השבועי.";
const REASON_FAVORITE = "הוספנו את המוצר כי הוא ברשימת המזונות האהובים שלך, והוא משלים את מה שחסר בסל.";
const REASON_OPTIONAL = "המוצר מוסיף מגוון תזונתי לסל ונמצא במסגרת התקציב.";

const clamp01 = n => Math.max(0, Math.min(1, n));
const round3 = n => Math.round(n * 1000) / 1000;

export const sameFood = (a, b) => {
  const [x, y] = [normalizeHebrew(a), normalizeHebrew(b)];
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

const ROLE_BY_GROUP = {
  meat: "protein", fish: "protein", eggs: "protein", legumes: "protein",
  dairy_protein: "dairy", yogurt: "dairy", milk: "milk", plant_milk: "milk",
  grain: "carb", bread: "carb", starch_veg: "carb", cereal: "carb",
  vegetable: "vegetable", fruit: "fruit", nuts: "fat", tahini: "fat", oil: "fat", avocado: "fat",
};

/** The catalog candidate type an item is (e.g. any cottage → "קוטג'"), or null. */
const candidateOf = name => CANDIDATES.find(c => mentions(name, c)) || null;

/**
 * Protein "kind" for variety: the animal family (meat, fish, eggs, dairy),
 * or the specific plant food (tofu, lentils…) so plant-based baskets can
 * still reach three different protein sources.
 */
const PROTEIN_FAMILY = {
  meat: "meat_protein", fish: "fish_protein", eggs: "egg_protein", legumes: "plant_protein",
  dairy_protein: "dairy_protein", yogurt: "dairy_protein",
};
export function proteinKind(item, group = item.group || itemGroup(item)) {
  const family = PROTEIN_FAMILY[group] || itemFamily(item);
  if (family === "plant_protein") return `plant:${candidateOf(item.name)?.label || normalizeHebrew(item.name).split(" ")[0]}`;
  return family;
}

/** What a need counts: distinct protein kinds, or items of its roles/groups. */
export function needHave(need, basket, groupOf = defaultGroup) {
  const matching = basket.filter(i => fitsNeed(need, i, groupOf(i)));
  return need.byKind ? new Set(matching.map(i => proteinKind(i, groupOf(i))).filter(Boolean)).size : matching.length;
}

const defaultGroup = item => item.group || itemGroup(item);

export function fitsNeed(need, item, group = defaultGroup(item)) {
  if (need.groups) return need.groups.includes(group);
  return need.roles.includes(ROLE_BY_GROUP[group]);
}

// ─── Scores (all pure, 0..1) ─────────────────────────────────────────────────

/**
 * How well a product fills the current need, from its per-100g values.
 * Role-aware: protein density only matters for protein needs, low energy for
 * vegetables, etc.
 */
// The fat need is for cooking and salads: oil first, then tahini/avocado, nuts last
const FAT_FIT = { oil: 1, tahini: 0.9, avocado: 0.8, nuts: 0.7 };

export function nutritionalFit(needKey, per100, group = null) {
  if ((needKey === "fat" || needKey === "oil") && FAT_FIT[group] != null) return FAT_FIT[group];
  if (!per100 || !(per100.kcal > 0)) return 0.5;
  const proteinPer100kcal = (per100.protein || 0) / per100.kcal * 100;
  switch (needKey) {
    case "protein":
    case "dairy":
    case "breakfast":
      // chicken breast ≈19 g/100 kcal → 1; lentils ≈8 → 0.5; energy-dense foods lose a little
      return clamp01(proteinPer100kcal / 15) * (per100.kcal > 300 ? 0.8 : 1);
    case "bread":
    case "grain":
      // satiety: a little protein with the carbs (oats, whole bread > white rice)
      return clamp01(0.5 + 0.5 * proteinPer100kcal / 4);
    case "vegetable":
      return clamp01(1 - per100.kcal / 120);
    case "fruit":
      return clamp01(1 - Math.max(0, per100.kcal - 40) / 120);
    default:
      return 0.5;
  }
}

export const healthOf = name => {
  const s = productHealthScore(name);
  return s == null ? 0.5 : s / 10;
};

/** Price per 100 g, relative to the other options for the same need: cheapest 1, dearest 0. */
export function priceScores(entries) {
  const prices = entries.map(e => e.pricePer100).filter(p => p > 0);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return entries.map(e => (!(e.pricePer100 > 0) || prices.length < 2 || max === min ? 0.5 : (max - e.pricePer100) / (max - min)));
}

/** Variety key: protein kind; for carbs the food group; otherwise the product type. */
export function varietyKey(needKey, item, group = defaultGroup(item)) {
  if (needKey === "protein" || needKey === "dairy") return proteinKind(item, group);
  if (needKey === "bread" || needKey === "grain") return group;
  return canonicalProduceFamily(item.name) || candidateOf(item.name)?.label || normalizeHebrew(item.name).split(" ")[0];
}

/** New kind → 1, one already → 0.7, two → 0.4, more → 0.2. */
export function varietyScore(needKey, item, basket, groupOf = defaultGroup, group = defaultGroup(item)) {
  const need = BASKET_NEEDS.find(n => n.key === needKey);
  const key = varietyKey(needKey, item, group);
  const n = basket.filter(b => need && fitsNeed(need, b, groupOf(b)) && varietyKey(needKey, b, groupOf(b)) === key).length;
  return [1, 0.7, 0.4][n] ?? 0.2;
}

export function scoreCandidate({ nutrition, health, history, price, variety }) {
  return round3(WEIGHTS.nutrition * nutrition + WEIGHTS.health * health + WEIGHTS.history * history +
    WEIGHTS.price * price + WEIGHTS.variety * variety);
}

/**
 * Pool entries for one need, scored and sorted (best first). Pure.
 * The user's favorite foods come first: the user said they want them (the
 * budget is applied before ranking, so a favorite never breaks it).
 * avoid(item): products an alternative basket should not repeat — taken only
 * when nothing else fits the need (same scoring otherwise; buildBasketAlternatives).
 */
export function rankCandidates(needKey, entries, basket, groupOf = defaultGroup, favorites = [], { avoid = null } = {}) {
  const prices = priceScores(entries);
  return entries
    .map((e, i) => {
      const parts = {
        nutrition: nutritionalFit(needKey, e.per100, e.group),
        health: healthOf(e.item.name),
        history: e.history?.history_score ?? 0.5,
        price: prices[i],
        variety: varietyScore(needKey, e.item, basket, groupOf, e.group),
      };
      return { ...e, parts, score: scoreCandidate(parts), favorite: isFavorite(e.item.name, favorites), avoided: !!avoid?.(e.item) };
    })
    // ties: higher health, then cheaper, then name — fully deterministic
    // (a product to avoid only when nothing else fits)
    .sort((a, b) => Number(a.avoided) - Number(b.avoided) || Number(b.favorite) - Number(a.favorite) || b.score - a.score || b.parts.health - a.parts.health ||
      (a.pricePer100 || Infinity) - (b.pricePer100 || Infinity) || a.item.name.localeCompare(b.item.name, "he"));
}

// ─── Duplicates ──────────────────────────────────────────────────────────────

// Basic produce families: "עגבניות", "עגבניה ירדן", "עגבניות שרי" are all tomatoes
const PRODUCE_FAMILIES = [
  [/עגבני/, "tomato"], [/מלפפונ/, "cucumber"], [/פלפל(?! שחור| לבן| חריף טחון)/, "pepper"], [/גזר/, "carrot"],
  [/(^| )חסה|(^| )חס( |$)/, "lettuce"], [/תפוח(?!י? אדמה)|תפוחי עצ/, "apple"], [/בננ/, "banana"], [/תפוז/, "orange"],
  [/קלמנטינ|מנדרינ/, "clementine"], [/ענב/, "grapes"], [/אבוקדו/, "avocado"], [/לימונ/, "lemon"],
  [/בצל/, "onion"], [/ברוקולי/, "broccoli"], [/כרובית/, "cauliflower"], [/קישוא|זוקיני/, "zucchini"],
];

/** The basic produce family of a name ("עגבניה ירדן" → "tomato"), or null. */
export function canonicalProduceFamily(name) {
  const n = ` ${normalizeHebrew(name)} `;
  return PRODUCE_FAMILIES.find(([re]) => re.test(n))?.[1] ?? null;
}

/**
 * Already in the basket: the same product, or the same product type (e.g. a
 * second cottage of another fat %). Replacement may still pick a variant.
 */
export function isDuplicate(item, basket) {
  if (basket.some(b => sameFood(b.name, item.name))) return true;
  const produce = canonicalProduceFamily(item.name);
  if (produce && basket.some(b => canonicalProduceFamily(b.name) === produce)) return true;
  const c = candidateOf(item.name);
  return !!c && basket.some(b => mentions(b.name, c));
}

// ─── Selection (pure) ────────────────────────────────────────────────────────

/**
 * Picks additions from a pool for the basket's needs, then a few optional
 * ones. pool: [{ item, group, per100, pricePer100, history?, source }].
 * Returns the added basket items (with reason and source flags).
 */
export function selectCandidates(pool, basket, { budgetLeft = Infinity, hasReceipt = true, favorites = [], avoid = null } = {}) {
  const rankOpts = { avoid };
  const current = [...basket];
  const added = [];
  // The group each pool product was searched as (e.g. "חלבון סויה" → legumes)
  const groups = new Map(pool.map(e => [e.item, e.group]));
  const groupOf = item => groups.get(item) || defaultGroup(item);
  let left = budgetLeft;
  const maxAdd = hasReceipt ? MAX_ADDITIONS_WITH_RECEIPT : MAX_ADDITIONS_EMPTY;
  const available = () => pool.filter(e => !isDuplicate(e.item, current));

  const take = (e, extra) => {
    const item = {
      ...e.item,
      ...extra,
      health_score: productHealthScore(e.item.name),
      candidate_score: e.score,
      ...(e.history ? {
        history_score: e.history.history_score,
        history_receipt_count: e.history.receipt_count,
        history_total_receipts: e.history.total_receipts,
      } : {}),
    };
    groups.set(item, e.group);
    current.push(item);
    added.push(item);
    left -= item.estimated_price || 0;
  };

  // Phase 2 — weekly needs (nutrition before preference)
  for (const need of BASKET_NEEDS) {
    while (needHave(need, current, groupOf) < need.count && added.length < maxAdd) {
      let options = available().filter(e => fitsNeed(need, e.item, e.group) && (!need.pick || need.pick.includes(e.group)));
      // protein variety: only kinds the basket does not have yet
      if (need.byKind) {
        const kinds = new Set(current.filter(i => fitsNeed(need, i, groupOf(i))).map(i => proteinKind(i, groupOf(i))));
        options = options.filter(e => !kinds.has(proteinKind(e.item, e.group)));
      }
      if (!options.length) break;
      // Budget-aware: the best option that still fits the budget left; when
      // none fits, a staple (never trimmed later) takes the cheapest one
      const fitting = options.filter(e => (e.item.estimated_price || 0) <= left);
      const best = fitting.length ? rankCandidates(need.key, fitting, current, groupOf, favorites, rankOpts)[0]
        : need.staple ? rankCandidates(need.key, options, current, groupOf, [], rankOpts)
          .sort((x, y) => Number(x.avoided) - Number(y.avoided) || (x.item.estimated_price || 0) - (y.item.estimated_price || 0))[0]
          : rankCandidates(need.key, options, current, groupOf, favorites, rankOpts)[0];
      take(best, {
        reason: best.favorite ? REASON_FAVORITE : best.history && best.history.history_score > 0.6 ? REASON_HISTORY : need.reason,
        from_engine: true,
        basket_need: need.key,
        ...(need.staple ? { added_staple: true } : {}),
      });
    }
  }

  // Phase 3 — optional personal picks, within the budget left. MAX_OPTIONAL
  // is a cap, not a target: a pick must add real value —
  //   A. a strong purchase habit, or
  //   B/C. a very healthy product of a new kind for a role still below its
  //        target (produce / breakfast dairy only; extra protein is
  //        missingProtein's job).
  // Once every need is covered only habits qualify, so a complete basket gets 0.
  // (re-ranked after every pick, so a second product of the same kind loses its variety bonus)
  for (let optional = 0; optional < MAX_OPTIONAL && added.length < maxAdd; optional++) {
    const best = BASKET_NEEDS
      .flatMap(need => rankCandidates(need.key, available().filter(e => fitsNeed(need, e.item, e.group)), current, groupOf, [], rankOpts)
        .map(e => ({ ...e, needKey: need.key, needMet: needHave(need, current, groupOf) >= need.count })))
      .filter(e => (e.item.estimated_price || 0) <= left)
      .filter(e => e.score >= OPTIONAL_MIN_SCORE && (e.parts.history >= STRONG_HISTORY ||
        (OPTIONAL_ROLES.includes(e.needKey) && !e.needMet && e.parts.variety === 1 && e.parts.health >= 0.8)))
      .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, "he"))[0];
    if (!best) break;
    take(best, { reason: best.history && best.history.history_score > 0.6 ? REASON_HISTORY : REASON_OPTIONAL, from_engine: true, basket_optional: true });
  }
  return added;
}

// ─── Candidate pool (async: catalog lookups) ─────────────────────────────────

/**
 * Catalog candidates that pass every hard filter for this profile and are
 * not in the basket yet, as pool entries. One cached search per candidate.
 */
export async function catalogPool(profile, basket, search = searchCandidate) {
  const disliked = profile?.disliked_foods || [];
  const eligible = CANDIDATES.filter(c =>
    ["protein", "dairy", "carb", "vegetable", "fruit", "fat"].includes(c.role) &&
    !violatesProfile(c, profile) &&
    !isDisliked(c.label, disliked, candidateGroup(c)) &&
    !basket.some(b => mentions(b.name, c)));
  const options = await Promise.all(eligible.map(c => search(c).catch(() => null)));
  return options
    .filter(Boolean)
    .map(o => ({ o, item: catalogItem(o, {}) }))
    .filter(({ o, item }) => passesHardFilters(item, profile) && !isDisliked(o.product.original_product_name, disliked, o.group))
    .map(({ o, item }) => ({
      item, group: o.group, per100: o.per100, pricePer100: o.product.price / o.grams * 100, source: "catalog",
    }));
}

/** History products (not regulars) as pool entries. historyItems: [{ item (basket-shaped), history }]. */
export function historyPool(historyItems, profile) {
  return historyItems
    .filter(h => passesHardFilters(h.item, profile))
    .map(({ item, history }) => {
      const group = itemGroup(item);
      const grams = parseQuantityGrams(item.quantity, group);
      return {
        item, group, history, source: "history",
        per100: itemPer100g(item, group),
        pricePer100: grams && item.estimated_price > 0 ? item.estimated_price / grams * 100 : null,
      };
    });
}

/** Diet, allergies, supplements and disliked foods — before any scoring. */
export function passesHardFilters(item, profile) {
  if (!item?.name) return false;
  if (profileConflict(item, profile) || isSupplement(item)) return false;
  return !isDisliked(item.name, profile?.disliked_foods || []);
}

/**
 * The deterministic additions for a basket: builds the pool, then selects.
 * Returns the added items (the page appends them, then runs missingStaples
 * and the budget trim).
 */
export async function buildSmartAdditions({ basket, historyItems = [], profile, budgetLeft, hasReceipt, search, avoid }) {
  const pool = [...historyPool(historyItems, profile), ...await catalogPool(profile, basket, search)];
  return selectCandidates(pool, basket, { budgetLeft, hasReceipt, favorites: profile?.favorite_foods || [], avoid });
}
