/**
 * Budget check for the weekly menu — runs before the menu is saved, so the
 * final shopping list (built from the same menu by buildFinalShoppingList)
 * already fits the weekly budget.
 *
 *   menu → weekly grams per product → purchase quantities → real cost
 *        (one calculation: src/lib/shoppingOptimizer.js + src/lib/pricing.js)
 *
 * When the cost is over budget, expensive products are swapped, one meal at a
 * time, for cheaper basket products of the same kind (protein for protein —
 * same protein grams; carbs/fats/fruit — same calories). Each swap must keep
 * the meal valid (meal roles, kosher, one main protein…), the day is then
 * rebalanced to the calorie/protein targets, and the swap is kept only if the
 * week's real cost went down. Deterministic: same menu + basket → same result.
 */
import { buildFinalShoppingList } from '@/lib/shoppingOptimizer';
import { checkMeal, validatePlan, mealNameMismatches, nameFromItems, dishWord, portionCap } from '@/lib/mealPlanRules';
import { closeCalories } from '@/lib/mealPlanCalories';

// What a product can be swapped for, and what the swap keeps equal
const SWAP_CLASS = {
  meat: "protein", fish: "protein", eggs: "protein", legumes: "protein", dairy_protein: "protein", yogurt: "protein",
  grain: "carb", bread: "carb", starch_veg: "carb", cereal: "carb",
  oil: "fat", tahini: "fat", nuts: "fat", avocado: "fat",
  fruit: "fruit", vegetable: "vegetable",
};
const KEEP = { protein: "protein", carb: "kcal", fat: "kcal", fruit: "kcal", vegetable: "grams" };

const MAX_SWAPS = 40;
const MIN_SAVING = 0.5; // ₪ — smaller changes are noise from rounding
const TOP_PRODUCTS = 5; // the most expensive products are tried first

const clone = x => JSON.parse(JSON.stringify(x));
const round = n => Math.round(n * 10) / 10;

/** The week's real cost of a menu: purchase quantities × prices, as the final list computes it. */
export function planCost(basketItems, days) {
  return buildFinalShoppingList(basketItems, days).total_estimated_cost;
}

// The main protein of a lunch/dinner: its first protein food
const MAIN_PROTEIN = new Set(["meat", "fish", "eggs", "legumes", "dairy_protein", "yogurt"]);
/** Whether a product is the main protein of more than half of the week's lunches and dinners. */
function dominates(plan, productId, catalog) {
  const mains = plan.days.flatMap(d => d.meals.filter(m => m.meal_type === "Lunch" || m.meal_type === "Dinner"));
  const main = m => m.items.find(i => MAIN_PROTEIN.has(catalog.find(p => p.id === i.product_id)?.group))?.product_id;
  return mains.filter(m => main(m) === productId).length > mains.length / 2;
}

/** Weekly cost per product name, most expensive first. */
function costsByProduct(basketItems, days) {
  return buildFinalShoppingList(basketItems, days).items
    .map(i => ({ name: i.name, cost: Number(i.estimated_price) || 0 }))
    .sort((a, b) => b.cost - a.cost);
}

/** Grams of `to` that replace `grams` of `from` (same protein / calories / grams), within a realistic portion. */
function equivalentGrams(grams, from, to, dFrom, dTo, keep) {
  let g = grams;
  if (keep === "protein" && dFrom?.protein > 0 && dTo?.protein > 0) g = grams * dFrom.protein / dTo.protein;
  else if (keep === "kcal" && dFrom?.kcal > 0 && dTo?.kcal > 0) g = grams * dFrom.kcal / dTo.kcal;
  const cap = portionCap(to);
  if (cap) g = Math.min(g, cap);
  return g >= 20 ? Math.round(g / 5) * 5 : Math.max(1, Math.round(g));
}

function setItem(item, product, grams, d) {
  item.product_id = product.id;
  item.food_name = product.name_he;
  item.grams = grams;
  if (d) {
    item.calories = Math.round(grams * d.kcal / 100);
    item.protein = round(grams * d.protein / 100);
    item.carbs = round(grams * d.carbs / 100);
    item.fat = round(grams * d.fat / 100);
    item.estimated_cost = d.pricePerGram ? round(grams * d.pricePerGram) : item.estimated_cost;
  }
}

/** The dish name after a swap: the old product's name replaced, else rebuilt from the items. */
function renameMeal(meal, from, to, catalog) {
  const oldShort = dishWord(from.name_he);
  const newShort = dishWord(to.name_he);
  if (oldShort && meal.meal_name?.includes(oldShort)) meal.meal_name = meal.meal_name.replace(oldShort, newShort);
  if (mealNameMismatches(meal.meal_name, meal.items, catalog).length) meal.meal_name = nameFromItems(meal.items);
}

/**
 * The swaps worth trying for one product: every meal that uses it × every
 * cheaper-kind product of the same class allowed in that meal.
 */
function candidateSwaps(plan, catalog, densities, fromProduct, priced, swappedIn) {
  const cls = SWAP_CLASS[fromProduct.group];
  if (!cls) return [];
  const swaps = [];
  plan.days.forEach((day, di) => day.meals.forEach((meal, mi) => {
    const idx = meal.items.findIndex(i => i.product_id === fromProduct.id);
    if (idx === -1) return;
    // A product this check put into the meal stays — no swapping back and forth
    if (swappedIn.has(`${di}:${mi}:${fromProduct.id}`)) return;
    for (const to of catalog) {
      if (to.id === fromProduct.id || SWAP_CLASS[to.group] !== cls || !densities.get(to.id)) continue;
      // A product without a price would look free — never a budget swap
      if (!priced.has(to.name_he)) continue;
      if (!to.meal_roles?.includes(meal.meal_type)) continue;
      if (meal.items.some(i => i.product_id === to.id)) continue;
      swaps.push({ di, mi, idx, from: fromProduct, to, keep: KEEP[cls] });
    }
  }));
  return swaps;
}

/**
 * Applies a swap in place on `trial` (a copy of the plan). Returns the day's
 * new calorie report, or null (trial untouched) when the meal would break a
 * meal rule or the day would lose targets it met.
 */
function applySwap(trial, swap, catalog, densities, targets, dayReports) {
  const day = trial.days[swap.di];
  const saved = clone(day);
  const meal = day.meals[swap.mi];
  const idx = meal.items.findIndex(i => i.product_id === swap.from.id);
  if (idx === -1 || meal.items.some(i => i.product_id === swap.to.id)) return null;
  const before = new Set(checkMeal(meal, catalog));
  const item = meal.items[idx];
  const grams = equivalentGrams(Number(item.grams) || 0, swap.from, swap.to, densities.get(swap.from.id), densities.get(swap.to.id), swap.keep);
  setItem(item, swap.to, grams, densities.get(swap.to.id));
  renameMeal(meal, swap.from, swap.to, catalog);
  let report = null;
  if (!checkMeal(meal, catalog).some(issue => !before.has(issue))) {
    // Back to the day's calorie / protein / fat targets with the new product
    [report] = closeCalories({ days: [day] }, catalog, densities, targets);
    // A swap must not cost the day its targets when it met them
    if (dayReports.get(day.day_name)?.ok !== false && !report.ok) report = null;
  }
  if (!report) trial.days[swap.di] = saved;
  return report;
}

/**
 * Fits a balanced menu to the weekly budget (mutates `plan`). Returns the
 * budget report saved with the plan:
 *   { weekly_budget, cost_before, estimated_cost, fits, over_by, swaps: [{ from, to, day, meal }] }
 */
export function fitPlanToBudget({ plan, catalog, densities, targets, basketItems, budget, reports = [] }) {
  const costBefore = planCost(basketItems, plan.days);
  // Latest calorie/protein report per day (closeCalories) — updated on every kept swap
  const dayReports = new Map(reports.map(r => [r.day, r]));
  let cost = costBefore;
  const swaps = [];
  const rejected = new Set(); // product pairs ("from>to") with no saving move
  const swappedIn = new Set(); // "day:meal:product" put in by a kept swap
  // Meal-rule problems the menu already had; a swap may fix some, never add one
  const problemKeys = p => validatePlan(p, catalog).flatMap(x => x.reasons.map(r => `${x.dayIndex}:${x.mealIndex}:${r}`));
  const baseProblems = new Set(problemKeys(plan));
  const productByName = new Map(catalog.map(p => [p.name_he, p]));
  const priced = new Set(basketItems.filter(i => Number(i.price_per_kg) > 0 || Number(i.estimated_price) > 0).map(i => i.name));

  for (let n = 0; n < MAX_SWAPS && budget > 0 && cost > budget; n++) {
    let best = null;
    // Most expensive products first; the first one with a saving move wins.
    // A move swaps one product for another in 1…k of its meals: products are
    // bought in whole packs, so one meal alone rarely saves (a new pack for one
    // portion) while several meals together do. The best prefix is kept.
    for (const { name } of costsByProduct(basketItems, plan.days).slice(0, TOP_PRODUCTS)) {
      const from = productByName.get(name);
      if (!from) continue;
      const byTarget = new Map();
      for (const swap of candidateSwaps(plan, catalog, densities, from, priced, swappedIn)) {
        if (!byTarget.has(swap.to.id)) byTarget.set(swap.to.id, []);
        byTarget.get(swap.to.id).push(swap);
      }
      for (const [toId, list] of byTarget) {
        if (rejected.has(`${from.id}>${toId}`)) continue;
        const trial = clone(plan);
        const reportsHere = new Map(dayReports);
        const done = [];
        let saves = false;
        for (const swap of list) {
          const report = applySwap(trial, swap, catalog, densities, targets, reportsHere);
          if (!report) continue;
          reportsHere.set(report.day, report);
          done.push(swap);
          if (problemKeys(trial).some(k => !baseProblems.has(k))) continue;
          // nor make one protein the main protein of over half the main meals (variety)
          if (dominates(trial, toId, catalog) && !dominates(plan, toId, catalog)) continue;
          const trialCost = planCost(basketItems, trial.days);
          const saving = cost - trialCost;
          if (saving < MIN_SAVING) continue;
          saves = true;
          if (!best || saving > best.saving) {
            best = { trial: clone(trial), reports: new Map(reportsHere), swaps: [...done], trialCost, saving };
          }
        }
        if (!saves) rejected.add(`${from.id}>${toId}`);
      }
      if (best) break;
    }
    if (!best) break;
    plan.days = best.trial.days;
    cost = best.trialCost;
    for (const [day, report] of best.reports) dayReports.set(day, report);
    for (const s of best.swaps) {
      swappedIn.add(`${s.di}:${s.mi}:${s.to.id}`);
      swaps.push({ from: s.from.name_he, to: s.to.name_he, day: plan.days[s.di].day_name, meal: plan.days[s.di].meals[s.mi].meal_type });
    }
  }

  return {
    weekly_budget: budget,
    cost_before: costBefore,
    estimated_cost: cost,
    fits: !(budget > 0) || cost <= budget,
    over_by: budget > 0 ? Math.max(0, round(cost - budget)) : 0,
    swaps,
    // The products that cost the most this week — what to change when it still does not fit
    top_costs: costsByProduct(basketItems, plan.days).slice(0, 3),
    day_reports: [...dayReports.values()],
  };
}
