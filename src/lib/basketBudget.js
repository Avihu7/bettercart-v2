/**
 * Budget view of the basket — deterministic, no AI.
 *
 * What each product costs this week, which products drive the cost, what can
 * replace them (same kind of food, from the catalog), how much each
 * replacement saves at the same nutrition, and how far the basket can
 * realistically come down.
 *
 * Weekly cost: with a menu built from this basket, the final list's own
 * calculation (purchase quantity the menu needs × price, src/lib/shoppingOptimizer.js);
 * without one, the basket's own prices.
 */
import { buildFinalShoppingList } from '@/lib/shoppingOptimizer';
import { purchaseCost, pricePerGram } from '@/lib/pricing';
import { parseQuantityGrams } from '@/lib/mealPlanCalories';
import { findAlternatives, buildReplacementItem, itemGroup, itemPer100g } from '@/lib/basketAlternatives';

const round1 = n => Math.round(n * 10) / 10;
const PROTEIN_GROUPS = new Set(["meat", "fish", "eggs", "legumes", "dairy_protein", "yogurt"]);
// The products shown as budget drivers, and the ones searched for a cheaper replacement
const TOP_DRIVERS = 3;
const SEARCHED = 6;
const MIN_SAVING = 1; // ₪

/**
 * Weekly cost per basket item, by index: { cost, grams, source }.
 * source "menu" — what the menu needs this week; "basket" — the item's own price;
 * "unused" — in the basket but not in the menu (bought for nothing this week).
 */
export function weeklyCosts(basketItems, planDays = null) {
  if (planDays?.length) {
    const final = buildFinalShoppingList(basketItems, planDays);
    return basketItems.map(item => {
      const line = final.items.find(i => i.name === item.name);
      return line
        ? { cost: Number(line.estimated_price) || 0, grams: Number(line.purchase_grams) || 0, usedGrams: Number(line.weekly_usage_grams) || 0, source: "menu" }
        : { cost: 0, grams: 0, usedGrams: 0, source: "unused" };
    });
  }
  return basketItems.map(item => {
    const grams = parseQuantityGrams(item.quantity, itemGroup(item)) || Number(item.pack_grams) || 0;
    return { cost: Number(item.estimated_price) || 0, grams, usedGrams: grams, source: "basket" };
  });
}

/**
 * Price facts for one basket item: price, ₪/kg (weighed or packed), ₪/100 g,
 * and for protein foods ₪ per 10 g of protein (the fairest way to compare them).
 */
export function priceFacts(item) {
  const group = itemGroup(item);
  const grams = parseQuantityGrams(item.quantity, group) || Number(item.pack_grams) || null;
  const perGram = pricePerGram(item, grams);
  const per100 = itemPer100g(item, group);
  const proteinPer100 = PROTEIN_GROUPS.has(group) && per100?.protein >= 5 ? per100.protein : null;
  return {
    price: Number(item.estimated_price) || 0,
    perKg: perGram ? round1(perGram * 1000) : null,
    per100g: perGram ? Math.round(perGram * 100 * 100) / 100 : null,
    perTenGramsProtein: perGram && proteinPer100 ? Math.round(perGram * 100 / proteinPer100 * 10 * 100) / 100 : null,
    soldByWeight: !!item.sold_by_weight,
    liquid: /ליטר|מ"ל|מל(?![א-ת])/.test(String(item.quantity || "")),
  };
}

/** The products that cost the most this week (top 3 with a cost), with their share of the total. */
export function budgetDrivers(basketItems, costs) {
  const total = costs.reduce((s, c) => s + c.cost, 0);
  return basketItems
    .map((item, index) => ({ item, index, ...costs[index], share: total ? costs[index].cost / total : 0 }))
    .filter(d => d.cost > 0)
    .sort((a, b) => b.cost - a.cost || a.item.name.localeCompare(b.item.name, "he"))
    .slice(0, SEARCHED);
}

// Dairy names state their fat ("קוטג' 1%", "גבינה לבנה 5%"), while catalog values are
// often one average for the whole type — the stated % is the truer fat per 100 g
const DAIRY_GROUPS = new Set(["dairy_protein", "yogurt", "milk"]);
function withNamedFat(per100, name, group) {
  const pct = DAIRY_GROUPS.has(group) && String(name || "").match(/(\d+(?:\.\d+)?)\s*%/);
  if (!per100 || !pct) return per100;
  const fat = parseFloat(pct[1]);
  return { ...per100, kcal: Math.max(0, per100.kcal + (fat - per100.fat) * 9), fat };
}

/**
 * One replacement option priced for this week: the amount that gives the same
 * protein (protein foods) or the same calories (everything else) as the
 * current product's weekly amount, its cost, the saving, and the nutrition change.
 */
export function priceReplacement(item, driver, option) {
  const replacement = buildReplacementItem(option);
  const group = itemGroup(item);
  const before = withNamedFat(itemPer100g(item, group), item.name, group);
  const after = withNamedFat(option.per100, option.product.original_product_name, option.group);
  const eaten = driver.usedGrams || driver.grams;
  if (!before || !after || !(eaten > 0)) return null;
  const keepProtein = PROTEIN_GROUPS.has(group) && before.protein > 0 && after.protein > 0;
  const grams = keepProtein ? eaten * before.protein / after.protein
    : before.kcal > 0 && after.kcal > 0 ? eaten * before.kcal / after.kcal : eaten;
  const priced = purchaseCost(replacement, grams);
  if (!priced) return null;
  const week = (per100, g) => ({ protein: per100.protein * g / 100, fat: per100.fat * g / 100, kcal: per100.kcal * g / 100 });
  const b = week(before, eaten);
  const a = week(after, grams);
  const change = (x, y) => (Math.abs(y - x) <= Math.max(5, x * 0.1) ? 0 : y > x ? 1 : -1);
  return {
    option,
    replacement,
    cost: priced.cost,
    saving: round1(driver.cost - priced.cost),
    impact: { protein: change(b.protein, a.protein), fat: change(b.fat, a.fat), kcal: change(b.kcal, a.kcal) },
    keepsProteinGoal: option.keepsProteinGoal,
  };
}

/**
 * The budget picture for the basket:
 *   { total, budget, over, drivers: [{ item, index, cost, share, options: [...] }],
 *     bestTotal, reachable }
 * drivers: the top items by weekly cost, each with up to 3 cheaper replacements
 * (largest saving first). bestTotal: the total after the best replacement of
 * each searched product — about as low as the basket can go with like-for-like swaps.
 */
export async function basketBudgetPicture({ basketItems, planDays, profile, budget }) {
  const costs = weeklyCosts(basketItems, planDays);
  const total = round1(costs.reduce((s, c) => s + c.cost, 0));
  const searched = budgetDrivers(basketItems, costs);
  const priced = (d, found) => found
    .map(o => priceReplacement(d.item, d, o))
    .filter(o => o && o.saving >= MIN_SAVING && o.keepsProteinGoal !== false)
    .sort((x, y) => y.saving - x.saving || x.option.product.original_product_name.localeCompare(y.option.product.original_product_name, "he"))
    .slice(0, 3);
  const withOptions = await Promise.all(searched.map(async d => {
    // Safe: the same kind of food (a cheaper version or a close relative).
    // Broad: another kind of food in the same role (e.g. beef → lentils) — shown on request
    const [similar, other] = await Promise.all([
      findAlternatives(d.item, basketItems, profile, { max: 8, sameFood: true }).catch(() => []),
      findAlternatives(d.item, basketItems, profile, { max: 8, broad: true }).catch(() => []),
    ]);
    // Safe = the same food group, so the meals stay the same kind (bread for
    // bread, rice for pasta, any meat for meat); a carb of another group (bread →
    // oats) changes the meal, so it counts as a broad swap
    const group = itemGroup(d.item);
    const sameGroup = o => o.group === group || PROTEIN_GROUPS.has(group);
    const safe = similar.filter(sameGroup);
    const broad = [...other, ...similar.filter(o => !sameGroup(o))];
    return { ...d, reasons: whyExpensive(d), options: priced(d, safe), broadOptions: priced(d, broad) };
  }));
  const best = list => list[0]?.saving || 0;
  const maxSaving = withOptions.reduce((s, d) => s + best(d.options), 0);
  const maxBroadSaving = withOptions.reduce((s, d) => s + Math.max(best(d.options), best(d.broadOptions)), 0);
  const bestTotal = round1(total - maxSaving);
  return {
    total,
    budget,
    over: budget > 0 ? round1(Math.max(0, total - budget)) : 0,
    source: planDays?.length ? "menu" : "basket",
    costs,
    drivers: withOptions.slice(0, TOP_DRIVERS),
    // The safe swaps worth making, largest saving first, until the budget is met
    recommended: recommendedSwaps(withOptions, total, budget),
    bestTotal,
    maxSaving: round1(maxSaving),
    reachable: !(budget > 0) || bestTotal <= budget,
    bestBroadTotal: round1(total - maxBroadSaving),
    reachableBroad: !(budget > 0) || total - maxBroadSaving <= budget,
  };
}

/** Why a product weighs on the budget, in Hebrew (its share, its unit price, the amount needed). */
function whyExpensive(d) {
  const reasons = [];
  if (d.share >= 0.15) reasons.push(`לבדו ${Math.round(d.share * 100)}% מעלות השבוע`);
  const perKg = Number(d.item.price_per_kg) || 0;
  if (perKg >= 40) reasons.push(`מחיר גבוה לק"ג (₪${round1(perKg)})`);
  if (d.source === "menu" && d.usedGrams >= 1200) reasons.push(`התפריט צריך ממנו כמות גדולה (${round1(d.usedGrams / 1000)} ק"ג)`);
  if (!reasons.length) reasons.push(`₪${round1(d.cost)} השבוע — מהמוצרים היקרים בסל`);
  return reasons;
}

/** Best safe swap per driver, largest saving first, stopping once the total fits the budget. */
function recommendedSwaps(drivers, total, budget) {
  const picks = drivers
    .filter(d => d.options.length)
    .map(d => ({ index: d.index, name: d.item.name, choice: d.options[0] }))
    .sort((a, b) => b.choice.saving - a.choice.saving);
  const out = [];
  let left = total;
  for (const p of picks) {
    if (budget > 0 && left <= budget) break;
    out.push(p);
    left -= p.choice.saving;
  }
  return { swaps: out, saving: round1(total - left), totalAfter: round1(left) };
}
