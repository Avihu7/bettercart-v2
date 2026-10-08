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

import { portionCap, dishWord, mealNameMismatches, nameFromItems, breakfastAllows } from '@/lib/mealPlanRules';

// Plausible kcal/100g "as eaten" per food group; values outside are treated as bad data.
const KCAL_RANGE = {
  coffee: [0, 400], tea: [0, 400], milk: [25, 100], plant_milk: [8, 80], yogurt: [35, 220], dairy_protein: [60, 450],
  eggs: [120, 180], meat: [90, 320], fish: [70, 320], legumes: [60, 200], bread: [180, 430],
  grain: [80, 260], cereal: [320, 460], starch_veg: [55, 140], vegetable: [8, 120],
  fruit: [20, 200], avocado: [120, 240], nuts: [250, 700], tahini: [500, 720], oil: [700, 920], other: [0, 920],
};

// Plausible protein g/100g "as eaten" per food group (catches e.g. salmon at 8g/100g).
const PROTEIN_RANGE = {
  coffee: [0, 25], tea: [0, 25], milk: [2.5, 4.5], plant_milk: [0, 4], yogurt: [2.5, 12], dairy_protein: [6, 36],
  eggs: [10, 15], meat: [15, 36], fish: [14, 32], legumes: [5, 28], bread: [5, 15],
  grain: [1.5, 6], cereal: [4, 16], starch_veg: [0.5, 4], vegetable: [0, 6],
  fruit: [0, 3], avocado: [1, 4], nuts: [8, 32], tahini: [14, 30], oil: [0, 1], other: [0, 100],
};

// Typical per-100g values (as eaten), used only when neither the shopping list
// nor the AI gives plausible numbers for a product.
const REFERENCE = {
  meat: { kcal: 165, protein: 31, carbs: 0, fat: 3.6 }, fish: { kcal: 150, protein: 22, carbs: 0, fat: 6.5 },
  eggs: { kcal: 155, protein: 13, carbs: 1.1, fat: 11 }, dairy_protein: { kcal: 100, protein: 11, carbs: 3.4, fat: 4.5 },
  yogurt: { kcal: 70, protein: 5, carbs: 6, fat: 3 }, milk: { kcal: 61, protein: 3.2, carbs: 4.8, fat: 3.3 },
  plant_milk: { kcal: 30, protein: 1, carbs: 1.5, fat: 2.5 },
  legumes: { kcal: 116, protein: 9, carbs: 20, fat: 0.4 }, grain: { kcal: 135, protein: 3, carbs: 28, fat: 0.5 },
  bread: { kcal: 265, protein: 9, carbs: 49, fat: 3.2 }, cereal: { kcal: 380, protein: 7, carbs: 84, fat: 1 },
  starch_veg: { kcal: 85, protein: 1.8, carbs: 19, fat: 0.1 }, vegetable: { kcal: 20, protein: 1, carbs: 4, fat: 0.2 },
  fruit: { kcal: 60, protein: 0.5, carbs: 15, fat: 0.2 }, avocado: { kcal: 160, protein: 2, carbs: 9, fat: 15 }, nuts: { kcal: 580, protein: 21, carbs: 20, fat: 50 },
  tahini: { kcal: 600, protein: 17, carbs: 21, fat: 54 }, oil: { kcal: 884, protein: 0, carbs: 0, fat: 100 },
  coffee: { kcal: 2, protein: 0.2, carbs: 0, fat: 0 }, tea: { kcal: 1, protein: 0, carbs: 0.2, fat: 0 },
};
const NAMED_REFERENCE = [
  [/צהוב|מוצרלה|בולגרית|צפתית|פרמזן|עמק/, { kcal: 350, protein: 25, carbs: 1, fat: 27 }],
  [/טופו/, { kcal: 120, protein: 13, carbs: 2, fat: 7 }],
  [/סייטן/, { kcal: 140, protein: 25, carbs: 6, fat: 2 }],
  [/טונה/, { kcal: 116, protein: 26, carbs: 0, fat: 1 }],
  [/סלמון/, { kcal: 208, protein: 20, carbs: 0, fat: 13 }],
];

function referenceFor(p) {
  const named = NAMED_REFERENCE.find(([re]) => re.test(p.name_he || ''));
  return named ? named[1] : REFERENCE[p.group] || null;
}

/**
 * Per-100g values for a single product: the given values when plausible for its
 * food group, otherwise the typical reference values for that group.
 */
export function plausiblePer100g(p, values) {
  const v = values && Number(values.kcal) > 0 ? values : null;
  if (v && inRange(p.group, v.kcal, v.protein || 0)) {
    return { kcal: v.kcal, protein: v.protein || 0, carbs: v.carbs || 0, fat: v.fat || 0, source: "catalog" };
  }
  const ref = referenceFor(p);
  return ref ? { ...ref, source: "reference" } : null;
}

// Portions are "as eaten": a dry-weight density for rice/pasta/legumes is converted to cooked.
const COOKED_FACTOR = { grain: 2.7, legumes: 3 };
// Ready-to-eat products in those groups are eaten as bought (same as shoppingOptimizer)
const READY_TO_EAT = /טופו|שימורי|קופסה|מבושל|מוכן/;

// Smallest sensible portion when scaling down (grams).
const MIN_GRAMS = {
  bread: 30, grain: 60, starch_veg: 80, meat: 80, fish: 70, legumes: 60, eggs: 50,
  dairy_protein: 30, yogurt: 80, milk: 50, plant_milk: 50, cereal: 25, fruit: 60, avocado: 30, nuts: 10, tahini: 10, oil: 3,
};

// Protein-dense groups whose portions may grow, and calorie sources that may
// shrink to make room (carbs/fat), when a day is short on protein.
const PROTEIN_GROUPS = new Set(["meat", "fish", "eggs", "dairy_protein", "legumes", "yogurt"]);
// Proteins that make a plate on their own — never two on one plate
const PLATE_PROTEIN = new Set(["meat", "fish", "legumes"]);

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
  else if (group === "avocado" && (v = num(/(\d+)\s*(?:יחידות|יח')/)) != null) g = v * 170;
  // A multipack written without a unit ("6x1", "6×1.5"): litres for a small
  // second number (bottles), grams for a larger one ("4x80")
  if (g == null) {
    const pack = s.match(/^\s*(\d+)\s*[×x*]\s*(\d+(?:\.\d+)?)\s*$/i);
    if (pack) return Number(pack[1]) * Number(pack[2]) * (Number(pack[2]) <= 3 ? 1000 : 1);
  }
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
        // The real unit price when known (per gram as eaten: dry rice/pasta/legumes
        // weigh ~2.7–3× more cooked), else derived from the list or the AI
        pricePerGram: p.price_per_kg
          ? p.price_per_kg / 1000 / (COOKED_FACTOR[p.group] && !READY_TO_EAT.test(p.name_he) ? COOKED_FACTOR[p.group] : 1)
          : d.pricePerGram || fromList?.pricePerGram || fromAi?.pricePerGram || null,
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

function scaleDay(day, target, catalog, densities, lockedGroups = null) {
  const product = i => catalog.find(p => p.id === i.product_id);
  const entries = day.meals.flatMap(m => m.items).map(item => {
    const p = product(item);
    const grams = Number(item.grams) || 0;
    return {
      item, p,
      adjustable: p && !FIXED_GROUPS.has(p.group) && !lockedGroups?.has(p.group) && grams > 0 && Number(item.calories) > 0,
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
export function balanceCalories(plan, catalog, densities, target, { lockProtein = false } = {}) {
  // After protein balancing, protein portions stay as they are and only the
  // other portions absorb the calorie correction
  const locked = lockProtein ? PROTEIN_GROUPS : null;
  const usedIds = new Set(plan.days.flatMap(d => d.meals.flatMap(m => m.items.map(i => i.product_id))));
  const report = [];
  for (const day of plan.days) {
    const before = dayCalories(day);
    if (Math.abs(before - target) / target > 0.05) {
      scaleDay(day, target, catalog, densities, locked);
      for (let n = 0; n < 2 && dayCalories(day) < target * 0.95; n++) {
        if (!addSnack(day, target, catalog, densities, usedIds)) break;
        scaleDay(day, target, catalog, densities, locked);
      }
    }
    const after = dayCalories(day);
    report.push({ day: day.day_name, target, before, after, deviation: Math.round(((after - target) / target) * 1000) / 10 });
  }
  return report;
}

const REDUCIBLE_GROUPS = new Set(["grain", "bread", "starch_veg", "cereal", "fruit", "oil", "tahini", "nuts", "avocado"]);
// Carb sources that can grow to take back calories freed by smaller protein portions
const CARB_GROUPS = new Set(["grain", "bread", "starch_veg", "cereal", "fruit"]);

const dayProtein = day => day.meals.reduce((s, m) => s + m.items.reduce((t, i) => t + (Number(i.protein) || 0), 0), 0);

/**
 * Keeps each day's protein within ~90–110% of the target without leaving the
 * calorie range:
 *  - below 90%: grows existing protein-dense portions (never past their
 *    realistic cap) and shrinks carb/fat portions (never below the minimum);
 *  - above 110%: shrinks protein portions (never below the minimum) toward
 *    ~105% and gives the calories back to carb portions (within their caps).
 * No products are added, so meal composition and meat/dairy separation stay
 * as generated. Returns a per-day report.
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
    if (proteinTarget && before > proteinTarget * 1.1) {
      const all = day.meals.flatMap(m => m.items).map(item => ({ item, p: product(item), d: densities.get(item.product_id) }));
      const proteinItems = all.filter(e => e.p && e.d && PROTEIN_GROUPS.has(e.p.group) && Number(e.item.protein) > 0);
      const proteinFromThem = proteinItems.reduce((s, e) => s + Number(e.item.protein), 0);
      const surplus = dayProtein(day) - proteinTarget * 1.05;
      if (surplus > 0 && proteinFromThem > 0) {
        const kcalBefore = dayCalories(day);
        const f = Math.max(0, 1 - surplus / proteinFromThem);
        for (const e of proteinItems) {
          const min = Math.min(Number(e.item.grams), MIN_GRAMS[e.p.group] || 10);
          setGrams(e.item, roundGrams(Math.max(min, Number(e.item.grams) * f)), e.d);
        }
        // give the freed calories back to carb portions, within their caps
        const freed = kcalBefore - dayCalories(day);
        const carbs = all.filter(e => e.p && e.d && CARB_GROUPS.has(e.p.group) && e.d.kcal > 0)
          .map(e => ({ ...e, room: Math.max(0, (portionCap(e.p) || Number(e.item.grams)) - Number(e.item.grams)) }))
          .filter(e => e.room > 0);
        const roomKcal = carbs.reduce((s, e) => s + e.room * e.d.kcal / 100, 0);
        if (freed > 0 && roomKcal > 0) {
          const share = Math.min(1, freed / roomKcal);
          for (const e of carbs) setGrams(e.item, roundGrams(Number(e.item.grams) + e.room * share), e.d);
        }
      }
    }
    const after = Math.round(dayProtein(day));
    report.push({ day: day.day_name, proteinTarget, before, after, pctOfTarget: proteinTarget ? Math.round(after / proteinTarget * 100) : null, calories: Math.round(dayCalories(day)) });
  }
  return report;
}

// ─── Final per-day balancing ─────────────────────────────────────────────────
// Fat-dense extras that can shrink without touching protein portions
const FAT_GROUPS = new Set(["oil", "tahini", "nuts", "avocado"]);
const sumOf = (day, k) => day.meals.reduce((s, m) => s + m.items.reduce((t, i) => t + (Number(i[k]) || 0), 0), 0);

/** Calories the given portions can still add before reaching their caps. */
function growCapacity(entries) {
  return entries.reduce((s, e) => {
    const cap = (SIDE_ITEMS.has(e.item) ? SIDE_SHARE : 1) * (portionCap(e.p) || Number(e.item.grams));
    return s + Math.max(0, cap - Number(e.item.grams)) * e.d.kcal / 100;
  }, 0);
}

/**
 * Grows (kcal > 0) or shrinks (kcal < 0) the given portions proportionally to
 * how far each may still move (portion cap / minimum portion), for at most
 * |kcal| calories. Returns the calories actually moved.
 */
function moveCalories(entries, kcal, sideShare = SIDE_SHARE, floorOf = null) {
  const grow = kcal > 0;
  // A carb side added to a meal that already had one stays a modest portion
  const maxGrams = e => (SIDE_ITEMS.has(e.item) ? sideShare : 1) * (portionCap(e.p) || Number(e.item.grams));
  const room = e => grow
    ? Math.max(0, maxGrams(e) - Number(e.item.grams))
    : Math.max(0, Number(e.item.grams) - Math.min(Number(e.item.grams), floorOf ? floorOf(e) : (MIN_GRAMS[e.p.group] || 10)));
  const movable = entries.map(e => ({ ...e, room: room(e) })).filter(e => e.room > 0 && e.d.kcal > 0);
  const capacity = movable.reduce((s, e) => s + e.room * e.d.kcal / 100, 0);
  if (capacity <= 0) return 0;
  const share = Math.min(1, Math.abs(kcal) / capacity);
  let moved = 0;
  for (const e of movable) {
    const before = Number(e.item.calories) || 0;
    const grams = Number(e.item.grams) + (grow ? 1 : -1) * e.room * share;
    setGrams(e.item, roundGrams(grams), e.d);
    moved += (Number(e.item.calories) || 0) - before;
  }
  return moved;
}

// Carb sides added next to a meal's existing carb (kept to half a portion)
const SIDE_ITEMS = new WeakSet();
// product id → number of meals of the week it is in
const mealUse = plan => {
  const use = new Map();
  for (const d of plan.days) for (const m of d.meals) for (const id of new Set(m.items.map(i => i.product_id))) use.set(id, (use.get(id) || 0) + 1);
  return use;
};
const SIDE_SHARE = 0.5;

/**
 * Adds an existing basket carb (already used in this plan, so diet rules hold)
 * to the day's meals: a meal without a carb gets a regular side, a meal that
 * has one carb gets a second, different carb as a half portion (e.g. bread next
 * to rice, fruit at breakfast). Bread/grains only at breakfast/lunch/dinner,
 * fruit at breakfast and snacks. The side is the carb the week eats least
 * (so the breakfast bread does not also become every lunch's side). Returns the calories added.
 */
function addCarbSides(day, kcalNeeded, catalog, densities, usedCarbs, dayProductIds, weekUse = new Map()) {
  let added = 0;
  for (const mealType of ["Lunch", "Dinner", "Breakfast", "Snacks"]) {
    if (added >= kcalNeeded) break;
    const meal = day.meals.find(m => m.meal_type === mealType);
    if (!meal) continue;
    const inMeal = meal.items.map(i => catalog.find(p => p.id === i.product_id)).filter(Boolean);
    const carbsInMeal = inMeal.filter(p => CARB_GROUPS.has(p.group));
    if (carbsInMeal.length >= 2) continue;
    const fits = p => p.meal_roles?.includes(mealType) &&
      (mealType === "Snacks" ? p.group === "fruit" : mealType === "Breakfast" || p.group !== "fruit") &&
      !inMeal.some(q => q.id === p.id) && !carbsInMeal.some(q => q.group === p.group);
    // The carb the week uses least, then one this day already eats
    const options = usedCarbs.filter(fits)
      .sort((a, b) => (weekUse.get(a.id) || 0) - (weekUse.get(b.id) || 0) ||
        Number(dayProductIds.has(b.id)) - Number(dayProductIds.has(a.id)));
    const p = options[0];
    if (!p) continue;
    const d = densities.get(p.id);
    const isSide = carbsInMeal.length > 0;
    const max = (portionCap(p) || 150) * (isSide ? SIDE_SHARE : 0.8);
    const grams = roundGrams(Math.min(max, Math.max(MIN_GRAMS[p.group] || 30, (kcalNeeded - added) * 100 / d.kcal)));
    const item = { product_id: p.id, food_name: p.name_he };
    setGrams(item, grams, d);
    if (isSide) SIDE_ITEMS.add(item);
    meal.items.push(item);
    weekUse.set(p.id, (weekUse.get(p.id) || 0) + 1);
    if (meal.meal_name) meal.meal_name = `${meal.meal_name} ו${dishWord(p.name_he)}`;
    added += item.calories;
  }
  return added;
}

/**
 * Adds a modest fat side (olive oil / tahini already used in the plan) to
 * lunch/dinner/breakfast plates that have no fat source, for at most `kcal`.
 * Returns the calories added.
 */
function addFatSides(day, kcal, catalog, densities, usedIds) {
  const fats = catalog.filter(p => ["oil", "tahini"].includes(p.group) && usedIds.has(p.id) && densities.get(p.id)?.kcal > 0)
    .sort((a, b) => (a.group === "oil" ? 0 : 1) - (b.group === "oil" ? 0 : 1));
  let added = 0;
  for (const mealType of ["Lunch", "Dinner", "Breakfast"]) {
    if (added >= kcal) break;
    const meal = day.meals.find(m => m.meal_type === mealType);
    if (!meal || meal.items.some(i => FAT_GROUPS.has(catalog.find(p => p.id === i.product_id)?.group))) continue;
    // Oil/tahini go on bread or a salad — never into a yogurt-and-fruit or cereal breakfast
    if (mealType === "Breakfast" && !meal.items.some(i => ["bread", "vegetable"].includes(catalog.find(p => p.id === i.product_id)?.group))) continue;
    const p = fats.find(f => f.meal_roles?.includes(mealType));
    if (!p) continue;
    const d = densities.get(p.id);
    const grams = roundGrams(Math.min((portionCap(p) || 20) * 0.5, Math.max(MIN_GRAMS[p.group] || 5, (kcal - added) * 100 / d.kcal)));
    const item = { product_id: p.id, food_name: p.name_he };
    setGrams(item, grams, d);
    meal.items.push(item);
    if (meal.meal_name) meal.meal_name = `${meal.meal_name} ו${dishWord(p.name_he)}`;
    added += item.calories;
  }
  return added;
}

/**
 * Adds a protein food from the basket to lunch/dinner/breakfast plates that
 * lack one, for a day short of protein: most protein-dense first, within a
 * realistic portion, never mixing meat with dairy, and never a second meat/fish
 * on a plate. Returns the protein (g) added.
 */
/**
 * Same calories, more protein: in a day short of protein, calories move from
 * the least protein-dense protein food on a plate (e.g. lentils) to a denser
 * one from the basket allowed in that meal (e.g. seitan, tofu) — kosher-safe,
 * never a second meat/fish on a plate, within realistic portions.
 * Returns the protein (g) gained.
 */
function densifyProtein(day, proteinNeeded, catalog, densities) {
  const ratio = p => densities.get(p.id).protein / Math.max(1, densities.get(p.id).kcal);
  const dense = catalog.filter(p => PROTEIN_GROUPS.has(p.group) && densities.get(p.id)?.kcal > 0)
    .sort((a, b) => ratio(b) - ratio(a));
  let gained = 0;
  for (const meal of day.meals) {
    if (gained >= proteinNeeded) break;
    const inMeal = meal.items.map(i => ({ i, p: catalog.find(c => c.id === i.product_id) })).filter(e => e.p);
    for (const low of inMeal.filter(e => PROTEIN_GROUPS.has(e.p.group) && densities.get(e.p.id))) {
      if (gained >= proteinNeeded) break;
      const better = dense.find(p => ratio(p) > ratio(low.p) * 1.4 && p.meal_roles?.includes(meal.meal_type) &&
        !(p.kosher === "meat" && inMeal.some(e => e.p.kosher === "dairy")) &&
        !(p.kosher === "dairy" && inMeal.some(e => e.p.kosher === "meat")) &&
        !(["meat", "fish"].includes(p.group) && inMeal.some(e => ["meat", "fish"].includes(e.p.group) && e.p.id !== p.id)) &&
        breakfastAllows(meal.meal_type, inMeal.map(e => e.p), p));
      if (!better) continue;
      const dLow = densities.get(low.p.id);
      const dHigh = densities.get(better.id);
      let target = meal.items.find(i => i.product_id === better.id);
      const room = (portionCap(better) || 200) - (Number(target?.grams) || 0);
      const lowSpare = Number(low.i.grams) - (MIN_GRAMS[low.p.group] || 50);
      // calories to move: what the gap needs, what the low item can give, what the dense item can take
      const kcal = Math.min((proteinNeeded - gained) / (ratio(better) - ratio(low.p)), lowSpare * dLow.kcal / 100, room * dHigh.kcal / 100);
      if (kcal < 40) continue;
      const before = sumOf(day, "protein");
      setGrams(low.i, roundGrams(Number(low.i.grams) - kcal * 100 / dLow.kcal), dLow);
      if (!target) {
        target = { product_id: better.id, food_name: better.name_he };
        setGrams(target, 0, dHigh);
        meal.items.push(target);
        if (meal.meal_name) meal.meal_name = `${meal.meal_name} ו${dishWord(better.name_he)}`;
      }
      setGrams(target, roundGrams(Number(target.grams) + kcal * 100 / dHigh.kcal), dHigh);
      gained += sumOf(day, "protein") - before;
    }
  }
  return gained;
}

function addProteinSides(day, proteinNeeded, catalog, densities, kcalBudget = Infinity) {
  let added = 0;
  let kcalAdded = 0;
  const options = catalog
    .filter(p => PROTEIN_GROUPS.has(p.group) && densities.get(p.id)?.protein >= 8)
    .sort((a, b) => densities.get(b.id).protein - densities.get(a.id).protein);
  for (const mealType of ["Lunch", "Dinner", "Breakfast"]) {
    if (added >= proteinNeeded || kcalAdded >= kcalBudget - 20) break;
    const meal = day.meals.find(m => m.meal_type === mealType);
    if (!meal) continue;
    const inMeal = meal.items.map(i => catalog.find(p => p.id === i.product_id)).filter(Boolean);
    // One main protein per plate: a meat / fish / legume plate gets no second protein
    // (no 80 g chicken on a soy plate); a dairy / egg plate and breakfast only more dairy
    // or eggs (no tuna beside oats)
    if (inMeal.some(p => PLATE_PROTEIN.has(p.group))) continue;
    const dairyPlate = mealType === "Breakfast" || inMeal.some(p => PROTEIN_GROUPS.has(p.group));
    const p = options.find(o =>
      o.meal_roles?.includes(mealType) && !inMeal.some(q => q.id === o.id) &&
      !(o.kosher === "meat" && inMeal.some(q => q.kosher === "dairy")) &&
      !(o.kosher === "dairy" && inMeal.some(q => q.kosher === "meat")) &&
      !(dairyPlate && PLATE_PROTEIN.has(o.group)) && breakfastAllows(mealType, inMeal, o));
    if (!p) continue;
    const d = densities.get(p.id);
    const grams = roundGrams(Math.min((portionCap(p) || 150) * 0.8, (kcalBudget - kcalAdded) * 100 / d.kcal,
      Math.max(MIN_GRAMS[p.group] || 50, (proteinNeeded - added) * 100 / d.protein)));
    if (grams < (MIN_GRAMS[p.group] || 30)) continue;
    const item = { product_id: p.id, food_name: p.name_he };
    setGrams(item, grams, d);
    meal.items.push(item);
    if (meal.meal_name) meal.meal_name = `${meal.meal_name} ו${dishWord(p.name_he)}`;
    added += item.protein;
    kcalAdded += item.calories;
  }
  return added;
}

/** Adds a snack portion of nuts already used in the plan (≤ its cap). Returns the calories added. */
function addNutSnack(day, kcal, catalog, densities, usedIds) {
  const snacks = day.meals.find(m => m.meal_type === "Snacks");
  if (!snacks || snacks.items.some(i => catalog.find(p => p.id === i.product_id)?.group === "nuts")) return 0;
  const p = catalog.find(c => c.group === "nuts" && usedIds.has(c.id) && densities.get(c.id)?.kcal > 0);
  if (!p) return 0;
  const d = densities.get(p.id);
  const grams = roundGrams(Math.min(portionCap(p) || 40, Math.max(MIN_GRAMS.nuts, kcal * 100 / d.kcal)));
  const item = { product_id: p.id, food_name: p.name_he };
  setGrams(item, grams, d);
  snacks.items.push(item);
  if (snacks.meal_name) snacks.meal_name = `${snacks.meal_name} ו${dishWord(p.name_he)}`;
  return item.calories;
}

/**
 * One deterministic pass per day, in priority order (no loops between passes):
 *   1. protein into ~90–110% of target (see balanceProtein);
 *   2. fat above 115% → shrink oil/tahini/nuts toward the fat target;
 *   3. calories short → grow the day's carb portions, then add carb sides
 *      (two rounds at most), then (only if still short) fat up to 110%;
 *      calories over → shrink fat extras, then carbs;
 *   4. protein pushed above 110% by bread sides → trim back once, calories
 *      returned to carbs/fat;
 *   5. recompute and report.
 * Protein portions are never grown to fill calories.
 * Portions always stay between their minimum and realistic cap.
 */
export function finalizeDays(plan, catalog, densities, { calories: kcalTarget, protein: proteinTarget, fat: fatTarget }) {
  const product = i => catalog.find(p => p.id === i.product_id);
  const usedIds = new Set(plan.days.flatMap(d => d.meals.flatMap(m => m.items.map(i => i.product_id))));
  const usedCarbs = catalog.filter(p => usedIds.has(p.id) && CARB_GROUPS.has(p.group) && densities.get(p.id)?.kcal > 0);

  balanceProtein(plan, catalog, densities, { calories: kcalTarget, protein: proteinTarget });

  const report = [];
  for (const day of plan.days) {
    const entries = groups => day.meals.flatMap(m => m.items)
      .map(item => ({ item, p: product(item), d: densities.get(item.product_id) }))
      .filter(e => e.p && e.d && groups.has(e.p.group) && Number(e.item.grams) > 0);
    const kcal = () => sumOf(day, "calories");

    // 2. excessive fat
    if (fatTarget && sumOf(day, "fat") > fatTarget * 1.15) {
      const fatKcalOver = (sumOf(day, "fat") - fatTarget) * 9;
      moveCalories(entries(FAT_GROUPS), -fatKcalOver);
    }

    // 3. calories
    let gap = kcalTarget - kcal();
    if (gap > kcalTarget * 0.02) {
      // Fat comes before carbs: a day low on fat first grows its fat sources
      // (oil, tahini, nuts, avocado) toward the fat target
      if (fatTarget && sumOf(day, "fat") < fatTarget * 0.9) {
        gap -= moveCalories(entries(FAT_GROUPS), Math.min(gap, (fatTarget - sumOf(day, "fat")) * 9));
        if (sumOf(day, "fat") < fatTarget * 0.9) {
          gap -= addFatSides(day, Math.min(gap, (fatTarget - sumOf(day, "fat")) * 9), catalog, densities, usedIds);
        }
      }
      gap -= moveCalories(entries(CARB_GROUPS), gap);
      // At most two rounds: a carb for meals without one, then a half-portion side
      for (let round = 0; round < 2 && gap > kcalTarget * 0.03; round++) {
        const dayIds = new Set(day.meals.flatMap(m => m.items.map(i => i.product_id)));
        if (!addCarbSides(day, gap, catalog, densities, usedCarbs, dayIds, mealUse(plan))) break;
        gap = kcalTarget - kcal();
        if (gap > 0) gap -= moveCalories(entries(CARB_GROUPS), gap);
      }
      if (gap > kcalTarget * 0.02 && fatTarget) {
        // Fat may rise up to 110% of its target (calories come before fat):
        // grow the day's fat extras, or add nuts the plan already uses as a snack
        const fatRoom = () => Math.max(0, fatTarget * 1.1 - sumOf(day, "fat")) * 9;
        gap -= moveCalories(entries(FAT_GROUPS), Math.min(gap, fatRoom()));
        if (gap > kcalTarget * 0.02 && fatRoom() > 90) {
          gap -= addNutSnack(day, Math.min(gap, fatRoom()), catalog, densities, usedIds);
        }
      }
    } else if (gap < -kcalTarget * 0.05) {
      let over = -gap;
      if (fatTarget) {
        const fatSpare = Math.max(0, sumOf(day, "fat") - fatTarget) * 9;
        over += moveCalories(entries(FAT_GROUPS), -Math.min(over, fatSpare));
      }
      if (over > kcalTarget * 0.02) moveCalories(entries(CARB_GROUPS), -over);
    }

    // Carb sides add protein too (bread ~9 g/100 g): trim protein portions back
    // to ~107% once and give the calories to carbs, then fat (≤110%). Calories
    // come first, so the trim stops where nothing could take the calories back.
    if (proteinTarget && sumOf(day, "protein") > proteinTarget * 1.1) {
      const protein = entries(PROTEIN_GROUPS);
      const kcalPerProtein = protein.reduce((s, e) => s + e.d.kcal, 0) / Math.max(1, protein.reduce((s, e) => s + e.d.protein, 0));
      const surplusKcal = (sumOf(day, "protein") - proteinTarget * 1.07) * kcalPerProtein;
      const fatRoomKcal = fatTarget ? Math.max(0, fatTarget * 1.1 - sumOf(day, "fat")) * 9 : 0;
      const refill = growCapacity(entries(CARB_GROUPS)) + Math.min(fatRoomKcal, growCapacity(entries(FAT_GROUPS)));
      const spareKcal = Math.max(0, kcal() - kcalTarget * 0.95);
      moveCalories(protein, -Math.min(surplusKcal, spareKcal + refill));
      let short = kcalTarget - kcal();
      if (short > 0) short -= moveCalories(entries(CARB_GROUPS), short);
      if (short > 0 && fatTarget) {
        moveCalories(entries(FAT_GROUPS), Math.min(short, Math.max(0, fatTarget * 1.1 - sumOf(day, "fat")) * 9));
      }
    }

    // 4. final numbers for this day
    const after = { calories: Math.round(kcal()), protein: Math.round(sumOf(day, "protein")), carbs: Math.round(sumOf(day, "carbs")), fat: Math.round(sumOf(day, "fat")) };
    const deviation = Math.round((after.calories - kcalTarget) / kcalTarget * 1000) / 10;
    const flags = [];
    if (Math.abs(deviation) > 10) flags.push("calories outside ±10%");
    else if (Math.abs(deviation) > 5) flags.push("calories outside ±5%");
    if (proteinTarget && (after.protein < proteinTarget * 0.9 || after.protein > proteinTarget * 1.1)) flags.push("protein outside 90–110%");
    if (fatTarget && (after.fat < fatTarget * 0.85 || after.fat > fatTarget * 1.15)) flags.push("fat outside 85–115%");
    report.push({ day: day.day_name, ...after, deviation, flags });
  }
  return report;
}

// ─── Calorie closure ─────────────────────────────────────────────────────────
// The daily calorie target is a hard constraint: every day must end within
// ±CLOSURE_TOLERANCE of it, measured from the actual portions (grams × per-100g).
export const CLOSURE_TOLERANCE = 0.03;
const CLOSURE_AIM = 0.01;
const CLOSURE_ITERATIONS = 6;
// Carb sides may grow to 75% of a portion, and to a full portion only when still short
const SIDE_TIERS = [0.75, 1];

/**
 * Final deterministic pass, after all other balancing. Per day, up to
 * CLOSURE_ITERATIONS rounds of: measure → pick what to adjust → change grams.
 *  - short of calories: grow the day's carb portions (sides in tiers), then add
 *    a carb side the basket already offers, then — only while fat is below its
 *    target — the day's fat sources. Protein foods are never grown.
 *  - over: shrink fat sources above the fat target, then carb portions.
 *  - carb growth pushing protein over 110% (bread has protein) → protein
 *    portions are trimmed back to ~107%, and the next round refills with carbs.
 * A day is ok only when calories are within ±3% AND protein is 90–110% AND
 * fat is 75–115% (aimed at 95–100%) AND no portion exceeds its cap. One exception: when the
 * basket cannot supply 90% protein even at full portions (limits), the day is
 * accepted at the highest protein it can reach and the limit is reported.
 * Returns per-day { day, target, before, after, deviation, ok, failures,
 * protein, carbs, fat, adjustments: [{ name, grams, added }] }.
 */
export function closeCalories(plan, catalog, densities, { calories: target, protein: proteinTarget, fat: fatTarget }) {
  const product = i => catalog.find(p => p.id === i.product_id);
  const usedIds = new Set(plan.days.flatMap(d => d.meals.flatMap(m => m.items.map(i => i.product_id))));
  const usedCarbs = catalog.filter(p => usedIds.has(p.id) && CARB_GROUPS.has(p.group) && densities.get(p.id)?.kcal > 0);
  const report = [];
  for (const day of plan.days) {
    const startGrams = new Map(day.meals.flatMap(m => m.items).map(i => [i, Number(i.grams) || 0]));
    const entries = groups => day.meals.flatMap(m => m.items.map(item => ({ item, meal: m, p: product(item), d: densities.get(item.product_id) })))
      .filter(e => e.p && e.d && groups.has(e.p.group) && Number(e.item.grams) > 0);
    const kcal = () => sumOf(day, "calories");
    // Protein outranks carbs: when protein needs the room, carb portions may go
    // below their usual minimum, even out of a plate — except breakfast bread/
    // cereal, snack fruit, and a plate's only base (no vegetables beside it)
    const carbFloor = e => {
      if (["bread", "cereal"].includes(e.p.group) || e.meal.meal_type === "Snacks") return MIN_GRAMS[e.p.group] || 10;
      const hasVegetable = e.meal.items.some(i => product(i)?.group === "vegetable");
      return hasVegetable ? 0 : MIN_GRAMS[e.p.group] || 10;
    };
    const proteinCarbRoom = () => entries(CARB_GROUPS).reduce((s, e) =>
      s + Math.max(0, Number(e.item.grams) - carbFloor(e)) * e.d.kcal / 100, 0);
    const before = Math.round(kcal());

    // Protein under 90%: grow the day's protein portions, then add a protein
    // food from the basket to a plate without one — but only within the
    // calorie budget (calories come first): what the day is still short, plus
    // what carbs and fat can give back above their minimum portions
    if (proteinTarget && sumOf(day, "protein") < proteinTarget * 0.95) {
      const fatSpare = entries(FAT_GROUPS).reduce((s, e) =>
        s + Math.max(0, Number(e.item.grams) - (MIN_GRAMS[e.p.group] || 10)) * e.d.kcal / 100, 0);
      let budget = Math.max(0, target - kcal()) + (proteinCarbRoom() + fatSpare) * 0.9;
      const protein = entries(PROTEIN_GROUPS);
      const kcalPerProtein = protein.reduce((s, e) => s + e.d.kcal, 0) / Math.max(1, protein.reduce((s, e) => s + e.d.protein, 0));
      budget -= moveCalories(protein, Math.min(budget, (proteinTarget * 0.98 - sumOf(day, "protein")) * kcalPerProtein));
      if (sumOf(day, "protein") < proteinTarget * 0.95 && budget > 50) {
        addProteinSides(day, proteinTarget * 0.98 - sumOf(day, "protein"), catalog, densities, budget);
      }
    }

    // Still short of protein: same calories, denser protein foods
    if (proteinTarget && sumOf(day, "protein") < proteinTarget * 0.95) {
      densifyProtein(day, proteinTarget * 0.98 - sumOf(day, "protein"), catalog, densities);
    }

    // Fat above 110%: trim fat sources, the calories go back to carbs below
    if (fatTarget && sumOf(day, "fat") > fatTarget * 1.1) {
      const freed = -moveCalories(entries(FAT_GROUPS), -(sumOf(day, "fat") - fatTarget * 1.02) * 9);
      if (freed > 0) moveCalories(entries(CARB_GROUPS), freed);
    }

    // Fat well under its target: give fat sources the room first (the rounds
    // below then take the same calories back from carbs) — but only once
    // protein is in range: protein comes before fat
    if (fatTarget && sumOf(day, "fat") < fatTarget * 0.9 && (!proteinTarget || sumOf(day, "protein") >= proteinTarget * 0.9)) {
      // only within the calorie budget: what the day is short, plus what carbs
      // can give back above their minimum — never at the expense of protein
      const carbSpare = entries(CARB_GROUPS).reduce((s, e) =>
        s + Math.max(0, Number(e.item.grams) - (MIN_GRAMS[e.p.group] || 10)) * e.d.kcal / 100, 0);
      const budget = Math.max(0, target - kcal()) + carbSpare * 0.9;
      const want = Math.min((fatTarget * 0.95 - sumOf(day, "fat")) * 9, budget);
      const grown = want > 0 ? moveCalories(entries(FAT_GROUPS), want) : 0;
      if (want > 0 && grown < want * 0.5) addFatSides(day, want - grown, catalog, densities, usedIds);
    }

    for (let iter = 0; iter < CLOSURE_ITERATIONS; iter++) {
      const delta = target - kcal();
      if (Math.abs(delta) <= target * CLOSURE_AIM) break;
      let moved = 0;
      if (delta > 0) {
        for (const share of SIDE_TIERS) {
          moved += moveCalories(entries(CARB_GROUPS), delta - moved, share);
          if (target - kcal() <= target * CLOSURE_AIM) break;
        }
        if (target - kcal() > target * CLOSURE_AIM) {
          const dayIds = new Set(day.meals.flatMap(m => m.items.map(i => i.product_id)));
          moved += addCarbSides(day, target - kcal(), catalog, densities, usedCarbs, dayIds, mealUse(plan));
        }
        if (fatTarget && target - kcal() > target * CLOSURE_AIM && sumOf(day, "fat") < fatTarget) {
          moved += moveCalories(entries(FAT_GROUPS), Math.min(target - kcal(), (fatTarget - sumOf(day, "fat")) * 9));
        }
      } else {
        if (fatTarget && sumOf(day, "fat") > fatTarget) {
          moved -= moveCalories(entries(FAT_GROUPS), -Math.min(-delta, (sumOf(day, "fat") - fatTarget) * 9));
        }
        if (kcal() - target > target * CLOSURE_AIM) moved -= moveCalories(entries(CARB_GROUPS), -(kcal() - target));
        // Still over: fat sources come down (not under ~88% of the fat target) before protein is touched
        if (fatTarget && kcal() - target > target * CLOSURE_AIM && sumOf(day, "fat") > fatTarget * 0.88) {
          moved -= moveCalories(entries(FAT_GROUPS), -Math.min(kcal() - target, (sumOf(day, "fat") - fatTarget * 0.88) * 9));
        }
        // Protein outranks carbs: before any protein is cut, carbs go below
        // their usual minimum portion (see carbFloor)
        if (proteinTarget && kcal() - target > target * CLOSURE_AIM && sumOf(day, "protein") <= proteinTarget * 1.05) {
          moved -= moveCalories(entries(CARB_GROUPS), -(kcal() - target), SIDE_SHARE, carbFloor);
        }
        // Only then protein: above the target freely, below it only as far as
        // needed to bring the day back within ±3% (calories come first)
        if (proteinTarget && kcal() - target > target * CLOSURE_AIM) {
          const protein = entries(PROTEIN_GROUPS);
          const kcalPerProtein = protein.reduce((s, e) => s + e.d.kcal, 0) / Math.max(1, protein.reduce((s, e) => s + e.d.protein, 0));
          const spare = Math.max(0, sumOf(day, "protein") - proteinTarget) * kcalPerProtein;
          const over = kcal() - target;
          const needed = over > target * CLOSURE_TOLERANCE ? over - target * CLOSURE_TOLERANCE * 0.5 : 0;
          moved -= moveCalories(protein, -Math.max(Math.min(over, spare), needed));
        }
      }
      // Protein stays a protein target, not a calorie filler: past 108% (bread
      // and other carbs carry protein too) protein portions go back to ~105%
      if (proteinTarget && sumOf(day, "protein") > proteinTarget * 1.08) {
        const protein = entries(PROTEIN_GROUPS);
        const kcalPerProtein = protein.reduce((s, e) => s + e.d.kcal, 0) / Math.max(1, protein.reduce((s, e) => s + e.d.protein, 0));
        moved -= moveCalories(protein, -(sumOf(day, "protein") - proteinTarget * 1.05) * kcalPerProtein);
      }
      if (Math.abs(moved) < 1) break;
    }

    // Carb portions cut to nothing leave the plate; dish names follow the plate
    for (const meal of day.meals) {
      const kept = meal.items.filter(i => Number(i.grams) >= 5 || !CARB_GROUPS.has(product(i)?.group));
      if (kept.length !== meal.items.length && kept.length) {
        meal.items = kept;
        if (mealNameMismatches(meal.meal_name, meal.items, catalog).length) meal.meal_name = nameFromItems(meal.items);
      }
    }

    const adjustments = day.meals.flatMap(m => m.items).map(i => ({
      name: i.food_name, grams: Math.round((Number(i.grams) || 0) - (startGrams.get(i) ?? 0)), added: !startGrams.has(i),
    })).filter(a => a.grams !== 0);
    const after = Math.round(kcal());
    const deviation = Math.round((after - target) / target * 1000) / 10;
    const protein = sumOf(day, "protein");
    const fat = sumOf(day, "fat");
    // A day is only accepted when every condition holds together — calories
    // are never reached at the cost of protein, fat or realistic portions
    const failures = [];
    const limits = [];
    if (Math.abs(after - target) > target * CLOSURE_TOLERANCE) failures.push("calories outside ±3%");
    // Protein the day could reach with every protein food at its full realistic
    // portion. If even that is under 90%, the basket — not the day — is the
    // limit: regenerating cannot fix it, so it is reported instead of failing.
    const proteinCeiling = protein + entries(PROTEIN_GROUPS)
      .reduce((s, e) => s + Math.max(0, (portionCap(e.p) || 0) - Number(e.item.grams)) * e.d.protein / 100, 0);
    if (proteinTarget && protein < proteinTarget * 0.9 && proteinCeiling < proteinTarget * 0.9) limits.push("protein limited by basket");
    else if (proteinTarget && (protein < proteinTarget * 0.9 || protein > proteinTarget * 1.1)) failures.push("protein outside 90–110%");
    // Fat is the softer target (calories and protein come first): above 115% is
    // a failure, below is accepted down to 75% when the day had no room for more
    if (fatTarget && (fat < fatTarget * 0.75 || fat > fatTarget * 1.15)) failures.push("fat outside 75–115%");
    const oversized = day.meals.flatMap(m => m.items).filter(i => { const p = product(i); const cap = p && portionCap(p); return cap && Number(i.grams) > cap; });
    if (oversized.length) failures.push("portion above its realistic cap");
    report.push({
      day: day.day_name, target, before, after, deviation,
      ok: failures.length === 0, failures, limits, proteinCeiling: Math.round(proteinCeiling),
      protein: Math.round(protein), carbs: Math.round(sumOf(day, "carbs")), fat: Math.round(fat),
      adjustments,
    });
  }
  return report;
}
