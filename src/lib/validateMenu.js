/**
 * Central menu validator — deterministic. One place that checks a built week
 * against everything the menu must respect, and grades it:
 *
 *   Level 1  varied, realistic, within budget, meets nutrition
 *   Level 2  within budget and meets nutrition, but limited variety
 *   Level 3  misses nutrition targets or the budget
 *   Level 4  no reasonable menu: the basket lacks key food groups, or a
 *            safety / realism rule is broken
 *
 * Checks (each { id, area, ok, limited?, message, data }):
 *   safety     products exist in the basket, no non-food, no allergens or
 *              diet violations (vegetarian/vegan), no meat with dairy
 *   realism    meal rules (roles, one main protein, portions), 3+ meals a day
 *   nutrition  calories ±5%, protein ≥90%, fat 75–115% (carbs ±25%: reported, not graded)
 *   budget     menu cost = final list cost, cost ≤ budget
 *   variety    lunch protein ≤3, no protein over half the main meals, protein
 *              sources, breakfast styles, carb / vegetable / fruit rotation,
 *              the same meal moved between meal types, one food all week —
 *              each judged against what the basket offers: a repeat the basket
 *              cannot avoid is "limited" (level 2), not a planner failure
 *   coverage   the basket has a main-meal protein, a carb and vegetables
 */
import { buildProductCatalog, validatePlan, classifyProduct } from "@/lib/mealPlanRules";
import { buildFinalShoppingList } from "@/lib/shoppingOptimizer";
import { profileConflict, isSupplement, isDisliked } from "@/lib/basketAlternatives";
import { isNonFoodName } from "@/lib/nonFood";
import { PRODUCT_USE_MAX } from "@/lib/mealScoring";

const MAIN_PROTEIN = new Set(["meat", "fish", "legumes", "eggs", "dairy_protein", "yogurt"]);
const CARB_SIDE = new Set(["grain", "starch_veg", "bread"]);
const MEAT_KOSHER = new Set(["meat"]);
const DAIRY_KOSHER = new Set(["dairy_protein", "yogurt", "milk"]);
const VARIETY_RULE = /used at more than 3 lunches/;
const round1 = n => Math.round(n * 10) / 10;

// The breakfast "style": what the meal is built around (its main food + its base)
function breakfastStyle(meal) {
  const groups = meal.items.map(i => classifyProduct(i.food_name));
  if (groups.includes("cereal")) return "cereal";
  if (groups.includes("eggs")) return "eggs";
  if (groups.includes("yogurt") && !groups.includes("bread")) return "yogurt";
  const protein = meal.items.find(i => MAIN_PROTEIN.has(classifyProduct(i.food_name)));
  return groups.includes("bread") ? `bread:${protein?.food_name || "spread"}` : `other:${protein?.food_name || ""}`;
}

// The main protein of a meal: the first protein food on the plate
const mainProtein = meal => meal.items.find(i => MAIN_PROTEIN.has(classifyProduct(i.food_name)))?.food_name || null;

/** What the basket offers for each part of the week (after the profile filter). */
export function basketOffer(basketItems, profile) {
  const eatable = (basketItems || []).filter(i =>
    !profileConflict(i, profile) && !isSupplement(i) && !isDisliked(i.name, profile?.disliked_foods || []) && !isNonFoodName(i.name));
  const by = groups => eatable.filter(i => groups.includes(classifyProduct(i.name, i.category))).map(i => i.name);
  // protein foods allowed at lunch by the meal rules (meat, fish, legumes, eggs, cheese…)
  const lunchProteins = buildProductCatalog(eatable).filter(p => MAIN_PROTEIN.has(p.group) && p.meal_roles?.includes("Lunch")).map(p => p.name_he);
  const breakfastStyles = new Set();
  if (by(["cereal"]).length && (by(["milk", "plant_milk", "yogurt"]).length)) breakfastStyles.add("cereal");
  if (by(["eggs"]).length) breakfastStyles.add("eggs");
  if (by(["yogurt"]).length && by(["fruit"]).length) breakfastStyles.add("yogurt");
  // bread with a protein the meal rules allow at breakfast (cheese, cottage, tofu, canned tuna)
  const breakfastProteins = buildProductCatalog(eatable).filter(p => ["dairy_protein", "legumes", "fish"].includes(p.group) && p.meal_roles?.includes("Breakfast")).map(p => p.name_he);
  if (by(["bread"]).length) for (const p of breakfastProteins) breakfastStyles.add(`bread:${p}`);
  return {
    eatable: eatable.map(i => i.name),
    lunchProteins,
    mainProteins: by([...MAIN_PROTEIN]),
    carbs: by([...CARB_SIDE]),
    vegetables: by(["vegetable"]),
    fruits: by(["fruit"]),
    breakfastStyles: [...breakfastStyles],
    has: {
      eggs: by(["eggs"]).length > 0, yogurt: by(["yogurt"]).length > 0, cereal: by(["cereal"]).length > 0,
      legumes: by(["legumes"]).length > 0, fish: by(["fish"]).length > 0, meat: by(["meat"]).length > 0,
      cheese: by(["dairy_protein"]).length > 0, bread: by(["bread"]).length > 0,
    },
  };
}

/**
 * Validates a week. plan: { days, estimated_weekly_cost }; basketItems: the
 * basket the menu was built from; budget: ₪ for the week (0/null = none).
 * Returns { level, checks, failed, limited, offer, stats }.
 */
export function validateMenu({ plan, basketItems, profile, budget = null }) {
  const days = plan?.days || [];
  const items = days.flatMap(d => d.meals.flatMap(m => m.items.map(i => ({ ...i, day: d.day_name, meal: m.meal_type }))));
  const basketNames = new Set((basketItems || []).map(i => i.name));
  const offer = basketOffer(basketItems, profile);
  const checks = [];
  const add = (id, area, ok, message, data = {}, limited = false) => checks.push({ id, area, ok, limited, message, data });

  // ── coverage: can this basket make a reasonable week at all?
  const missing = [];
  if (!offer.mainProteins.length) missing.push("protein");
  if (!offer.carbs.length) missing.push("carb");
  if (!offer.vegetables.length) missing.push("vegetable");
  // something to eat in the morning: a breakfast style, or at least bread or fruit
  if (!offer.breakfastStyles.length && !offer.has.bread && !offer.fruits.length) missing.push("breakfast");
  add("coverage", "coverage", missing.length === 0, "בסל יש חלבון, פחמימה וירקות לארוחות", { missing });

  // ── safety
  const invented = [...new Set(items.filter(i => !basketNames.has(i.food_name)).map(i => i.food_name))];
  add("products_exist", "safety", invented.length === 0, "כל המוצרים בתפריט קיימים בסל", { invented });
  const nonFood = [...new Set(items.filter(i => isNonFoodName(i.food_name)).map(i => i.food_name))];
  add("no_non_food", "safety", nonFood.length === 0, "אין בתפריט מוצרים שאינם מזון", { nonFood });
  const conflicts = [...new Set(items.filter(i => profileConflict({ name: i.food_name }, profile)).map(i => i.food_name))];
  add("profile_safe", "safety", conflicts.length === 0, "אין אלרגנים ואין הפרה של התזונה (צמחוני/טבעוני)", { conflicts });
  const meatWithDairy = days.flatMap(d => d.meals.filter(m => {
    const g = m.items.map(i => classifyProduct(i.food_name));
    return g.some(x => MEAT_KOSHER.has(x)) && g.some(x => DAIRY_KOSHER.has(x));
  }).map(m => `${d.day_name}/${m.meal_type}`));
  add("kosher_separation", "safety", meatWithDairy.length === 0, "אין בשר וחלב באותה ארוחה", { meals: meatWithDairy });

  // ── realism
  // (product ids are re-linked by name: the plan's ids come from the generator's own catalog)
  const catalog = buildProductCatalog(basketItems || []);
  const idByName = new Map(catalog.map(p => [p.name_he, p.id]));
  const linked = { days: days.map(d => ({ ...d, meals: d.meals.map(m => ({ ...m, items: m.items.map(i => ({ ...i, product_id: idByName.get(i.food_name) || i.product_id })) })) })) };
  const ruleProblems = days.length ? validatePlan(linked, catalog).flatMap(p => p.reasons.filter(r => !VARIETY_RULE.test(r))
    .map(r => `${days[p.dayIndex]?.day_name}/${days[p.dayIndex]?.meals[p.mealIndex]?.meal_type}: ${r}`)) : [];
  add("meal_rules", "realism", ruleProblems.length === 0, "כל הארוחות עומדות בחוקי הארוחה ובגודל מנה ריאלי", { problems: ruleProblems });
  const thinDays = days.filter(d => d.meals.length < 3).map(d => d.day_name);
  add("meals_per_day", "realism", days.length === 7 && thinDays.length === 0, "7 ימים, לפחות 3 ארוחות ביום", { thinDays, days: days.length });
  // Every day has its breakfast, lunch and dinner (snacks are optional)
  const missingSlots = days.flatMap(d => ["Breakfast", "Lunch", "Dinner"].filter(t => !d.meals.some(m => m.meal_type === t && m.items.length)).map(t => `${d.day_name}/${t}`));
  add("meal_slots", "realism", missingSlots.length === 0, "בכל יום יש ארוחת בוקר, צהריים וערב", { missing: missingSlots });

  // ── nutrition
  const kcalTarget = profile?.daily_calories, proteinTarget = profile?.protein_target;
  const fatTarget = profile?.fat_target, carbsTarget = profile?.carbs_target;
  const sum = (d, k) => d.meals.reduce((s, m) => s + m.items.reduce((t, i) => t + (Number(i[k]) || 0), 0), 0);
  const perDay = days.map(d => ({ day: d.day_name, kcal: Math.round(sum(d, "calories")), protein: round1(sum(d, "protein")), fat: round1(sum(d, "fat")), carbs: round1(sum(d, "carbs")) }));
  if (kcalTarget) {
    const off = perDay.filter(d => Math.abs(d.kcal - kcalTarget) / kcalTarget > 0.05);
    add("calories", "nutrition", off.length === 0, `קלוריות בטווח ±5% מהיעד (${kcalTarget}) בכל יום`, { off });
  }
  if (proteinTarget) {
    const low = perDay.filter(d => d.protein < proteinTarget * 0.9);
    add("protein", "nutrition", low.length === 0, `חלבון לפחות 90% מהיעד (${proteinTarget} ג׳) בכל יום`, { low });
  }
  if (fatTarget) {
    const off = perDay.filter(d => d.fat < fatTarget * 0.75 || d.fat > fatTarget * 1.15);
    add("fat", "nutrition", off.length === 0, `שומן בטווח 75–115% מהיעד (${fatTarget} ג׳)`, { off });
  }
  if (carbsTarget) {
    const off = perDay.filter(d => Math.abs(d.carbs - carbsTarget) / carbsTarget > 0.25);
    // reported, not graded: the balancing does not target carbs yet
    checks.push({ id: "carbs", area: "nutrition_info", ok: off.length === 0, limited: false, message: `פחמימות בטווח ±25% מהיעד (${carbsTarget} ג׳)`, data: { off } });
  }

  // ── budget
  const listCost = buildFinalShoppingList(basketItems || [], days).total_estimated_cost;
  const planCostSaved = Number(plan?.estimated_weekly_cost);
  add("cost_matches_list", "budget", !Number.isFinite(planCostSaved) || Math.abs(planCostSaved - listCost) < 0.05,
    "עלות התפריט שווה לעלות רשימת הקניות הסופית", { planCost: planCostSaved, listCost });
  if (budget > 0) {
    add("within_budget", "budget", listCost <= budget, `העלות השבועית (₪${listCost}) בתוך התקציב (₪${budget})`,
      { cost: listCost, budget, over: round1(Math.max(0, listCost - budget)) });
  }

  // ── variety (judged against what the basket offers)
  const lunches = days.map(d => d.meals.find(m => m.meal_type === "Lunch")).filter(Boolean);
  const mains = days.flatMap(d => d.meals.filter(m => m.meal_type === "Lunch" || m.meal_type === "Dinner"));
  const count = list => list.filter(Boolean).reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
  const lunchUse = count(lunches.map(mainProtein));
  const overLunch = [...lunchUse].filter(([, n]) => n > 3).map(([p, n]) => ({ product: p, lunches: n }));
  // 7 lunches with each protein in at most 3 needs at least 3 lunch proteins
  const lunchAlternatives = offer.lunchProteins.length >= 3;
  add("lunch_protein_repeat", "variety", overLunch.length === 0 || !lunchAlternatives,
    "אותו חלבון עיקרי לא ביותר מ-3 ארוחות צהריים", { overLunch, alternatives: offer.lunchProteins.length }, overLunch.length > 0 && !lunchAlternatives);

  const mainUse = count(mains.map(mainProtein));
  const dominant = [...mainUse].filter(([, n]) => n > mains.length / 2).map(([p, n]) => ({ product: p, meals: n, of: mains.length }));
  const proteinAlternatives = offer.mainProteins.length >= 2;
  add("protein_dominance", "variety", dominant.length === 0 || !proteinAlternatives,
    "אף מקור חלבון לא בחצי מהארוחות העיקריות או יותר", { dominant }, dominant.length > 0 && !proteinAlternatives);

  const usedProteins = new Set([...mainUse.keys()]).size;
  const wantProteins = Math.min(3, offer.mainProteins.length);
  add("protein_sources", "variety", usedProteins >= wantProteins, `לפחות ${wantProteins} מקורות חלבון בשבוע`,
    { used: usedProteins, available: offer.mainProteins.length }, offer.mainProteins.length < 3 && usedProteins >= wantProteins);

  const styles = count(days.map(d => d.meals.find(m => m.meal_type === "Breakfast")).filter(Boolean).map(breakfastStyle));
  const wantStyles = Math.min(2, offer.breakfastStyles.length);
  const sameEveryDay = styles.size === 1 && [...styles.values()][0] >= 7;
  add("breakfast_variety", "variety", styles.size >= wantStyles && !(sameEveryDay && offer.breakfastStyles.length >= 2),
    "ארוחת הבוקר לא אותה ארוחה כל יום", { styles: Object.fromEntries(styles), available: offer.breakfastStyles }, offer.breakfastStyles.length < 2 && styles.size <= 1);

  const used = groups => new Set(mains.flatMap(m => m.items).filter(i => groups.has(classifyProduct(i.food_name))).map(i => i.food_name)).size;
  const usedAll = groups => new Set(items.filter(i => groups.has(classifyProduct(i.food_name))).map(i => i.food_name)).size;
  const rotation = (id, message, n, available, want) => {
    const w = Math.min(want, available);
    add(id, "variety", n >= w, message, { used: n, available }, available < want && n >= w);
  };
  rotation("carb_rotation", "פחמימות מתחלפות בארוחות העיקריות", used(CARB_SIDE), offer.carbs.length, 2);
  rotation("vegetable_rotation", "ירקות מתחלפים במהלך השבוע", usedAll(new Set(["vegetable"])), offer.vegetables.length, 3);
  rotation("fruit_rotation", "פירות מתחלפים במהלך השבוע", usedAll(new Set(["fruit"])), offer.fruits.length, 2);

  // Meals that are really the same meal: the same main protein with the same carb,
  // whatever the vegetables and whether lunch or dinner. With enough combinations
  // in the basket, none should fill more than 3 of the 14 main meals.
  const sig = m => `${mainProtein(m) || "-"}|${m.items.find(i => CARB_SIDE.has(classifyProduct(i.food_name)))?.food_name || "-"}`;
  const sigUse = count(mains.map(sig));
  const repeated = [...sigUse].filter(([, n]) => n > 3).map(([meal, n]) => ({ meal, times: n }));
  const combos = Math.max(1, offer.mainProteins.length) * Math.max(1, offer.carbs.length);
  add("meal_repeat", "variety", repeated.length === 0 || combos < 5, "אותה ארוחה (אותו חלבון ואותה פחמימה) לא יותר מ-3 פעמים בשבוע",
    { repeated, distinct: sigUse.size, of: mains.length, combos }, repeated.length > 0 && combos < 5);

  // The same meal moved between breakfast, lunch and dinner is no variety: the
  // same core (main protein + carb) served under more than one meal type more
  // than 4 times a week, or twice in one day
  const allMains = days.flatMap(d => d.meals.filter(m => m.meal_type !== "Snacks").map(m => ({ ...m, day: d.day_name })));
  const coreOf = m => mainProtein(m) && sig(m);
  const coreUse = count(allMains.map(coreOf));
  const coreTypes = new Map();
  for (const m of allMains) if (coreOf(m)) coreTypes.set(coreOf(m), (coreTypes.get(coreOf(m)) || new Set()).add(m.meal_type));
  const crossMeal = [...coreUse].filter(([k, n]) => coreTypes.get(k).size > 1 && n > 4).map(([meal, n]) => ({ meal, times: n, mealTypes: [...coreTypes.get(meal)] }));
  const sameDayCore = days.flatMap(d => [...count(allMains.filter(m => m.day === d.day_name).map(coreOf))].filter(([, n]) => n > 1).map(([meal]) => ({ day: d.day_name, meal })));
  const coreAlternatives = offer.mainProteins.length >= 3 && offer.carbs.length >= 2;
  const crossBad = crossMeal.length > 0 || sameDayCore.length > 0;
  add("cross_meal_repeat", "variety", !crossBad || !coreAlternatives,
    "אותה ארוחה לא חוזרת בבוקר, בצהריים ובערב", { crossMeal, sameDayCore }, crossBad && !coreAlternatives);

  // One core food (a meal's protein or its carb) in more than half of the 21 main meals
  const foodUse = count(allMains.flatMap(m => [...new Set(m.items.filter(i => MAIN_PROTEIN.has(classifyProduct(i.food_name)) || CARB_SIDE.has(classifyProduct(i.food_name))).map(i => i.food_name))]));
  const overused = [...foodUse].filter(([, n]) => n > PRODUCT_USE_MAX).map(([product, n]) => ({
    product, meals: n, of: allMains.length,
    // other foods of its kind in the basket (another carb for bread, another protein for cheese)
    alternatives: (CARB_SIDE.has(classifyProduct(product)) ? offer.carbs : offer.mainProteins).filter(x => x !== product).length,
  }));
  const overusedAvoidable = overused.filter(o => o.alternatives >= 3);
  add("product_repeat", "variety", overusedAvoidable.length === 0,
    `אף מוצר לא מופיע ביותר מ-${PRODUCT_USE_MAX} מתוך הארוחות העיקריות בשבוע`, { overused }, overused.length > 0 && overusedAvoidable.length === 0);

  // Diversity score 0..1 (for comparing weeks): distinct main meals, breakfasts,
  // proteins, carbs and produce, each against what the basket allows
  const ratio = (n, max) => (max > 0 ? Math.min(1, n / max) : 1);
  const breakfastSigs = new Set(days.map(d => d.meals.find(m => m.meal_type === "Breakfast")).filter(Boolean)
    .map(m => m.items.filter(i => !CARB_SIDE.has(classifyProduct(i.food_name)) || classifyProduct(i.food_name) === "bread").map(i => classifyProduct(i.food_name) === "vegetable" ? "" : i.food_name).sort().join("+"))).size;
  const diversity = Math.round((
    ratio(sigUse.size, Math.min(mains.length, combos)) * 3 +
    ratio(breakfastSigs, Math.min(7, Math.max(1, offer.breakfastStyles.length * Math.max(1, offer.carbs.length)))) * 2 +
    ratio(usedProteins, Math.min(6, offer.mainProteins.length)) * 2 +
    ratio(used(CARB_SIDE), Math.min(4, offer.carbs.length)) +
    ratio(usedAll(new Set(["vegetable"])), Math.min(6, offer.vegetables.length)) +
    ratio(usedAll(new Set(["fruit"])), Math.min(3, offer.fruits.length))) / 10 * 100) / 100;

  // ── level
  const failed = checks.filter(c => !c.ok && c.area !== "nutrition_info");
  const fails = area => failed.some(c => c.area === area);
  const limited = checks.filter(c => c.ok && c.limited);
  const level = fails("coverage") || fails("safety") || fails("realism") ? 4
    : fails("nutrition") || fails("budget") ? 3
      : fails("variety") || limited.length ? 2
        : 1;
  return {
    level,
    checks,
    failed: failed.map(c => c.id),
    limited: limited.map(c => c.id),
    offer,
    stats: { perDay, cost: listCost, budget, diversity, lunchProteins: Object.fromEntries(lunchUse), mainProteins: Object.fromEntries(mainUse) },
  };
}
