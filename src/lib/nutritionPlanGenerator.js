/**
 * Nutrition-plan generation — deterministic, no AI (only receipt reading uses AI).
 *
 *   basket → product catalog (food groups, meal roles, kosher type)
 *          → candidate meals (src/lib/menuCandidates.js), scored (src/lib/mealScoring.js)
 *          → the week: greedy + fixed-order local search (src/lib/weeklyPlanner.js),
 *            once per planner variant (balanced / protein first / budget first)
 *          → each week: portions balanced to the calorie / protein / fat targets
 *            (finalizeDays, closeCalories — src/lib/mealPlanCalories.js), fitted to
 *            the weekly budget (src/lib/mealPlanBudget.js), validated (src/lib/validateMenu.js)
 *          → the best week by quality level, failed checks, cost
 *
 * The same basket, profile and budget always give the same menu. "בנייה מחדש"
 * passes the current menu as `previous`: the next deterministic alternative is
 * returned instead — the valid weeks in a fixed order (best, variety first,
 * budget first, protein first, then one planned away from the best week's
 * meals), without near-copies of each other, the one after the current menu.
 */

import {
  buildProductCatalog, validatePlan, forceRepair, recomputeTotals, classifyProduct,
} from '@/lib/mealPlanRules';
import { buildDensities, applyDensities, finalizeDays, closeCalories } from '@/lib/mealPlanCalories';
import { planWeek } from '@/lib/weeklyPlanner';
import { PLANNER_VARIANTS } from '@/lib/mealScoring';
import { validateMenu } from '@/lib/validateMenu';
import { fitPlanToBudget, planCost } from '@/lib/mealPlanBudget';
import { profileConflict, isSupplement, isDisliked } from '@/lib/basketAlternatives';
import { isPlainWater } from '@/lib/receiptClassifier';


// What each breakfast / lunch / dinner is built around: main protein + carb (by name)
const PROTEIN_GROUPS = new Set(["meat", "fish", "legumes", "eggs", "dairy_protein", "yogurt"]);
const CARB_GROUPS = new Set(["grain", "starch_veg", "bread", "cereal"]);
const mealCore = m => {
  const first = groups => m.items.find(i => groups.has(classifyProduct(i.food_name)))?.food_name || "-";
  return `${first(PROTEIN_GROUPS)}|${first(CARB_GROUPS)}`;
};
const slotCores = days => days.flatMap(d => ["Breakfast", "Lunch", "Dinner"].map(t => {
  const m = d.meals.find(x => x.meal_type === t);
  return `${d.day_name}/${t}/${m ? mealCore(m) : "-"}`;
}));
// Two weeks are meaningfully different when at least a quarter of their meals are built differently
const MIN_DIFFERENT_SHARE = 0.25;
export function menuDifference(daysA, daysB) {
  const a = slotCores(daysA || []), b = new Set(slotCores(daysB || []));
  return a.length ? a.filter(s => !b.has(s)).length / a.length : 1;
}
const sameMenu = (x, y) => menuDifference(x, y) < MIN_DIFFERENT_SHARE;
// Order the alternatives are offered in, after the best week
const ALTERNATIVE_ORDER = ["variety", "budget", "protein", "balanced", "fresh"];

export const PLAN_FAILED_MESSAGE = "לא הצלחנו לבנות תפריט מהמוצרים שבסל. הוסיפו לסל מוצרים לארוחות (חלבון, פחמימה וירקות) ונסו שוב.";

/** Hebrew notes for a day that misses a target, with its real numbers. */
function targetWarnings(report, { calories, protein, fat }) {
  const notes = [];
  const basketLimited = report.limits?.includes("protein limited by basket");
  for (const f of report.failures || []) {
    if (f.startsWith("calories")) notes.push(`קלוריות: ${report.after} — ${report.after > calories ? "מעל ה" : "מתחת ל"}יעד של ${calories}`);
    else if (f.startsWith("protein") && report.protein > protein) notes.push(`חלבון: ${report.protein} גרם — מעל יעד של ${protein} גרם`);
    else if (f.startsWith("protein")) notes.push(`חלבון: ${report.protein} גרם — מתחת ליעד של ${protein} גרם`);
    else if (f.startsWith("fat")) notes.push(`שומן: ${report.fat} גרם — ${report.fat > fat ? "מעל ה" : "מתחת ל"}יעד של ${fat} גרם`);
  }
  if (basketLimited) notes.push(`חלבון: ${report.protein} גרם — מתחת ליעד של ${protein} גרם, כי מקורות החלבון שבסל לא מספיקים בתוך יעד הקלוריות`);
  return notes;
}

/**
 * Builds the weekly plan for a basket.
 * budget: the weekly food budget (₪). The menu is fitted to it before it is
 * returned, so the final shopping list built from it already fits; result.budget
 * says whether it does.
 * Returns { days, weekly_calories, estimated_weekly_cost, budget, validation }.
 * (async for the callers; nothing here waits on a service)
 */
export async function generateNutritionPlan({ list, profile, budget = null, previous = null }) {
  const target = profile?.daily_calories || 2000;
  // Only foods this user eats — every step below (templates, balancing sides,
  // budget swaps) picks from this catalog. Plain water adds nothing to a meal:
  // it stays in the basket, not the menu.
  const eatable = (list.items || []).filter(i => !isPlainWater(i.name) &&
    !profileConflict(i, profile) && !isSupplement(i) && !isDisliked(i.name, profile?.disliked_foods || []));
  const catalog = buildProductCatalog(eatable);
  // Per-100g values from the basket, else typical values for the food group
  const densities = buildDensities(catalog, { days: [] });

  const targets = { calories: target, protein: profile?.protein_target, fat: profile?.fat_target };

  // The rest of the pipeline for one planned week: portions balanced to the
  // targets, fitted to the budget, rule safety net, final cost. null when the
  // basket cannot fill the days.
  const complete = (planned, log = console) => {
    const plan = { days: structuredClone(planned.days) };
    const mealCount = plan.days.reduce((s, d) => s + d.meals.length, 0);
    if (!plan.days.length || mealCount < plan.days.length * 2) return null;
    const initialProblems = validatePlan(plan, catalog);

    // Portions → calories/macros, then each day balanced to its targets:
    // protein into range → excess fat down → missing calories mostly from carbs,
    // then the closure pass (calories ±3%, protein 90–110%, fat 85–115%)
    applyDensities(plan, densities);
    const balanced = finalizeDays(plan, catalog, densities, targets);
    let calories = closeCalories(plan, catalog, densities, targets);

    // Budget: the real cost of this menu's purchase quantities; over budget →
    // cheaper basket products of the same kind, each day rebalanced to its targets
    const { day_reports: dayReports, ...budgetReport } = fitPlanToBudget({
      plan, catalog, densities, targets, basketItems: list.items, budget, reports: calories,
    });
    calories = calories.map(r => dayReports.find(f => f.day === r.day) || r);
    if (budgetReport.swaps.length) {
      log.info(`[nutrition plan] budget: ₪${budgetReport.cost_before} → ₪${budgetReport.estimated_cost} (budget ₪${budget}), swaps:`, budgetReport.swaps);
    }
    if (!budgetReport.fits) log.warn(`[nutrition plan] menu costs ₪${budgetReport.estimated_cost}, ₪${budgetReport.over_by} over the weekly budget`);

    // Safety net for the meal rules (the templates keep them; balancing adds sides)
    let problems = validatePlan(plan, catalog);
    if (problems.length) {
      forceRepair(plan, catalog);
      problems = validatePlan(plan, catalog);
    }

    // Days that cannot meet every target with this basket keep their best
    // version, and the shortfall is written on the day
    for (const report of calories) {
      const day = plan.days.find(d => d.day_name === report.day);
      const warnings = targetWarnings(report, targets);
      if (day && warnings.length) day.target_warnings = warnings;
    }
    if (calories.some(r => !r.ok)) log.warn("[nutrition plan] days below their targets:", calories.filter(r => !r.ok));
    if (problems.length) log.warn("[nutrition plan] meal-rule issues:", problems);

    // The cost of the menu as it is saved (the rule repair can change portions)
    budgetReport.estimated_cost = planCost(list.items, plan.days);
    budgetReport.fits = !(budget > 0) || budgetReport.estimated_cost <= budget;
    budgetReport.over_by = budget > 0 ? Math.max(0, Math.round((budgetReport.estimated_cost - budget) * 10) / 10) : 0;

    recomputeTotals(plan);
    return { plan, budgetReport, problems, initialProblems, balanced, calories, stats: planned.stats };
  };

  // Meal selection: candidates → scoring → greedy + local search (src/lib/weeklyPlanner.js),
  // once per planner variant (balanced / protein first / budget first). Every
  // week is completed and validated, and the best one is kept: the lowest
  // quality level, the fewest failed checks, the most variety, then cost —
  // judged after balancing, when protein and cost are final. Deterministic.
  const quiet = { info() {}, warn() {} };
  const attempts = PLANNER_VARIANTS.map(v => ({ name: v.name, planned: planWeek({ catalog, densities, profile, budget, weights: v.weights }) }));
  const results = [];
  for (const a of attempts) {
    // let the page repaint between variants (each takes a few hundred ms)
    await new Promise(resolve => setTimeout(resolve, 0));
    const done = complete(a.planned, quiet);
    if (done) results.push({ name: a.name, done });
  }
  const ranked = results
    .map(r => Object.assign(r, { quality: validateMenu({ plan: { ...r.done.plan, estimated_weekly_cost: r.done.budgetReport.estimated_cost }, basketItems: list.items, profile, budget }) }));
  if (!ranked.length) throw new Error(PLAN_FAILED_MESSAGE);
  // quality first, then variety; cost decides only above 85% of the budget (below it the
  // headroom is better spent on variety than on saving more), and last as a tie-break
  const costOver = r => (budget > 0 ? Math.max(0, r.done.budgetReport.estimated_cost - budget * 0.85) : 0);
  const rank = r => [r.quality.level, r.quality.failed.length, -r.quality.stats.diversity, Math.round(costOver(r)), r.quality.limited.length, r.done.budgetReport.estimated_cost];
  const better = (x, y) => { const [a, b] = [rank(x), rank(y)]; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };
  const best = ranked.reduce((b, r) => (better(r, b) ? r : b));
  // Asked for a different menu: one more week, planned away from the best week's
  // meals. Planned from the best week — never from the menu on screen — so the
  // list of alternatives is the same on every click and the clicks walk through it.
  if (previous?.days?.length) {
    const avoid = new Map();
    for (const d of best.done.plan.days) for (const m of d.meals) if (m.meal_type !== "Snacks") avoid.set(mealCore(m), (avoid.get(mealCore(m)) || 0) + 1);
    await new Promise(resolve => setTimeout(resolve, 0));
    const done = complete(planWeek({ catalog, densities, profile, budget, weights: { previous: 4 }, avoid }), quiet);
    if (done) ranked.push(Object.assign({ name: "fresh", done }, { quality: validateMenu({ plan: { ...done.plan, estimated_weekly_cost: done.budgetReport.estimated_cost }, basketItems: list.items, profile, budget }) }));
  }
  // The deterministic alternatives: the best week, then the others in a fixed order —
  // never a worse kind of menu (no safety / realism failure, no nutrition or budget
  // miss the best week does not have), never a near-copy of one already listed
  const acceptable = r => r.quality.level < 4 && r.quality.level <= Math.max(best.quality.level, 2);
  const alternatives = [best];
  for (const name of ALTERNATIVE_ORDER) {
    const r = ranked.find(x => x.name === name);
    if (r && r !== best && acceptable(r) && !alternatives.some(a => sameMenu(a.done.plan.days, r.done.plan.days))) alternatives.push(r);
  }
  // The menu on screen is the alternative closest to it (when close enough); the
  // next one is the first after it, in order and wrapping around, that really
  // differs from it. None → exhausted: the basket has nothing else to offer.
  let index = 0, exhausted = false;
  if (previous?.days?.length) {
    const distance = alternatives.map(a => menuDifference(previous.days, a.done.plan.days));
    const closest = distance.indexOf(Math.min(...distance));
    const current = distance[closest] < MIN_DIFFERENT_SHARE ? closest : -1;
    const order = alternatives.map((_, k) => (current + 1 + k) % alternatives.length);
    const next = order.find(k => !sameMenu(previous.days, alternatives[k].done.plan.days));
    if (next == null) { index = Math.max(current, 0); exhausted = true; } else index = next;
  }
  const chosen = alternatives[index];
  const alternative = {
    index, of: alternatives.length, name: chosen.name,
    // nothing meaningfully different from the current menu exists with this basket
    exhausted,
    // back at the first menu after showing every alternative
    wrapped: !!previous?.days?.length && !exhausted && index === 0 && alternatives.length > 1,
  };
  const { plan, budgetReport, problems, initialProblems, balanced, calories } = chosen.done;
  if (budgetReport.swaps.length) console.info(`[nutrition plan] budget: ₪${budgetReport.cost_before} → ₪${budgetReport.estimated_cost} (budget ₪${budget})`);
  if (!budgetReport.fits) console.warn(`[nutrition plan] menu costs ₪${budgetReport.estimated_cost}, ₪${budgetReport.over_by} over the weekly budget`);
  if (problems.length) console.warn("[nutrition plan] meal-rule issues:", problems);

  return {
    ...plan,
    // the final list's own cost (purchase quantities × prices), not the sum of portions
    estimated_weekly_cost: budgetReport.estimated_cost,
    budget: budgetReport,
    alternative,
    validation: {
      planner: { chosen: chosen.name, ...chosen.done.stats, variants: ranked.map(r => ({ name: r.name, level: r.quality.level, failed: r.quality.failed, cost: r.done.budgetReport.estimated_cost })) },
      initial_issues: initialProblems.length,
      remaining_issues: problems,
      dropped_items: [],
      target_calories: target,
      balanced,
      calories,
    },
  };
}
