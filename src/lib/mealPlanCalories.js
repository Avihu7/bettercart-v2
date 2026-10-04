/**
 * Calorie accuracy for nutrition plans.
 *
 * Item calories/macros are derived from portion grams × the product's
 * per-100g values (taken from the shopping list, falling back to the AI's own
 * estimate, then to typical reference values — each checked for plausible
 * calories AND protein), and each day is then balanced to the user's calorie
 * target by scaling adjustable portions within realistic bounds or adding a
 * snack, and finally nudged toward the protein target (see balanceProtein).
 */

import { portionCap } from '@/lib/mealPlanRules';

// Plausible kcal/100g "as eaten" per food group; values outside are treated as bad data.
const KCAL_RANGE = {
  coffee: [0, 400], tea: [0, 400], milk: [25, 100], yogurt: [35, 220], dairy_protein: [60, 450],
  eggs: [120, 180], meat: [90, 320], fish: [70, 320], legumes: [60, 200], bread: [180, 430],
  grain: [80, 260], cereal: [320, 460], starch_veg: [55, 140], vegetable: [8, 120],
  fruit: [20, 200], nuts: [250, 700], tahini: [500, 720], oil: [700, 920], other: [0, 920],
};

// Plausible protein g/100g "as eaten" per food group (catches e.g. salmon at 8g/100g).
const PROTEIN_RANGE = {
  coffee: [0, 25], tea: [0, 25], milk: [2.5, 4.5], yogurt: [2.5, 12], dairy_protein: [6, 36],
  eggs: [10, 15], meat: [15, 36], fish: [14, 32], legumes: [5, 28], bread: [5, 15],
  grain: [1.5, 6], cereal: [4, 16], starch_veg: [0.5, 4], vegetable: [0, 6],
  fruit: [0, 3], nuts: [8, 32], tahini: [14, 30], oil: [0, 1], other: [0, 100],
};

// Typical per-100g values (as eaten), used only when neither the shopping list
// nor the AI gives plausible numbers for a product.
const REFERENCE = {
  meat: { kcal: 165, protein: 31, carbs: 0, fat: 3.6 }, fish: { kcal: 150, protein: 22, carbs: 0, fat: 6.5 },
  eggs: { kcal: 155, protein: 13, carbs: 1.1, fat: 11 }, dairy_protein: { kcal: 100, protein: 11, carbs: 3.4, fat: 4.5 },
  yogurt: { kcal: 70, protein: 5, carbs: 6, fat: 3 }, milk: { kcal: 61, protein: 3.2, carbs: 4.8, fat: 3.3 },
  legumes: { kcal: 116, protein: 9, carbs: 20, fat: 0.4 }, grain: { kcal: 135, protein: 3, carbs: 28, fat: 0.5 },
  bread: { kcal: 265, protein: 9, carbs: 49, fat: 3.2 }, cereal: { kcal: 380, protein: 7, carbs: 84, fat: 1 },
  starch_veg: { kcal: 85, protein: 1.8, carbs: 19, fat: 0.1 }, vegetable: { kcal: 20, protein: 1, carbs: 4, fat: 0.2 },
  fruit: { kcal: 60, protein: 0.5, carbs: 15, fat: 0.2 }, nuts: { kcal: 580, protein: 21, carbs: 20, fat: 50 },
  tahini: { kcal: 600, protein: 17, carbs: 21, fat: 54 }, oil: { kcal: 884, protein: 0, carbs: 0, fat: 100 },
  coffee: { kcal: 2, protein: 0.2, carbs: 0, fat: 0 }, tea: { kcal: 1, protein: 0, carbs: 0.2, fat: 0 },
};
const NAMED_REFERENCE = [
  [/צהוב|מוצרלה|בולגרית|צפתית|פרמזן|עמק/, { kcal: 350, protein: 25, carbs: 1, fat: 27 }],
  [/טופו/, { kcal: 120, protein: 13, carbs: 2, fat: 7 }],
  [/טונה/, { kcal: 116, protein: 26, carbs: 0, fat: 1 }],
  [/סלמון/, { kcal: 208, protein: 20, carbs: 0, fat: 13 }],
];

function referenceFor(p) {
  const named = NAMED_REFERENCE.find(([re]) => re.test(p.name_he || ''));
  return named ? named[1] : REFERENCE[p.group] || null;
}

// Portions are "as eaten": a dry-weight density for rice/pasta/legumes is converted to cooked.
const COOKED_FACTOR = { grain: 2.7, legumes: 3 };

// Smallest sensible portion when scaling down (grams).
const MIN_GRAMS = {
  bread: 30, grain: 60, starch_veg: 80, meat: 80, fish: 70, legumes: 60, eggs: 50,
  dairy_protein: 30, yogurt: 80, milk: 50, cereal: 25, fruit: 60, nuts: 10, tahini: 10, oil: 3,
};

// Groups whose portions are not scaled (negligible calories or sized by habit).
const FIXED_GROUPS = new Set(["vegetable", "coffee", "tea"]);
const SNACK_FILLERS = ["fruit", "nuts", "yogurt"];

/**
 * Parses "1.2 ק״ג", "500 ג", "1 ליטר", "250 מ״ל", "2 × 500 ג", "30 יחידות" (eggs)
 * — and the same with Latin units ("400g", "2×160g", "1kg", "500ml") — to grams.
 */
export function parseQuantityGrams(text, group) {
  const s = String(text || "").replace(/[״"]/g, '"').replace(/[׳']/g, "'").replace(/,/g, ".");
  const mult = Number(s.match(/(\d+)\s*[×x*]\s*\d/)?.[1]) || 1;
  const num = re => {
    const m = s.match(re);
    return m ? parseFloat(m[1]) : null;
  };
  let g = null;
  let v;
  if ((v = num(/(\d+(?:\.\d+)?)\s*(?:ק"ג|קג|קילו|kg)(?![a-z])/i)) != null) g = v * 1000;
  else if ((v = num(/(\d+(?:\.\d+)?)\s*(?:מ"ל|מל(?![א-ת])|ml(?![a-z]))/i)) != null) g = v;
  else if ((v = num(/(\d+(?:\.\d+)?)\s*(?:ליטר|ל'|ל(?![א-ת])|l(?![a-z])|lt(?![a-z])|liter)/i)) != null) g = v * 1000;
  else if ((v = num(/(\d+(?:\.\d+)?)\s*(?:גרם|גר'?|ג'?)(?![א-ת])/)) != null) g = v;
  else if ((v = num(/(\d+(?:\.\d+)?)\s*(?:g|gr|gram|grams)(?![a-z])/i)) != null) g = v;
  else if (group === "eggs" && (v = num(/(\d+)\s*(?:יחידות|יח'|ביצים)/)) != null) g = v * 60;
  if (g == null && group === "eggs") {
    const n = num(/(?:תבנית|מארז)\s*(\d+)/);
    if (n) g = n * 60;
  }
  return g ? g * mult : null;
}

/**
 * Possible total weights for a quantity like "2 יחידות (250 גרם כל אחת)" or
 * "2 חבילות (500 גרם)": the stated weight, and that weight × the package count.
 * "כל אחת"/"each" puts the multiplied reading first; otherwise the plain one.
 */
export function quantityCandidates(text, group) {
  const g = parseQuantityGrams(text, group);
  if (!g) return [];
  const s = String(text || "");
  const count = Number(s.match(/^\s*(\d+)\s*(?:יחידות|יח'|חבילות|מארזים|קופסאות|בקבוקים|שקיות)/)?.[1]);
  if (!count || count < 2 || g === count * 60) return [g];
  const each = /כל אח[תד]|כ"א|כ״א|ליחידה|each/i.test(s);
  return each ? [g * count, g] : [g, g * count];
}

const inRange = (group, kcal, protein) => {
  const [lo, hi] = KCAL_RANGE[group] || KCAL_RANGE.other;
  const [plo, phi] = PROTEIN_RANGE[group] || PROTEIN_RANGE.other;
  return kcal >= lo && kcal <= hi && (protein == null || (protein >= plo && protein <= phi));
};

function median(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
}

/**
 * Per-100g nutrition for every product: shopping-list totals ÷ parsed quantity
 * when plausible, otherwise the median of the AI's own per-item values.
 */
export function buildDensities(catalog, plan) {
  const aiItems = new Map();
  for (const day of plan.days) for (const meal of day.meals) for (const i of meal.items) {
    if (Number(i.grams) > 0) {
      if (!aiItems.has(i.product_id)) aiItems.set(i.product_id, []);
      aiItems.get(i.product_id).push(i);
    }
  }

  const densities = new Map();
  for (const p of catalog) {
    let fromList = null;
    const candidates = quantityCandidates(p.quantity, p.group);
    if (!candidates.length) candidates.push(...quantityCandidates(p.name_he, p.group));
    // First weight reading that gives a plausible kcal/100g wins
    for (const grams of Number(p.calories) > 0 ? candidates : []) {
      const f = 100 / grams;
      const d = { kcal: p.calories * f, protein: (p.protein || 0) * f, carbs: (p.carbs || 0) * f, fat: (p.fat || 0) * f,
        pricePerGram: p.price ? p.price / grams : null };
      const cooked = COOKED_FACTOR[p.group];
      if (cooked && d.kcal > 250) {
        for (const k of ["kcal", "protein", "carbs", "fat"]) d[k] /= cooked;
        if (d.pricePerGram) d.pricePerGram /= cooked;
      }
      if (inRange(p.group, d.kcal, d.protein)) { fromList = d; break; }
    }

    const items = aiItems.get(p.id) || [];
    const per100 = k => median(items.map(i => (Number(i[k]) || 0) * 100 / Number(i.grams)));
    const fromAi = items.length ? {
      kcal: per100("calories"), protein: per100("protein"), carbs: per100("carbs"), fat: per100("fat"),
      pricePerGram: median(items.map(i => (Number(i.estimated_cost) || 0) / Number(i.grams))),
    } : null;

    const aiOk = fromAi && inRange(p.group, fromAi.kcal, fromAi.protein);
    const ref = !fromList && !aiOk ? referenceFor(p) : null;
    const d = fromList || (aiOk ? fromAi : ref);
    if (d) {
      densities.set(p.id, {
        ...d,
        source: fromList ? "list" : aiOk ? "ai" : "reference",
        pricePerGram: d.pricePerGram || fromList?.pricePerGram || fromAi?.pricePerGram || null,
      });
    }
  }
  return densities;
}

const r1 = n => Math.round(n * 10) / 10;

function setGrams(item, grams, density) {
  const old = Number(item.grams) || 0;
  item.grams = grams;
  if (density) {
    item.calories = Math.round(grams * density.kcal / 100);
    item.protein = r1(grams * density.protein / 100);
    item.carbs = r1(grams * density.carbs / 100);
    item.fat = r1(grams * density.fat / 100);
    if (density.pricePerGram) item.estimated_cost = r1(grams * density.pricePerGram);
  } else if (old > 0) {
    const f = grams / old;
    for (const k of ["calories", "protein", "carbs", "fat", "estimated_cost"]) item[k] = r1((Number(item[k]) || 0) * f);
  }
}

/** Recomputes every item's calories/macros/cost from its grams. */
export function applyDensities(plan, densities) {
  for (const day of plan.days) for (const meal of day.meals) for (const item of meal.items) {
    const d = densities.get(item.product_id);
    if (d) setGrams(item, Number(item.grams) || 0, d);
  }
}

const dayCalories = day => day.meals.reduce((s, m) => s + m.items.reduce((t, i) => t + (Number(i.calories) || 0), 0), 0);
const roundGrams = g => (g >= 20 ? Math.round(g / 5) * 5 : Math.max(1, Math.round(g)));

function scaleDay(day, target, catalog, densities) {
  const product = i => catalog.find(p => p.id === i.product_id);
  const entries = day.meals.flatMap(m => m.items).map(item => {
    const p = product(item);
    const grams = Number(item.grams) || 0;
    return {
      item, p,
      adjustable: p && !FIXED_GROUPS.has(p.group) && grams > 0 && Number(item.calories) > 0,
      min: Math.min(grams, Math.max(grams * 0.4, MIN_GRAMS[p?.group] || 10)),
      max: Math.max(grams, (p && portionCap(p)) || grams),
      locked: false,
    };
  });
  for (let pass = 0; pass < 4; pass++) {
    const free = entries.filter(e => e.adjustable && !e.locked);
    const freeKcal = free.reduce((s, e) => s + Number(e.item.calories), 0);
    if (!free.length || freeKcal <= 0) break;
    const fixedKcal = dayCalories(day) - freeKcal;
    const f = (target - fixedKcal) / freeKcal;
    if (Math.abs(f - 1) < 0.01) break;
    for (const e of free) {
      let g = Number(e.item.grams) * f;
      if (g <= e.min) { g = e.min; e.locked = true; }
      if (g >= e.max) { g = e.max; e.locked = true; }
      setGrams(e.item, g, densities.get(e.item.product_id));
    }
  }
  for (const e of entries) if (e.adjustable) setGrams(e.item, roundGrams(Number(e.item.grams)), densities.get(e.item.product_id));
}

function addSnack(day, target, catalog, densities, usedIds) {
  let snacks = day.meals.find(m => m.meal_type === "Snacks");
  if (!snacks) {
    snacks = { meal_type: "Snacks", meal_name: "", items: [] };
    day.meals.push(snacks);
  }
  const inSnack = new Set(snacks.items.map(i => i.product_id));
  // Only products the plan already uses, so dietary restrictions stay respected
  const candidates = catalog.filter(p =>
    SNACK_FILLERS.includes(p.group) && usedIds.has(p.id) && densities.get(p.id)?.kcal > 0 && !inSnack.has(p.id));
  const p = candidates.sort((a, b) => SNACK_FILLERS.indexOf(a.group) - SNACK_FILLERS.indexOf(b.group))[0];
  if (!p) return false;
  const d = densities.get(p.id);
  const gap = target - dayCalories(day);
  const grams = roundGrams(Math.min(portionCap(p) || 150, Math.max(MIN_GRAMS[p.group] || 20, gap * 100 / d.kcal)));
  const item = { product_id: p.id, food_name: p.name_he };
  setGrams(item, grams, d);
  snacks.items.push(item);
  return true;
}

/**
 * Brings each day within ±5% of the target where realistic portions allow.
 * Returns a per-day report of { day, target, before, after, deviation }.
 */
export function balanceCalories(plan, catalog, densities, target) {
  const usedIds = new Set(plan.days.flatMap(d => d.meals.flatMap(m => m.items.map(i => i.product_id))));
  const report = [];
  for (const day of plan.days) {
    const before = dayCalories(day);
    if (Math.abs(before - target) / target > 0.05) {
      scaleDay(day, target, catalog, densities);
      for (let n = 0; n < 2 && dayCalories(day) < target * 0.95; n++) {
        if (!addSnack(day, target, catalog, densities, usedIds)) break;
        scaleDay(day, target, catalog, densities);
      }
    }
    const after = dayCalories(day);
    report.push({ day: day.day_name, target, before, after, deviation: Math.round(((after - target) / target) * 1000) / 10 });
  }
  return report;
}

// Protein-dense groups whose portions may grow, and calorie sources that may
// shrink to make room (carbs/fat), when a day is short on protein.
const PROTEIN_GROUPS = new Set(["meat", "fish", "eggs", "dairy_protein", "legumes", "yogurt"]);
const REDUCIBLE_GROUPS = new Set(["grain", "bread", "starch_veg", "cereal", "fruit", "oil", "tahini", "nuts"]);

const dayProtein = day => day.meals.reduce((s, m) => s + m.items.reduce((t, i) => t + (Number(i.protein) || 0), 0), 0);

/**
 * Moves days that fall below 90% of the protein target toward it without
 * leaving the calorie range: grows existing protein-dense portions (never past
 * their realistic cap) and shrinks carb/fat portions (never below the minimum)
 * to free the calories. No products are added, so meal composition and
 * meat/dairy separation stay as generated. Returns a per-day report.
 */
export function balanceProtein(plan, catalog, densities, { calories: kcalTarget, protein: proteinTarget }) {
  const report = [];
  const product = i => catalog.find(p => p.id === i.product_id);
  for (const day of plan.days) {
    const before = Math.round(dayProtein(day));
    if (proteinTarget && before < proteinTarget * 0.9) {
      for (let pass = 0; pass < 3; pass++) {
        const deficit = proteinTarget * 0.95 - dayProtein(day);
        if (deficit <= 1) break;
        const all = day.meals.flatMap(m => m.items).map(item => ({ item, p: product(item), d: densities.get(item.product_id) }));
        // 1. grow protein portions, proportionally to how much protein each can still add
        const growable = all.filter(e => e.p && e.d && PROTEIN_GROUPS.has(e.p.group) && e.d.protein >= 4)
          .map(e => ({ ...e, room: Math.max(0, (portionCap(e.p) || Number(e.item.grams)) - Number(e.item.grams)) }))
          .filter(e => e.room > 0);
        const capacity = growable.reduce((s, e) => s + e.room * e.d.protein / 100, 0);
        if (capacity <= 0) break;
        const share = Math.min(1, deficit / capacity);
        for (const e of growable) setGrams(e.item, roundGrams(Number(e.item.grams) + e.room * share), e.d);
        // 2. shrink carb/fat portions to return to the calorie target
        const excess = dayCalories(day) - kcalTarget;
        const reducible = all.filter(e => e.p && e.d && REDUCIBLE_GROUPS.has(e.p.group) && Number(e.item.calories) > 0);
        const reducibleKcal = reducible.reduce((s, e) => s + Number(e.item.calories), 0);
        if (excess > 0 && reducibleKcal > 0) {
          const f = Math.max(0, 1 - excess / reducibleKcal);
          for (const e of reducible) {
            const min = Math.min(Number(e.item.grams), MIN_GRAMS[e.p.group] || 10);
            setGrams(e.item, roundGrams(Math.max(min, Number(e.item.grams) * f)), e.d);
          }
        }
      }
    }
    const after = Math.round(dayProtein(day));
    report.push({ day: day.day_name, proteinTarget, before, after, pctOfTarget: proteinTarget ? Math.round(after / proteinTarget * 100) : null, calories: Math.round(dayCalories(day)) });
  }
  return report;
}
