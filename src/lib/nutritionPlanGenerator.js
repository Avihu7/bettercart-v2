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
 * The same basket, profile and budget always give the same menu.
 */

import {
  buildProductCatalog, validatePlan, forceRepair, recomputeTotals,
} from '@/lib/mealPlanRules';
import { buildDensities, applyDensities, finalizeDays, closeCalories } from '@/lib/mealPlanCalories';
import { planWeek } from '@/lib/weeklyPlanner';
import { PLANNER_VARIANTS } from '@/lib/mealScoring';
import { validateMenu } from '@/lib/validateMenu';
import { fitPlanToBudget, planCost } from '@/lib/mealPlanBudget';
import { profileConflict, isSupplement, isDisliked } from '@/lib/basketAlternatives';

const PLAIN_WATER = /^\s*(מים|מי ברז|מי מעיין|סודה|מים מוגזים|מי סודה|מי עדן|נביעות|מי נביעות|נביעות טבעיות)(?![א-ת])/;
const isPlainWater = name => PLAIN_WATER.test(String(name || ""));

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
export async function generateNutritionPlan({ list, profile, budget = null }) {
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
  // quality level, then the fewest failed checks, then the lowest cost —
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
  const rank = r => [r.quality.level, r.quality.failed.length, r.quality.limited.length, r.done.budgetReport.estimated_cost];
  const better = (x, y) => { const [a, b] = [rank(x), rank(y)]; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };
  const chosen = ranked.reduce((best, r) => (better(r, best) ? r : best));
  const { plan, budgetReport, problems, initialProblems, balanced, calories } = chosen.done;
  if (budgetReport.swaps.length) console.info(`[nutrition plan] budget: ₪${budgetReport.cost_before} → ₪${budgetReport.estimated_cost} (budget ₪${budget})`);
  if (!budgetReport.fits) console.warn(`[nutrition plan] menu costs ₪${budgetReport.estimated_cost}, ₪${budgetReport.over_by} over the weekly budget`);
  if (problems.length) console.warn("[nutrition plan] meal-rule issues:", problems);

  return {
    ...plan,
    // the final list's own cost (purchase quantities × prices), not the sum of portions
    estimated_weekly_cost: budgetReport.estimated_cost,
    budget: budgetReport,
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
