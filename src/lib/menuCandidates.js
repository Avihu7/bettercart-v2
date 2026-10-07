/**
 * Candidate meals — every valid meal the basket can make, per meal type.
 * Deterministic: the same catalog gives the same candidates in the same order.
 *
 * A candidate is a meal PATTERN (a recognizable Israeli meal) filled with
 * basket products: { id, mealType, pattern, style, items: [{ product, grams }],
 * main (protein product or null), carb, produce: [ids], nutrition, cost }.
 * Only candidates that pass the meal rules (checkMeal: meal roles, kosher,
 * one main protein, milk with coffee/cereal, portions) are returned.
 *
 *   Breakfast  bread + cheese/cottage/tofu + vegetables   (bread)
 *              eggs (+ bread) + vegetables                (eggs)
 *              tuna + bread + vegetables                  (tuna)
 *              cottage/cheese + avocado + vegetables      (cottage_avocado)
 *              cereal/oats + milk + fruit                 (cereal)
 *              yogurt + fruit (+ nuts or oats)            (yogurt)
 *   Lunch      protein + carb + vegetables (+ oil/tahini) (plate)
 *              eggs/dairy + bread + vegetables            (dairy_plate)
 *   Dinner     cheese/eggs/yogurt + bread + vegetables    (dairy_plate)
 *              fish/legumes + carb or bread + vegetables  (plate)
 *   Snacks     fruit | fruit + nuts | yogurt (+ fruit) | nuts
 *
 * Portions are starting points (the meal's share of the daily protein for its
 * protein, typical sizes for the rest); portion balancing sets the final grams.
 */
import { checkMeal, portionCap, dishWord } from "@/lib/mealPlanRules";

export const MEAL_TYPES = ["Breakfast", "Lunch", "Dinner", "Snacks"];
export const MEAL_SHARE = { Breakfast: 0.25, Lunch: 0.35, Dinner: 0.27, Snacks: 0.13 };

// How natural each pattern is as an everyday Israeli meal (0..1)
export const PATTERN_REALISM = {
  bread: 1, eggs: 1, cereal: 0.95, yogurt: 0.9, tuna: 0.85, cottage_avocado: 0.9,
  plate: 1, dairy_plate: 0.9, starch_plate: 0.4,
  fruit: 1, fruit_nuts: 0.95, yogurt_snack: 0.9, nuts: 0.8,
};

// Starting portions (grams as eaten)
const PORTION = {
  bread: 100, cereal: 60, grain: 200, starch_veg: 250, vegetable: 120, fruit: 150, avocado: 70,
  nuts: 30, tahini: 20, oil: 10, coffee: 10, tea: 2, milk: 200, plant_milk: 200, yogurt: 200,
  dairy_protein: 150, eggs: 120, meat: 150, fish: 150, legumes: 200,
};
const MIN_PROTEIN = { meat: 100, fish: 100, legumes: 120, eggs: 100, dairy_protein: 50, yogurt: 120 };
const HARD_CHEESE = /צהוב|מוצרלה|בולגרית|צפתית|פרמזן|עמק/;
const MAX_VEG = 6; // vegetables considered for a plate (best first)

const has = (p, mealType) => p.meal_roles?.includes(mealType);
const byName = (a, b) => a.name_he.localeCompare(b.name_he, "he");

/** Grams of a protein food for its meal's share of the daily protein target. */
function proteinGrams(p, d, proteinTarget, share) {
  const base = p.group === "dairy_protein" && HARD_CHEESE.test(p.name_he) ? 50 : PORTION[p.group] || 150;
  const cap = portionCap(p) || base * 1.6;
  if (!proteinTarget || !(d?.protein > 0)) return Math.min(base, cap);
  const g = proteinTarget * share / d.protein * 100;
  return Math.round(Math.min(cap, Math.max(MIN_PROTEIN[p.group] || 50, Math.min(g, base * 1.6))) / 5) * 5;
}

/** "X עם Y, Z ו-W" from the meal's food items (oil, milk and coffee are not named). */
function dishName(items) {
  const words = [...new Set(items
    .filter(i => !["oil", "milk", "plant_milk", "coffee", "tea"].includes(i.product.group))
    .map(i => dishWord(i.product.name_he)))];
  let name = words[0] || "";
  if (words.length === 2) name += ` עם ${words[1]}`;
  if (words.length > 2) name += ` עם ${words.slice(1, -1).join(", ")} ו${words.at(-1)}`;
  if (items.some(i => i.product.group === "coffee")) name += " + קפה";
  return name;
}

/** Consecutive pairs of a list, wrapping: [a,b,c] → [a,b] [b,c] [c,a] (one item → [a]). */
function rotatingPairs(list) {
  if (list.length <= 1) return list.map(x => [x]);
  if (list.length === 2) return [[list[0], list[1]]];
  return list.map((x, i) => [x, list[(i + 1) % list.length]]);
}

/**
 * All candidates per meal type: { Breakfast: [...], Lunch: [...], Dinner: [...], Snacks: [...] }.
 * catalog: buildProductCatalog(eatable basket items); densities: buildDensities(catalog, { days: [] }).
 */
export function generateCandidates({ catalog, densities, profile }) {
  const usable = catalog.filter(p => densities.get(p.id) && p.group !== "other").sort(byName);
  const of = (groups, mealType) => usable.filter(p => groups.includes(p.group) && (!mealType || has(p, mealType)));
  const proteinTarget = profile?.protein_target;
  const out = { Breakfast: [], Lunch: [], Dinner: [], Snacks: [] };
  const seen = new Set();

  const add = (mealType, pattern, parts, { main = null, carb = null, style = pattern } = {}) => {
    const items = parts.filter(Boolean);
    if (!items.length) return;
    const key = `${mealType}|${items.map(i => i.product.id).sort().join(",")}`;
    if (seen.has(key)) return;
    seen.add(key);
    const meal = { meal_type: mealType, meal_name: dishName(items), items: items.map(i => ({ product_id: i.product.id, food_name: i.product.name_he, grams: i.grams })) };
    // only meals that keep every meal rule — except the protein-less fallback
    // plate, kept so a basket without a protein still gets (and explains) a menu
    const issues = checkMeal(meal, catalog).filter(r => !(pattern === "starch_plate" && r === "main meal without a protein"));
    if (issues.length) return;
    const nutrition = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    let cost = 0;
    for (const i of items) {
      const d = densities.get(i.product.id);
      nutrition.kcal += d.kcal * i.grams / 100;
      nutrition.protein += d.protein * i.grams / 100;
      nutrition.carbs += d.carbs * i.grams / 100;
      nutrition.fat += d.fat * i.grams / 100;
      cost += (d.pricePerGram || 0) * i.grams;
    }
    out[mealType].push({
      id: `${mealType[0]}${out[mealType].length}`,
      mealType, pattern, style, meal, items, main, carb,
      products: items.map(i => i.product.id),
      produce: items.filter(i => ["vegetable", "fruit"].includes(i.product.group)).map(i => i.product.id),
      nutrition, cost,
    });
  };
  const it = (p, grams) => (p ? { product: p, grams } : null);
  const protein = (p, mealType) => it(p, proteinGrams(p, densities.get(p.id), proteinTarget, MEAL_SHARE[mealType]));
  const vegPairs = mealType => rotatingPairs(of(["vegetable"], mealType).slice(0, MAX_VEG));
  const coffee = of(["coffee", "tea"], "Breakfast")[0];
  const milk = of(["milk", "plant_milk"], "Breakfast");
  // coffee beside a food breakfast (with milk when there is milk)
  const withCoffee = parts => (coffee ? [...parts, it(coffee, PORTION[coffee.group]), milk[0] && it(milk[0], 100)] : parts);

  // ── Breakfast
  const breads = of(["bread"], "Breakfast");
  const vegB = vegPairs("Breakfast");
  for (const bread of breads.length ? breads : [null]) {
    for (const p of of(["dairy_protein", "legumes"], "Breakfast")) {
      for (const veg of vegB.length ? vegB : [[]]) {
        if (bread) add("Breakfast", "bread", withCoffee([protein(p, "Breakfast"), it(bread, PORTION.bread), ...veg.map(v => it(v, PORTION.vegetable))]), { main: p, carb: bread, style: `bread:${p.id}` });
      }
    }
    for (const p of of(["eggs"], "Breakfast")) {
      for (const veg of vegB.length ? vegB : [[]]) {
        add("Breakfast", "eggs", withCoffee([protein(p, "Breakfast"), bread && it(bread, 80), ...veg.map(v => it(v, PORTION.vegetable))]), { main: p, carb: bread, style: `eggs:${p.id}` });
      }
    }
    for (const p of of(["fish"], "Breakfast")) {
      for (const veg of vegB.length ? vegB : [[]]) {
        if (bread) add("Breakfast", "tuna", withCoffee([protein(p, "Breakfast"), it(bread, PORTION.bread), ...veg.map(v => it(v, PORTION.vegetable))]), { main: p, carb: bread, style: `tuna:${p.id}` });
      }
    }
  }
  for (const avocado of of(["avocado"], "Breakfast")) {
    for (const p of of(["dairy_protein"], "Breakfast")) {
      for (const veg of vegB.length ? vegB : [[]]) {
        add("Breakfast", "cottage_avocado", withCoffee([protein(p, "Breakfast"), it(avocado, PORTION.avocado), breads[0] && it(breads[0], 60), ...veg.map(v => it(v, PORTION.vegetable))]),
          { main: p, carb: breads[0] || null, style: `avocado:${p.id}` });
      }
    }
  }
  const fruitsB = of(["fruit"], "Breakfast");
  for (const cereal of of(["cereal"], "Breakfast")) {
    for (const m of milk.length ? milk : of(["yogurt"], "Breakfast")) {
      for (const f of fruitsB.length ? fruitsB : [null]) {
        add("Breakfast", "cereal", withCoffee([it(cereal, PORTION.cereal), it(m, m.group === "yogurt" ? PORTION.yogurt : 200), f && it(f, 120)]),
          { main: m.group === "yogurt" ? m : null, carb: cereal, style: `cereal:${cereal.id}` });
      }
    }
  }
  for (const y of of(["yogurt"], "Breakfast")) {
    for (const f of fruitsB) {
      const extra = of(["nuts"], "Breakfast")[0] || of(["cereal"], "Breakfast")[0];
      add("Breakfast", "yogurt", withCoffee([protein(y, "Breakfast"), it(f, PORTION.fruit), extra && it(extra, extra.group === "nuts" ? 20 : 40)]),
        { main: y, style: `yogurt:${y.id}` });
    }
  }

  // ── Lunch and dinner plates
  for (const mealType of ["Lunch", "Dinner"]) {
    const vegs = vegPairs(mealType);
    const carbs = of(["grain", "starch_veg"], mealType);
    const fats = [null, ...of(["oil", "tahini"], mealType)];
    // meat / fish / legumes with a cooked carb (or bread at dinner)
    for (const p of of(["meat", "fish", "legumes"], mealType)) {
      for (const carb of [...carbs, ...(mealType === "Dinner" ? of(["bread"], mealType) : [])].concat(carbs.length ? [] : [null])) {
        for (const veg of vegs.length ? vegs : [[]]) {
          for (const fat of fats) {
            add(mealType, "plate", [protein(p, mealType), carb && it(carb, carb.group === "bread" ? 80 : PORTION[carb.group]), ...veg.map(v => it(v, PORTION.vegetable)), fat && it(fat, PORTION[fat.group])],
              { main: p, carb });
          }
        }
      }
    }
    // dairy / eggs plate with bread (shakshuka, omelette, cheese and salad)
    for (const p of of(["eggs", "dairy_protein", "yogurt"], mealType)) {
      for (const bread of of(["bread"], mealType).length ? of(["bread"], mealType) : [null]) {
        for (const veg of vegs.length ? vegs : [[]]) {
          add(mealType, "dairy_plate", [protein(p, mealType), bread && it(bread, 80), ...veg.map(v => it(v, PORTION.vegetable))], { main: p, carb: bread });
        }
      }
    }
    // no protein in the basket for this meal: a carb plate, so the day still has the meal
    if (!of(["meat", "fish", "legumes", "eggs", "dairy_protein", "yogurt"], mealType).length) {
      for (const carb of carbs) {
        for (const veg of vegs.length ? vegs : [[]]) add(mealType, "starch_plate", [it(carb, PORTION[carb.group]), ...veg.map(v => it(v, PORTION.vegetable))], { carb });
      }
    }
  }

  // ── Snacks
  const fruitsS = of(["fruit"], "Snacks");
  const nutsS = of(["nuts"], "Snacks");
  for (const f of fruitsS) {
    add("Snacks", "fruit", [it(f, PORTION.fruit)]);
    for (const n of nutsS) add("Snacks", "fruit_nuts", [it(f, 120), it(n, 25)]);
  }
  for (const y of of(["yogurt"], "Snacks")) {
    add("Snacks", "yogurt_snack", [it(y, PORTION.yogurt), fruitsS[0] && it(fruitsS[0], 100)], { main: y });
  }
  if (!fruitsS.length) for (const n of nutsS) add("Snacks", "nuts", [it(n, PORTION.nuts)]);

  return out;
}
