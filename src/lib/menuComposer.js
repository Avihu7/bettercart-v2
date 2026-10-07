/**
 * Weekly menu composer — deterministic, no AI. The same basket and profile
 * always give the same menu.
 *
 * Builds the first draft of the week from the basket's products using fixed,
 * recognizable Israeli meal templates; portions are a starting point that
 * finalizeDays / closeCalories (src/lib/mealPlanCalories.js) then balance to
 * the calorie, protein and fat targets, and fitPlanToBudget to the budget.
 *
 *   Breakfast  bread + cheese/cottage + vegetables (+ coffee, avocado)
 *              | omelette (eggs) + bread + vegetables
 *              | cereal + milk + fruit
 *              | yogurt + fruit + nuts
 *   Lunch      protein (meat / fish / legumes) + carb + vegetables + oil/tahini
 *   Dinner     dairy / eggs / fish / legumes + bread or carb + vegetables
 *   Snacks     fruit, and nuts or yogurt every other day
 *
 * Every meal keeps the meal-role rules (src/lib/mealPlanRules.js): products
 * only in their meal slots, meat never with dairy, one main protein per plate,
 * milk only with coffee/tea/cereal, the same protein at most 3 lunches.
 * Variety: proteins, carbs, vegetables and fruit rotate through the week;
 * favorite foods first, then the cheaper protein per gram.
 */
import { dishWord, portionCap } from '@/lib/mealPlanRules';
import { profileConflict, isDisliked, isSupplement } from '@/lib/basketAlternatives';
import { WEEK_DAYS } from '@/lib/weekDays';

const DAY_NAMES = WEEK_DAYS.map(d => d.key);

// Share of the daily calories / protein per meal (as the balancing passes use)
export const MEAL_SHARE = { Breakfast: 0.25, Lunch: 0.35, Dinner: 0.27, Snacks: 0.13 };

// Starting portions (grams as eaten); balancing adjusts them to the targets
const PORTION = {
  bread: 100, cereal: 60, grain: 200, starch_veg: 250, vegetable: 120, fruit: 150, avocado: 70,
  nuts: 30, tahini: 20, oil: 10, coffee: 10, tea: 2, milk: 100, plant_milk: 100, yogurt: 150,
  dairy_protein: 150, eggs: 120, meat: 150, fish: 150, legumes: 200,
};
const MIN_PROTEIN_PORTION = { meat: 100, fish: 100, legumes: 120, eggs: 100, dairy_protein: 50, yogurt: 120 };
const HARD_CHEESE = /צהוב|מוצרלה|בולגרית|צפתית|פרמזן|עמק/;
const MAX_LUNCHES_PER_PROTEIN = 3;

// Breakfast rotation over the week (indices into the available templates)
const BREAKFAST_PATTERN = [0, 1, 0, 2, 3, 1, 0];

const isFavorite = (p, profile) => (profile?.favorite_foods || []).some(f => f && p.name_he.includes(f));
const byName = (a, b) => a.name_he.localeCompare(b.name_he, "he");

/** Products of these groups allowed in this meal, best first. */
function pool(catalog, groups, mealType, rank) {
  return catalog
    .filter(p => groups.includes(p.group) && p.meal_roles?.includes(mealType))
    .sort((a, b) => rank(a, b) || byName(a, b));
}

/**
 * Ranking for protein foods: favorites, then ₪ per gram of protein (cheaper
 * first, so the menu starts budget-friendly), then protein density.
 */
function proteinRank(densities, profile) {
  const costPerProtein = p => {
    const d = densities.get(p.id);
    return d?.pricePerGram && d.protein > 0 ? d.pricePerGram / d.protein : Infinity;
  };
  return (a, b) => Number(isFavorite(b, profile)) - Number(isFavorite(a, profile)) ||
    costPerProtein(a) - costPerProtein(b) ||
    (densities.get(b.id)?.protein || 0) - (densities.get(a.id)?.protein || 0);
}
const favoriteRank = profile => (a, b) => Number(isFavorite(b, profile)) - Number(isFavorite(a, profile));

/** Round-robin pick: the i-th product of a list, skipping the excluded ones. */
function nth(list, i, exclude = []) {
  const options = list.filter(p => !exclude.includes(p.id));
  return options.length ? options[i % options.length] : list.length ? list[i % list.length] : null;
}

/** Grams of a protein food that bring the meal its share of the protein target. */
function proteinGrams(p, densities, proteinTarget, share) {
  const d = densities.get(p.id);
  const base = p.group === "dairy_protein" && HARD_CHEESE.test(p.name_he) ? 50 : PORTION[p.group] || 150;
  const cap = portionCap(p) || base * 1.6;
  if (!proteinTarget || !(d?.protein > 0)) return Math.min(base, cap);
  const grams = proteinTarget * share / d.protein * 100;
  return Math.round(Math.min(cap, Math.max(MIN_PROTEIN_PORTION[p.group] || 50, Math.min(grams, base * 1.6))) / 5) * 5;
}

const item = (p, grams) => ({ product_id: p.id, food_name: p.name_he, grams });

// ─── Dish names (from the products in the meal) ─────────────────────────────

/** "X עם Y, Z ו-W" from the meal's food items (oil and milk in coffee are not named). */
function dishName(items, catalog, extra = "") {
  const named = items
    .map(i => catalog.find(p => p.id === i.product_id))
    .filter(p => p && !["oil", "milk", "plant_milk", "coffee", "tea"].includes(p.group));
  const words = [...new Set(named.map(p => dishWord(p.name_he)))];
  let name = words[0] || "";
  if (words.length === 2) name += ` עם ${words[1]}`;
  if (words.length > 2) name += ` עם ${words.slice(1, -1).join(", ")} ו${words.at(-1)}`;
  return extra ? `${name} ${extra}` : name;
}

// ─── Meals ───────────────────────────────────────────────────────────────────

function breakfastTemplates(P) {
  const t = [];
  // bread with cheese/cottage/tofu — or, without those, with tahini/avocado
  if (P.bread.length && (P.cheese.length || P.avocado.length || P.tahiniBreakfast.length)) t.push("bread");
  if (P.eggs.length) t.push("eggs");
  if (P.cereal.length && (P.milk.length || P.yogurt.length)) t.push("cereal");
  if (P.yogurt.length && P.fruit.length) t.push("yogurt");
  if (!t.length && P.bread.length) t.push("bread"); // bread and vegetables at least
  if (!t.length && P.fruit.length) t.push("yogurt"); // fruit (and nuts) at least
  return t;
}

function breakfast(day, P, ctx) {
  const { densities, proteinTarget, catalog } = ctx;
  const template = P.breakfastTemplates[BREAKFAST_PATTERN[day] % P.breakfastTemplates.length];
  const items = [];
  const share = MEAL_SHARE.Breakfast;
  let protein = null;
  if (template === "bread" || template === "eggs") {
    protein = template === "eggs" ? nth(P.eggs, day) : nth(P.cheese, day);
    const bread = nth(P.bread, day);
    if (protein) items.push(item(protein, proteinGrams(protein, densities, proteinTarget, share)));
    if (bread) items.push(item(bread, PORTION.bread));
    for (const v of [nth(P.vegBreakfast, day), nth(P.vegBreakfast, day + 1, [nth(P.vegBreakfast, day)?.id])]) {
      if (v && !items.some(i => i.product_id === v.id)) items.push(item(v, PORTION.vegetable));
    }
    if (template === "bread" && P.avocado.length && (day % 2 === 0 || !protein)) items.push(item(P.avocado[0], PORTION.avocado));
    else if (template === "bread" && !protein && P.tahiniBreakfast.length) items.push(item(P.tahiniBreakfast[0], PORTION.tahini));
  } else if (template === "cereal") {
    items.push(item(nth(P.cereal, day), PORTION.cereal));
    const milk = nth(P.milk, day);
    if (milk) items.push(item(milk, 200));
    else {
      protein = nth(P.yogurt, day);
      items.push(item(protein, PORTION.yogurt));
    }
    if (P.fruit.length) items.push(item(nth(P.fruit, day), 120));
  } else {
    protein = nth(P.yogurt, day);
    if (protein) items.push(item(protein, 200));
    if (P.fruit.length) items.push(item(nth(P.fruit, day), PORTION.fruit));
    if (P.nutsBreakfast.length) items.push(item(nth(P.nutsBreakfast, day), 20));
  }
  // Coffee (with milk when there is milk) beside a food breakfast
  if (P.coffee.length && items.length) {
    items.push(item(P.coffee[0], PORTION.coffee));
    const milk = P.milk[0];
    if (milk && !items.some(i => i.product_id === milk.id)) items.push(item(milk, PORTION.milk));
  }
  const coffee = P.coffee.length && items.length ? "+ קפה" : "";
  return { meal_type: "Breakfast", meal_name: dishName(items, catalog, coffee), items, protein };
}

function lunch(day, P, ctx, schedule) {
  const { densities, proteinTarget, catalog } = ctx;
  const items = [];
  const protein = schedule[day];
  if (protein) items.push(item(protein, proteinGrams(protein, densities, proteinTarget, MEAL_SHARE.Lunch)));
  const carb = nth(P.carbLunch, day);
  if (carb) items.push(item(carb, PORTION[carb.group]));
  const v1 = nth(P.vegMain, day);
  const v2 = nth(P.vegMain, day + 2, [v1?.id]);
  for (const v of [v1, v2]) if (v && !items.some(i => i.product_id === v.id)) items.push(item(v, PORTION.vegetable));
  const fat = nth(P.fatMain, day);
  if (fat) items.push(item(fat, PORTION[fat.group]));
  return { meal_type: "Lunch", meal_name: dishName(items, catalog), items, protein };
}

function dinner(day, P, ctx, avoid) {
  const { densities, proteinTarget, catalog } = ctx;
  const items = [];
  // A different protein from the day's breakfast and lunch, rotating
  const protein = nth(P.proteinDinner, day, avoid);
  if (protein) items.push(item(protein, proteinGrams(protein, densities, proteinTarget, MEAL_SHARE.Dinner)));
  // Bread with cheese/eggs; fish/legumes alternate bread (e.g. hummus with
  // bread) and a cooked carb; a cooked carb when there is no bread
  const wantsBread = protein && (["dairy_protein", "eggs", "yogurt"].includes(protein.group) || day % 2 === 1);
  const base = (wantsBread && nth(P.bread, day + 1)) || nth(P.carbDinner, day + 3) || nth(P.bread, day + 1);
  if (base) items.push(item(base, base.group === "bread" ? 80 : PORTION[base.group]));
  const v1 = nth(P.vegMain, day + 1);
  const v2 = nth(P.vegMain, day + 3, [v1?.id]);
  for (const v of [v1, v2]) if (v && !items.some(i => i.product_id === v.id)) items.push(item(v, PORTION.vegetable));
  const fat = nth(P.fatDinner, day + 1);
  if (fat && protein?.group !== "dairy_protein") items.push(item(fat, PORTION[fat.group]));
  return { meal_type: "Dinner", meal_name: dishName(items, catalog), items, protein };
}

function snacks(day, P, ctx, used) {
  const items = [];
  const fruit = nth(P.fruit, day + 2);
  if (fruit) items.push(item(fruit, PORTION.fruit));
  // Every other day a second snack: nuts, or a yogurt not eaten earlier that day
  if (day % 2 === 1 || !fruit) {
    const nuts = nth(P.nutsSnack, day);
    const yogurt = P.yogurtSnack.find(y => !used.includes(y.id));
    if (nuts) items.push(item(nuts, PORTION.nuts));
    else if (yogurt) items.push(item(yogurt, PORTION.yogurt));
  }
  return items.length ? { meal_type: "Snacks", meal_name: dishName(items, ctx.catalog), items } : null;
}

/** The week's lunch proteins: cheapest/favorite first, each at most 3 lunches, not two days running. */
function lunchSchedule(proteins) {
  const count = new Map();
  const schedule = [];
  for (let day = 0; day < 7; day++) {
    const prev = schedule[day - 1]?.id;
    const ok = p => (count.get(p.id) || 0) < MAX_LUNCHES_PER_PROTEIN;
    const pick = proteins.find(p => ok(p) && p.id !== prev) || proteins.find(ok) || proteins[day % Math.max(1, proteins.length)] || null;
    if (pick) count.set(pick.id, (count.get(pick.id) || 0) + 1);
    schedule.push(pick);
  }
  return schedule;
}

/**
 * The week's first draft: { days: [{ day_name, meals: [{ meal_type, meal_name, items }] }] }.
 * catalog: buildProductCatalog(basket items); densities: buildDensities(catalog, { days: [] }).
 * Products without nutrition values are not used.
 */
export function composeWeek({ catalog, densities, profile }) {
  // Only foods this user eats: the basket is already filtered, but a product
  // the user added by hand must still respect diet, allergies and dislikes
  const usable = catalog.filter(p => densities.get(p.id) && p.group !== "other" &&
    !profileConflict({ name: p.name_he, category: p.category }, profile) &&
    !isSupplement({ name: p.name_he }) &&
    !isDisliked(p.name_he, profile?.disliked_foods || [], p.group));
  const fav = favoriteRank(profile);
  const prot = proteinRank(densities, profile);
  const P = {
    bread: pool(usable, ["bread"], "Breakfast", fav),
    cereal: pool(usable, ["cereal"], "Breakfast", fav),
    // the protein beside bread at breakfast: cheese/cottage, or tofu (legumes allowed at breakfast)
    cheese: pool(usable, ["dairy_protein", "legumes"], "Breakfast", prot),
    tahiniBreakfast: pool(usable, ["tahini"], "Breakfast", fav),
    eggs: pool(usable, ["eggs"], "Breakfast", prot),
    yogurt: pool(usable, ["yogurt"], "Breakfast", prot),
    yogurtSnack: pool(usable, ["yogurt"], "Snacks", prot),
    milk: pool(usable, ["milk", "plant_milk"], "Breakfast", fav),
    coffee: pool(usable, ["coffee", "tea"], "Breakfast", fav),
    fruit: pool(usable, ["fruit"], "Snacks", fav),
    nutsBreakfast: pool(usable, ["nuts"], "Breakfast", fav),
    nutsSnack: pool(usable, ["nuts"], "Snacks", fav),
    avocado: pool(usable, ["avocado"], "Breakfast", fav),
    vegBreakfast: pool(usable, ["vegetable"], "Breakfast", fav),
    vegMain: pool(usable, ["vegetable"], "Lunch", fav),
    carbLunch: pool(usable, ["grain", "starch_veg"], "Lunch", fav),
    carbDinner: pool(usable, ["grain", "starch_veg"], "Dinner", fav),
    proteinLunch: pool(usable, ["meat", "fish", "legumes"], "Lunch", prot),
    proteinDinner: pool(usable, ["dairy_protein", "eggs", "fish", "legumes", "yogurt"], "Dinner", prot),
    // oil and tahini for lunch/dinner plates, oil first
    fatMain: pool(usable, ["oil", "tahini"], "Lunch", (a, b) => (a.group === "oil" ? 0 : 1) - (b.group === "oil" ? 0 : 1) || fav(a, b)),
    fatDinner: pool(usable, ["tahini", "oil"], "Dinner", (a, b) => (a.group === "tahini" ? 0 : 1) - (b.group === "tahini" ? 0 : 1) || fav(a, b)),
  };
  P.breakfastTemplates = breakfastTemplates(P);
  const ctx = { densities, proteinTarget: profile?.protein_target, catalog };
  const schedule = lunchSchedule(P.proteinLunch);

  const days = DAY_NAMES.map((day_name, day) => {
    const meals = [];
    const b = P.breakfastTemplates.length ? breakfast(day, P, ctx) : null;
    if (b?.items.length) meals.push(b);
    const l = lunch(day, P, ctx, schedule);
    if (l.items.length) meals.push(l);
    const d = dinner(day, P, ctx, [b?.protein?.id, l.protein?.id].filter(Boolean));
    if (d.items.length) meals.push(d);
    const s = snacks(day, P, ctx, meals.flatMap(m => m.items.map(i => i.product_id)));
    if (s) meals.push(s);
    // the protein references were only for composing
    return { day_name, meals: meals.map(({ protein, ...m }) => m) };
  });
  return { days };
}
