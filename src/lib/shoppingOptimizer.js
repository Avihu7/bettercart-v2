/**
 * Shopping List Quantity Optimizer
 *
 * Given a nutrition plan (array of days with meals and items),
 * this module back-calculates the exact grams of each food product
 * consumed over the plan period and converts them to realistic
 * Israeli supermarket purchase quantities.
 *
 * Algorithm:
 *  1. Aggregate total grams per food name across all days × meals
 *  2. Fuzzy-match nutrition plan food names to shopping list items
 *  3. Convert total grams to purchase units based on category rules
 *  4. Return updated shopping list items with corrected quantities
 */

import { classifyProduct } from '@/lib/mealPlanRules';
import { quantityCandidates, parseQuantityGrams } from '@/lib/mealPlanCalories';
import { purchaseCost } from '@/lib/pricing';

// Category-based package size rules (common Israeli supermarket sizes)
const PACKAGE_SIZES = {
  protein: [
    { threshold: 400,  unit: '400 ג\'', grams: 400 },
    { threshold: 750,  unit: '750 ג\'', grams: 750 },
    { threshold: 1000, unit: '1 ק"ג',   grams: 1000 },
    { threshold: 2000, unit: '2 ק"ג',   grams: 2000 },
    { threshold: Infinity, unit: '3 ק"ג', grams: 3000 },
  ],
  vegetable: [
    { threshold: 300,  unit: '300 ג\'', grams: 300 },
    { threshold: 500,  unit: '500 ג\'', grams: 500 },
    { threshold: 1000, unit: '1 ק"ג',   grams: 1000 },
    { threshold: Infinity, unit: '2 ק"ג', grams: 2000 },
  ],
  fruit: [
    { threshold: 500,  unit: '500 ג\'', grams: 500 },
    { threshold: 1000, unit: '1 ק"ג',   grams: 1000 },
    { threshold: Infinity, unit: '2 ק"ג', grams: 2000 },
  ],
  dairy: [
    { threshold: 250,  unit: '250 ג\'', grams: 250 },
    { threshold: 500,  unit: '500 ג\'', grams: 500 },
    { threshold: 1000, unit: '1 ק"ג',   grams: 1000 },
    { threshold: Infinity, unit: '2 ק"ג', grams: 2000 },
  ],
  carb: [
    { threshold: 500,  unit: '500 ג\'', grams: 500 },
    { threshold: 1000, unit: '1 ק"ג',   grams: 1000 },
    { threshold: Infinity, unit: '2 ק"ג', grams: 2000 },
  ],
  fat: [
    { threshold: 250,  unit: '250 מ"ל', grams: 250 },
    { threshold: 500,  unit: '500 מ"ל', grams: 500 },
    { threshold: Infinity, unit: '750 מ"ל', grams: 750 },
  ],
  snack: [
    { threshold: 200,  unit: '200 ג\'', grams: 200 },
    { threshold: Infinity, unit: '500 ג\'', grams: 500 },
  ],
  drink: [
    { threshold: 500,  unit: '500 מ"ל', grams: 500 },
    { threshold: 1000, unit: '1 ל\'',   grams: 1000 },
    { threshold: Infinity, unit: '1.5 ל\'', grams: 1500 },
  ],
  other: [
    { threshold: 500,  unit: '500 ג\'', grams: 500 },
    { threshold: Infinity, unit: '1 ק"ג', grams: 1000 },
  ],
};

/**
 * Normalizes a Hebrew food name for fuzzy matching:
 * removes common suffixes, trims whitespace.
 */
function normalize(name) {
  if (!name) return '';
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[־׀׃׆׳״"']/g, '') // strip Hebrew punctuation & quotes
    .replace(/\d+(\.\d+)?%/g, '')
    .trim();
}

/**
 * Fuzzy match: returns true if the plan item name is "contained in" or
 * "substantially similar to" the shopping list item name.
 */
function namesMatch(planName, listName) {
  const a = normalize(planName);
  const b = normalize(listName);
  if (!a || !b) return false;
  if (a === b) return true;
  // One contains the other (handles "חזה עוף טרי" matching "חזה עוף")
  if (a.includes(b) || b.includes(a)) return true;
  // Share at least 2 Hebrew words
  const wordsA = new Set(a.split(' ').filter(w => w.length > 1));
  const wordsB = new Set(b.split(' ').filter(w => w.length > 1));
  let common = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) common++;
  }
  return common >= 2;
}

/**
 * Given the total grams needed, pick the smallest package size that covers it.
 * Returns the purchase unit string (e.g., '1 ק"ג') and the actual package grams.
 */
function pickPackageSize(totalGrams, category) {
  const sizes = PACKAGE_SIZES[category] || PACKAGE_SIZES.other;
  for (const s of sizes) {
    if (totalGrams <= s.threshold) {
      return { unit: s.unit, packageGrams: s.grams };
    }
  }
  const last = sizes[sizes.length - 1];
  const packs = Math.ceil(totalGrams / last.grams);
  return { unit: `${packs} × ${last.unit}`, packageGrams: last.grams * packs };
}

/**
 * Aggregates grams used per food name across all plan days.
 * Returns Map<normalizedName, { totalGrams, originalName }>
 */
function aggregatePlanGrams(days) {
  const totals = new Map();
  for (const day of days || []) {
    for (const meal of day.meals || []) {
      for (const item of meal.items || []) {
        const key = normalize(item.food_name);
        if (!key) continue;
        const existing = totals.get(key) || { totalGrams: 0, originalName: item.food_name };
        existing.totalGrams += item.grams || 0;
        totals.set(key, existing);
      }
    }
  }
  return totals;
}

// Cooked plan portions → dry purchase weight (rice/pasta ≈ 2.7×, dry legumes ≈ 3× when cooked)
const COOKED_TO_DRY = { grain: 2.7, legumes: 3 };
// Ready-to-eat products in those groups (tofu, canned/cooked legumes) are bought as eaten
const READY_TO_EAT = /טופו|שימורי|קופסה|מבושל|מוכן/;

function isSoldDry(item, group) {
  return !!COOKED_TO_DRY[group] && !READY_TO_EAT.test(item.name || '');
}

// Typical Israeli supermarket pack per product group: { grams, label }
function productUnit(item, group) {
  const name = item.name || '';
  switch (group) {
    case 'milk':
    case 'plant_milk': return { grams: 1000, label: '1 ליטר' };
    case 'yogurt': return { grams: 200, label: '200 גרם' };
    case 'dairy_protein':
      if (/קוטג/.test(name)) return { grams: 250, label: '250 גרם' };
      return { grams: 200, label: '200 גרם' };
    case 'bread': return { grams: 750, label: 'כיכר' };
    case 'grain': return /פסטה|ספגטי|פתיתים|אטריות/.test(name) ? { grams: 500, label: '500 גרם' } : { grams: 1000, label: '1 ק"ג' };
    case 'legumes': return /טופו/.test(name) ? { grams: 300, label: '300 גרם' } : { grams: 500, label: '500 גרם' };
    case 'cereal': return { grams: 750, label: '750 גרם' };
    case 'oil': return { grams: 750, label: '750 מ"ל' };
    case 'tahini': return { grams: 500, label: '500 גרם' };
    case 'nuts': return { grams: 200, label: '200 גרם' };
    case 'coffee': return { grams: 200, label: '200 גרם' };
    case 'tea': return { grams: 100, label: '100 גרם' };
    case 'fish': return /טונה/.test(name) ? { grams: 160, label: 'קופסה' } : null;
    default: return null;
  }
}

const WEIGHED_GROUPS = new Set(['meat', 'fish', 'vegetable', 'fruit', 'avocado', 'starch_veg']);
const LIQUID_GROUPS = new Set(['milk', 'plant_milk', 'oil']);

function packLabel(grams, group) {
  if (LIQUID_GROUPS.has(group)) return grams >= 1000 ? `${grams / 1000} ליטר` : `${grams} מ"ל`;
  return grams >= 1000 ? `${grams / 1000} ק"ג` : `${grams} גרם`;
}

/**
 * The pack size the shopping list itself names: "2 יחידות (250 גרם כל אחת)" → 250g,
 * or a single pack like "200 גרם" / "500 מל" (up to 1 kg; larger values are totals).
 */
function listPackUnit(item, group) {
  const q = String(item.quantity || '');
  const each = q.match(/(\d+(?:\.\d+)?)\s*(?:גרם|ג'?|מ"ל|מל)\s*כל אח[תד]/);
  if (each) return { grams: parseFloat(each[1]), label: packLabel(parseFloat(each[1]), group) };
  if (/^\s*\d+\s*(?:יחידות|יח'|חבילות|מארזים|קופסאות|בקבוקים)/.test(q)) return null;
  const g = parseQuantityGrams(q, group);
  return g && g <= 1000 ? { grams: g, label: packLabel(g, group) } : null;
}

function formatWeight(grams) {
  return grams >= 1000 ? `${Math.round(grams / 100) / 10} ק"ג` : `${Math.round(grams)} גרם`;
}

/**
 * Converts the weekly amount eaten into a purchase quantity.
 * Returns { label, purchaseGrams }.
 */
function purchaseQuantity(item, eatenGrams, group) {
  let need = eatenGrams * 1.1; // 10% buffer so the week doesn't run short
  if (isSoldDry(item, group)) need /= COOKED_TO_DRY[group];

  if (group === 'eggs') {
    const eggs = Math.ceil(need / 60);
    const cartons = Math.ceil(eggs / 12);
    return { label: cartons === 1 ? 'תבנית 12 ביצים' : `תבנית 12 ביצים × ${cartons}`, purchaseGrams: cartons * 12 * 60 };
  }
  // Known pricing unit (see src/lib/pricing.js): weighed → by the 100 g, packed → whole packs
  const knownPack = !item.sold_by_weight && Number(item.pack_grams) > 0 ? Number(item.pack_grams) : null;
  if (knownPack) {
    const packs = Math.max(1, Math.ceil(need / knownPack));
    const label = packLabel(knownPack, group);
    return { label: packs === 1 ? label : `${label} × ${packs}`, purchaseGrams: packs * knownPack };
  }
  if (item.sold_by_weight || (WEIGHED_GROUPS.has(group) && !productUnit(item, group))) {
    // Sold by weight: round up to the next 100g (at least 250g)
    const grams = Math.max(250, Math.ceil(need / 100) * 100);
    return { label: `כ-${formatWeight(grams)}`, purchaseGrams: grams };
  }
  const unit = listPackUnit(item, group) || productUnit(item, group);
  if (unit) {
    const packs = Math.max(1, Math.ceil(need / unit.grams));
    return { label: packs === 1 ? unit.label : `${unit.label} × ${packs}`, purchaseGrams: packs * unit.grams };
  }
  const { unit: label, packageGrams } = pickPackageSize(need, item.category || 'other');
  return { label, purchaseGrams: packageGrams };
}

/**
 * Assigns every plan ingredient to exactly one shopping-list item — exact
 * name first (plans store the list's exact names), then the fuzzy match for
 * older plans — and sums the grams eaten per item across the week.
 */
function weeklyUsageByItem(shoppingListItems, nutritionPlanDays) {
  const usage = new Map();
  for (const [key, data] of aggregatePlanGrams(nutritionPlanDays)) {
    let idx = shoppingListItems.findIndex(i => normalize(i.name) === key);
    if (idx === -1) idx = shoppingListItems.findIndex(i => namesMatch(data.originalName, i.name));
    if (idx === -1) continue;
    usage.set(idx, (usage.get(idx) || 0) + data.totalGrams);
  }
  return usage;
}

/**
 * Main optimizer function.
 *
 * @param {Object[]} shoppingListItems  - current shopping list items
 * @param {Object[]} nutritionPlanDays  - days array from the nutrition plan
 * @returns {Object[]} - updated shopping list items with corrected quantities
 */
export function optimizeShoppingQuantities(shoppingListItems, nutritionPlanDays) {
  const usage = weeklyUsageByItem(shoppingListItems, nutritionPlanDays);

  return shoppingListItems.map((item, idx) => {
    const eaten = usage.get(idx) || 0;
    if (!eaten) {
      // Not used in the plan — keep original quantity but flag it
      return { ...item, _optimized: false };
    }
    const group = classifyProduct(item.name, item.category);
    const { label, purchaseGrams } = purchaseQuantity(item, eaten, group);

    // Price per kg / per pack from the item's pricing fields; older items fall
    // back to the list's own price ÷ quantity (its quantity is the pack it priced)
    const listGrams = quantityCandidates(item.quantity, group)[0];
    const priced = purchaseCost(item, purchaseGrams, listGrams);

    return {
      ...item,
      quantity: label,
      weekly_usage_grams: Math.round(eaten),
      purchase_grams: Math.round(purchaseGrams),
      estimated_price: priced ? priced.cost : item.estimated_price,
      price_is_estimate: !priced,
      _optimized: true,
      _gramsNeeded: eaten,
    };
  });
}

/** Weekly usage as it appears in the menu (rice/pasta/legumes are cooked weight). */
export function weeklyUsageLabel(item) {
  const g = item.weekly_usage_grams;
  if (!g) return '—';
  const group = classifyProduct(item.name, item.category);
  const amount = formatWeight(g);
  return isSoldDry(item, group) ? `${amount} (מבושל)` : amount;
}

/**
 * Final shopping list for a nutrition plan: only the products the plan uses,
 * with purchase quantities and prices derived from the week's actual usage.
 * Returns { items, total_estimated_cost, unused } (unused = basket names not in the plan).
 */
export function buildFinalShoppingList(basketItems, nutritionPlanDays) {
  const optimized = optimizeShoppingQuantities(basketItems || [], nutritionPlanDays || []);
  const items = optimized
    .filter(i => i._optimized)
    .map(({ _optimized, _gramsNeeded, ...rest }) => rest);
  const unused = optimized.filter(i => !i._optimized).map(i => i.name);
  const total = items.reduce((s, i) => s + (Number(i.estimated_price) || 0), 0);
  return { items, total_estimated_cost: Math.round(total * 10) / 10, unused };
}

/**
 * Calculates optimization summary statistics.
 * Returns { optimizedCount, unchanged, totalGramsMap }
 */
export function getOptimizationSummary(originalItems, optimizedItems) {
  let optimizedCount = 0;
  let unchanged = 0;

  for (let i = 0; i < optimizedItems.length; i++) {
    if (optimizedItems[i]._optimized) optimizedCount++;
    else unchanged++;
  }

  return { optimizedCount, unchanged, total: optimizedItems.length };
}
