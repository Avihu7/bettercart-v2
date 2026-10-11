/**
 * EXPERIMENT ONLY. Measurements of a FINAL menu (the output of generateNutritionPlan), taken
 * with the app's own validator and classifier. Nothing here scores a menu with a new formula:
 * quality level, failed checks and the diversity figure are validateMenu's own.
 */
import { validateMenu } from "@/lib/validateMenu";
import { classifyProduct } from "@/lib/mealPlanRules";
import { WEEK_DAYS } from "@/lib/weekDays";

const MAIN_PROTEIN = new Set(["meat", "fish", "legumes", "eggs", "dairy_protein", "yogurt"]); // as validateMenu
const CARB_SIDE = new Set(["grain", "starch_veg", "bread"]); // as validateMenu
const r1 = n => Math.round(n * 10) / 10;
const r2 = n => Math.round(n * 100) / 100;
const median = a => { const v = [...a].sort((x, y) => x - y); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const countBy = list => list.filter(x => x != null).reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
const maxOf = m => (m.size ? Math.max(...m.values()) : 0);

const mainProtein = meal => meal.items.find(i => MAIN_PROTEIN.has(classifyProduct(i.food_name)))?.food_name || null;
const carbOf = meal => meal.items.find(i => CARB_SIDE.has(classifyProduct(i.food_name)))?.food_name || null;
const itemSet = meal => meal.items.map(i => i.food_name).sort().join(" + ");

export function measure({ plan, items, profile, budget }) {
  const quality = validateMenu({ plan, basketItems: items, profile, budget });
  const check = id => quality.checks.find(c => c.id === id);
  const days = plan.days;
  const perDay = quality.stats.perDay;

  // ── structure
  const structure = {
    days: days.length,
    sundayToSaturday: days.map(d => d.day_name).join(",") === WEEK_DAYS.map(d => d.key).join(","),
    mealsPerDay: days.map(d => d.meals.length),
    missingSlots: check("meal_slots")?.data.missing || [],
    partialPlan: days.length !== 7 || (check("meal_slots")?.data.missing || []).length > 0,
    allergyOrDietViolations: check("profile_safe")?.data.conflicts || [],
    invalidProducts: [...(check("products_exist")?.data.invented || []), ...(check("no_non_food")?.data.nonFood || [])],
    meatWithDairy: check("kosher_separation")?.data.meals || [],
    mealRuleViolations: check("meal_rules")?.data.problems || [],
  };
  structure.multipleMainProtein = structure.mealRuleViolations.filter(p => /more than one main protein|meat and fish/.test(p)).length;
  structure.unrealisticPortions = structure.mealRuleViolations.filter(p => /unrealistic portion/.test(p)).length;
  structure.hardValid = !structure.partialPlan && structure.sundayToSaturday && !structure.allergyOrDietViolations.length &&
    !structure.invalidProducts.length && !structure.meatWithDairy.length && !structure.mealRuleViolations.length;

  // ── nutrition
  const kcalT = profile.daily_calories, protT = profile.protein_target, fatT = profile.fat_target, carbT = profile.carbs_target;
  const dev = perDay.map(d => Math.abs(d.kcal - kcalT) / kcalT * 100);
  const calories = {
    target: kcalT, perDay: perDay.map(d => d.kcal),
    meanAbsDeviationPct: r2(mean(dev)), medianAbsDeviationPct: r2(median(dev)), maxAbsDeviationPct: r2(Math.max(...dev)),
    daysWithin3pct: dev.filter(x => x <= 3).length, daysWithin5pct: dev.filter(x => x <= 5).length,
    validatorOk: check("calories")?.ok ?? null,
  };
  const pPct = perDay.map(d => d.protein / protT * 100);
  const protein = {
    target: protT, perDay: perDay.map(d => d.protein),
    meanPctOfTarget: r1(mean(pPct)), meanAbsDeviationPct: r2(mean(pPct.map(x => Math.abs(x - 100)))),
    worstDayPctOfTarget: r1(Math.min(...pPct)), worstDeficitGrams: r1(Math.max(0, protT - Math.min(...perDay.map(d => d.protein)))),
    daysAtLeast90pct: pPct.filter(x => x >= 90).length, validatorOk: check("protein")?.ok ?? null,
  };
  const fPct = fatT ? perDay.map(d => d.fat / fatT * 100) : [];
  const fat = fatT ? {
    target: fatT, perDay: perDay.map(d => d.fat), meanPctOfTarget: r1(mean(fPct)),
    daysWithin75to115pct: fPct.filter(x => x >= 75 && x <= 115).length, validatorOk: check("fat")?.ok ?? null,
  } : null;
  const cPct = carbT ? perDay.map(d => d.carbs / carbT * 100) : [];
  // observational only: no stage targets carbs per day, and the validator does not grade them
  const carbs = carbT ? {
    target: carbT, perDay: perDay.map(d => d.carbs), meanPctOfTarget: r1(mean(cPct)),
    meanAbsDeviationPct: r2(mean(cPct.map(x => Math.abs(x - 100)))), daysWithin25pct: cPct.filter(x => Math.abs(x - 100) <= 25).length,
  } : null;

  // ── variety (raw counts)
  const meals = days.flatMap((d, di) => d.meals.map(m => ({ ...m, di })));
  const mains21 = meals.filter(m => m.meal_type !== "Snacks");
  const lunchDinner = meals.filter(m => m.meal_type === "Lunch" || m.meal_type === "Dinner");
  const identical = countBy(mains21.map(m => `${m.meal_type}|${itemSet(m)}`));
  const anySlot = countBy(mains21.map(itemSet));
  const templates = countBy(lunchDinner.map(m => `${mainProtein(m) || "-"}|${carbOf(m) || "-"}`));
  const proteins = countBy(lunchDinner.map(mainProtein));
  const carbUse = countBy(lunchDinner.map(carbOf));
  let consecutive = 0, sameDayProtein = 0;
  for (const type of ["Lunch", "Dinner"]) {
    for (let d = 1; d < days.length; d++) {
      const a = days[d - 1].meals.find(m => m.meal_type === type), b = days[d].meals.find(m => m.meal_type === type);
      if (a && b && mainProtein(a) && mainProtein(a) === mainProtein(b)) consecutive++;
    }
  }
  for (const d of days) {
    const c = countBy(d.meals.filter(m => m.meal_type !== "Snacks").map(mainProtein));
    for (const n of c.values()) sameDayProtein += Math.max(0, n - 1);
  }
  const variety = {
    mainMeals: mains21.length,
    uniqueMainMeals: anySlot.size,
    identicalMealRepetitions: [...identical.values()].reduce((s, n) => s + (n - 1), 0),
    lunchDinnerTemplates: templates.size, mostRepeatedTemplate: maxOf(templates),
    mainProteinsUsed: proteins.size, mostUsedMainProtein: maxOf(proteins),
    carbsUsed: carbUse.size, mostUsedCarb: maxOf(carbUse),
    consecutiveDaySameProtein: consecutive, sameProteinTwiceInADay: sameDayProtein,
    validatorDiversity: quality.stats.diversity,
  };

  // ── realism / validator
  const validator = {
    level: quality.level, failed: quality.failed, limited: quality.limited,
    warnings: quality.failed.length + quality.limited.length,
    repetitionFailed: quality.checks.filter(c => c.area === "variety" && !c.ok).map(c => c.id),
    dayTargetWarnings: days.reduce((s, d) => s + (d.target_warnings?.length || 0), 0),
    remainingMealRuleIssues: plan.validation?.remaining_issues?.length ?? null,
  };

  // ── budget
  const cost = Number(plan.estimated_weekly_cost);
  const budgetOut = {
    weeklyFoodBudget: budget, cost, difference: r1(cost - budget), status: cost <= budget ? "within" : "over",
    pctOfBudget: r1(cost / budget * 100), fitSwaps: plan.budget?.swaps?.length ?? null, costBeforeFit: plan.budget?.cost_before ?? null,
  };

  // the app's own "which week is better" key (nutritionPlanGenerator.js): lower is better, left to right
  const costOver = Math.max(0, cost - budget * 0.85);
  const rank = [quality.level, quality.failed.length, -quality.stats.diversity, Math.round(costOver), quality.limited.length, cost];

  return { structure, calories, protein, fat, carbs, variety, validator, budget: budgetOut, rank };
}

/** -1 when a is the better final menu by the app's own ranking, 1 when b is, 0 when equal. */
export function compareRank(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}
