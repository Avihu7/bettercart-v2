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

/**
 * Main optimizer function.
 *
 * @param {Object[]} shoppingListItems  - current shopping list items
 * @param {Object[]} nutritionPlanDays  - days array from the nutrition plan
 * @returns {Object[]} - updated shopping list items with corrected quantities
 */
export function optimizeShoppingQuantities(shoppingListItems, nutritionPlanDays) {
  const planGrams = aggregatePlanGrams(nutritionPlanDays);

  return shoppingListItems.map(item => {
    const listNorm = normalize(item.name);

    // Find matching plan item(s)
    let matchedGrams = 0;
    for (const [planKey, planData] of planGrams) {
      if (namesMatch(planData.originalName, item.name) || namesMatch(planKey, listNorm)) {
        matchedGrams += planData.totalGrams;
      }
    }

    if (matchedGrams === 0) {
      // No match in the plan — keep original quantity but flag it
      return { ...item, _optimized: false };
    }

    // Add 10% buffer to avoid running short mid-week
    const gramsWithBuffer = Math.ceil(matchedGrams * 1.1);

    const { unit } = pickPackageSize(gramsWithBuffer, item.category || 'other');

    return {
      ...item,
      quantity: unit,
      _optimized: true,
      _gramsNeeded: matchedGrams,
    };
  });
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
