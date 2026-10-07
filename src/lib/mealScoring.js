/**
 * Meal scoring and the weekly objective — deterministic, documented weights.
 *
 *   objective(week) = Σ scoreMeal(c)          static: what the meal is
 *                   − weeklyPenalty(week)      what the week does with it
 *
 * scoreMeal (per candidate, independent of the rest of the week):
 *   protein   protein share of its calories vs the target's share
 *   fat       fat share of calories vs the target's share
 *   carbs     carb share vs the target's (when a carb target is set)
 *   kcal      calories vs the meal's share of the day (portions are balanced
 *             later, so this weighs little)
 *   price     ₪ per kcal vs the basket's typical ₪ per kcal
 *   proteinPrice  ₪ per gram of protein of its main protein vs the basket's typical
 *   realism   how natural the meal pattern is
 *   favorite  contains one of the user's favorite foods
 *   expensive − per product in the basket's most expensive quarter (₪ per kcal)
 * Diet, allergies, dislikes, kosher and meal roles are not scored: candidates
 * that break them are never generated.
 *
 * weeklyPenalty (over the whole week, so every meal choice sees the others):
 *   lunchRepeat   main protein in more than 3 lunches (each extra lunch), when the
 *                 basket has the 3 lunch proteins that makes possible
 *   proteinSpread Σ uses² of each main protein (lunch + dinner) — spreads proteins
 *   dominance     a protein in more than half of the main meals
 *   sameDay       the same main protein twice in one day
 *   consecutive   the same main protein at the same meal on consecutive days
 *   breakfast     Σ uses² of each breakfast style
 *   carbs         Σ uses² of each carb in lunch/dinner
 *   produce       Σ uses² of each vegetable / fruit
 *   identical     the exact same meal again
 *   mealRepeat    Σ (uses − 1)² of each lunch/dinner "meal signature" — pattern +
 *                 main protein + carb, whatever the vegetables and whether lunch or
 *                 dinner: changing one vegetable, or moving the meal to dinner, is no variety
 *   breakfastRepeat  the same for breakfasts
 *   unusedProduce  basket vegetables / fruit the week never uses
 *   cost          estimated weekly cost as a share of the budget: free up to 70%, mild
 *                 to 85%, steep beyond — the headroom goes to variety, not to saving more,
 *                 and the week stays meaningfully below the budget
 *   budget        estimated weekly cost over the budget (fraction over)
 *   proteinShort  each day's protein share below the target (no slack: protein first)
 *   dayFit        each day's protein above +15% and fat share beyond ±10% of the targets
 */
import { MEAL_SHARE, PATTERN_REALISM } from "@/lib/menuCandidates";

/** Default weights; a planner variant multiplies some of them (see PLANNER_VARIANTS). */
export const WEIGHTS = {
  // scoreMeal
  protein: 3, fat: 2, carbs: 1, kcal: 0.5, price: 1.5, proteinPrice: 1.5, realism: 2, favorite: 1, expensive: 1.5,
  // weeklyPenalty
  lunchRepeat: 6, proteinSpread: 0.35, dominance: 3, sameDay: 1.5, consecutive: 0.8,
  breakfast: 0.6, carbs: 0.25, produce: 0.3, identical: 2, budget: 40, proteinShort: 12, dayFit: 2,
  mealRepeat: 2, breakfastRepeat: 0.8, unusedProduce: 0.6, cost: 8,
};
// Cost after portion balancing and buying whole packs is above the raw portion cost
const PURCHASE_OVERHEAD = 1.15;
// Aim a little under the budget: the estimate is not the final purchase cost
const BUDGET_AIM = 0.97;
// Below this share of the budget, a costlier week is not penalized — the headroom buys variety
const COST_FREE_SHARE = 0.7;

// Spending pressure by share of the budget: none up to 70%, mild to 85%, steep past it —
// the week should stay meaningfully below the budget, using the headroom for variety
const COMFORT_SHARE = 0.85;
const costPressure = share => Math.max(0, share - COST_FREE_SHARE) + 4 * Math.max(0, share - COMFORT_SHARE);

/** What a meal is, for variety: its pattern, main protein and carb — not its vegetables or meal slot. */
export const signature = c => `${c.pattern}|${c.main?.id || "-"}|${c.carb?.id || "-"}`;
// Protein that carb sides add while balancing fills the day to its calories
const CARB_PROTEIN_PER_KCAL = 0.035;
// Aim a little above the validator's 90% so a day does not end just under it
const PROTEIN_AIM = 0.97;

const clamp01 = n => Math.max(0, Math.min(1, n));
const closeness = (value, target) => (target > 0 ? 1 - clamp01(Math.abs(value - target) / target) : 0.5);
const median = list => {
  const v = [...list].filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};
const PROTEIN_GROUPS = new Set(["meat", "fish", "eggs", "legumes", "dairy_protein", "yogurt"]);

/**
 * Scoring context from the profile, budget and the basket's own prices:
 * targets as shares of calories, typical ₪/kcal and ₪/g protein, the
 * expensive quarter of products.
 */
export function scoringContext({ catalog, densities, profile, budget, candidates, weights = {} }) {
  const kcal = profile?.daily_calories || 2000;
  const perKcal = p => { const d = densities.get(p.id); return d?.pricePerGram && d.kcal > 0 ? d.pricePerGram * 100 / d.kcal : null; };
  const perProtein = p => { const d = densities.get(p.id); return d?.pricePerGram && d.protein > 0 ? d.pricePerGram * 100 / d.protein : null; };
  const foods = catalog.filter(p => densities.get(p.id) && !["coffee", "tea", "other"].includes(p.group));
  const priced = foods.map(perKcal).filter(Number.isFinite).sort((a, b) => a - b);
  const all = Object.values(candidates).flat();
  return {
    W: { ...WEIGHTS, ...weights },
    kcal,
    proteinShare: profile?.protein_target ? profile.protein_target * 4 / kcal : null,
    fatShare: profile?.fat_target ? profile.fat_target * 9 / kcal : null,
    carbShare: profile?.carbs_target ? profile.carbs_target * 4 / kcal : null,
    budget: budget > 0 ? budget : null,
    favorites: (profile?.favorite_foods || []).filter(Boolean),
    // 7 lunches with each protein in at most 3 needs 3 lunch proteins — with fewer,
    // the rule cannot hold and is not penalized (as in validateMenu)
    // vegetables / fruit the candidates can use — the week should use them
    produceOffered: new Set(Object.values(candidates).flat().flatMap(c => c.produce)),
    lunchRule: new Set((candidates.Lunch || []).filter(c => c.main).map(c => c.main.id)).size >= 3,
    refPerKcal: median(all.map(c => (c.nutrition.kcal > 0 ? c.cost / c.nutrition.kcal : null))) || 0.01,
    refPerProtein: median(foods.filter(p => PROTEIN_GROUPS.has(p.group)).map(perProtein)) || 0.1,
    expensiveFrom: priced.length >= 4 ? priced[Math.floor(priced.length * 0.75)] : Infinity,
    perKcal, perProtein,
  };
}

/** Static score of one candidate meal: { score, parts }. Higher is better. */
export function scoreMeal(c, ctx) {
  const n = c.nutrition;
  const kcal = n.kcal || 1;
  const parts = {};
  const isMain = c.mealType !== "Snacks";
  if (ctx.proteinShare && isMain) parts.protein = closeness(n.protein * 4 / kcal, ctx.proteinShare);
  if (ctx.fatShare) parts.fat = closeness(n.fat * 9 / kcal, ctx.fatShare);
  if (ctx.carbShare) parts.carbs = closeness(n.carbs * 4 / kcal, ctx.carbShare);
  parts.kcal = closeness(kcal, ctx.kcal * MEAL_SHARE[c.mealType]);
  const perKcal = c.cost / kcal;
  parts.price = ctx.refPerKcal / (ctx.refPerKcal + perKcal); // 0.5 at the basket's typical price
  if (c.main) {
    const pp = ctx.perProtein(c.main);
    parts.proteinPrice = pp ? ctx.refPerProtein / (ctx.refPerProtein + pp) : 0.5;
  }
  parts.realism = PATTERN_REALISM[c.pattern] ?? 0.7;
  parts.favorite = c.items.some(i => ctx.favorites.some(f => i.product.name_he.includes(f))) ? 1 : 0;
  parts.expensive = -c.items.filter(i => (ctx.perKcal(i.product) || 0) > ctx.expensiveFrom).length;
  const score = Object.entries(parts).reduce((s, [k, v]) => s + (ctx.W[k] || 0) * v, 0);
  return { score, parts };
}

const bump = (m, k, by = 1) => m.set(k, (m.get(k) || 0) + by);
const sumSquares = m => [...m.values()].reduce((s, v) => s + v * v, 0);

/**
 * Penalty for how the week uses its meals: week is days × slots of candidates
 * (or null). Returns { penalty, parts }.
 */
export function weeklyPenalty(week, ctx) {
  const lunchMain = new Map(), mainUse = new Map(), breakfast = new Map(), carbs = new Map(), produce = new Map(), identical = new Map();
  const mealSig = new Map(), breakfastSig = new Map();
  let sameDay = 0, consecutive = 0, mains = 0, cost = 0, kcal = 0, dayFit = 0, proteinShort = 0;
  week.forEach((day, di) => {
    const mainsToday = new Map();
    let dk = 0, dp = 0, df = 0;
    for (const c of day) {
      if (!c) continue;
      bump(identical, c.id);
      cost += c.cost; kcal += c.nutrition.kcal;
      dk += c.nutrition.kcal; dp += c.nutrition.protein; df += c.nutrition.fat;
      for (const p of c.produce) bump(produce, p);
      if (c.mealType === "Lunch" || c.mealType === "Dinner") bump(mealSig, signature(c));
      if (c.mealType === "Breakfast") bump(breakfastSig, signature(c));
      if (c.mealType === "Breakfast") bump(breakfast, c.style);
      if (c.main && c.mealType !== "Snacks") bump(mainsToday, c.main.id);
      if (c.mealType === "Lunch" || c.mealType === "Dinner") {
        mains++;
        if (c.main) bump(mainUse, c.main.id);
        if (c.carb) bump(carbs, c.carb.id);
        if (c.mealType === "Lunch" && c.main) bump(lunchMain, c.main.id);
        const prev = week[di - 1]?.find(x => x?.mealType === c.mealType);
        if (prev?.main && c.main && prev.main.id === c.main.id) consecutive++;
      }
    }
    for (const n of mainsToday.values()) sameDay += Math.max(0, n - 1);
    if (dk > 0) {
      const ratio = dp * 4 / dk;
      if (ctx.proteinShare) {
        // protein after portion balancing: calories missing to the target come
        // mostly from carbs (~3.5 g protein per 100 kcal); a day over the target shrinks
        const after = dk < ctx.kcal ? dp + (ctx.kcal - dk) * CARB_PROTEIN_PER_KCAL : dp * ctx.kcal / dk;
        const needed = ctx.proteinShare * ctx.kcal / 4;
        proteinShort += Math.max(0, (needed * PROTEIN_AIM - after) / needed);
        dayFit += Math.max(0, (ratio - ctx.proteinShare) / ctx.proteinShare - 0.15);
      }
      if (ctx.fatShare) dayFit += Math.max(0, Math.abs(df * 9 / dk - ctx.fatShare) / ctx.fatShare - 0.1);
    }
  });
  const parts = {
    lunchRepeat: ctx.lunchRule ? [...lunchMain.values()].reduce((s, n) => s + Math.max(0, n - 3), 0) : 0,
    proteinSpread: sumSquares(mainUse) / 7,
    dominance: [...mainUse.values()].reduce((s, n) => s + Math.max(0, n - mains / 2), 0),
    sameDay, consecutive,
    breakfast: sumSquares(breakfast) / 7,
    carbs: sumSquares(carbs) / 7,
    produce: sumSquares(produce) / 7,
    identical: [...identical.values()].reduce((s, n) => s + Math.max(0, n - 1), 0),
    mealRepeat: [...mealSig.values()].reduce((s, n) => s + (n - 1) ** 2, 0),
    breakfastRepeat: [...breakfastSig.values()].reduce((s, n) => s + (n - 1) ** 2, 0) / 2,
    unusedProduce: ctx.produceOffered ? [...ctx.produceOffered].filter(p => !produce.has(p)).length : 0,
    cost: ctx.budget && kcal > 0 ? costPressure((cost / kcal) * ctx.kcal * 7 * PURCHASE_OVERHEAD / ctx.budget) : 0,
    // weekly cost estimate: the week's ₪ per kcal × the calories the week will have after balancing
    budget: ctx.budget && kcal > 0 ? Math.max(0, (cost / kcal) * ctx.kcal * 7 * PURCHASE_OVERHEAD / (ctx.budget * BUDGET_AIM) - 1) : 0,
    proteinShort,
    dayFit,
  };
  const penalty = Object.entries(parts).reduce((s, [k, v]) => s + (ctx.W[k] || 0) * v, 0);
  return { penalty, parts, estimatedCost: kcal > 0 ? (cost / kcal) * ctx.kcal * 7 * PURCHASE_OVERHEAD : 0 };
}

/**
 * Planner variants — the same planner with a different emphasis. The menu
 * generator builds the week with each, balances and validates every result,
 * and keeps the best (src/lib/nutritionPlanGenerator.js). Deterministic: a
 * fixed list in a fixed order.
 */
export const PLANNER_VARIANTS = [
  { name: "balanced", weights: {} },
  // protein first: a short day costs far more, repeats cost less
  { name: "protein", weights: { proteinShort: WEIGHTS.proteinShort * 3, protein: WEIGHTS.protein * 2,
    ...Object.fromEntries(["proteinSpread", "lunchRepeat", "dominance", "sameDay", "consecutive", "identical", "carbs"].map(k => [k, WEIGHTS[k] * 0.2])) } },
  // budget first: the cheaper meal wins more often
  { name: "budget", weights: { budget: WEIGHTS.budget * 3, price: WEIGHTS.price * 2, proteinPrice: WEIGHTS.proteinPrice * 2, expensive: WEIGHTS.expensive * 2 } },
];
