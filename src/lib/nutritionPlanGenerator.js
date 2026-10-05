/**
 * Nutrition-plan generation: prompt construction, AI call, validation and repair.
 *
 * The AI receives the shopping list as a catalog of products with IDs, exact
 * Hebrew names and allowed meal roles, and must reference products by ID.
 * Afterwards every item is mapped back to its exact Hebrew shopping-list name,
 * and meals that break the meal-role rules are regenerated once.
 */

import { invokeLLM, IS_DEMO_MODE } from '@/lib/ai';
import {
  MEAL_TYPES, buildProductCatalog, canonicalizePlan, validatePlan,
  forceRepair, recomputeTotals, portionCap,
} from '@/lib/mealPlanRules';
import { buildDensities, applyDensities, finalizeDays, closeCalories } from '@/lib/mealPlanCalories';
import { WEEK_DAYS } from '@/lib/weekDays';

// Israeli week: Sunday is day 1
const DAY_NAMES = WEEK_DAYS.map(d => d.key);

// Share of the daily calorie target per meal
const MEAL_SHARE = { Breakfast: 0.25, Lunch: 0.35, Dinner: 0.27, Snacks: 0.13 };

const ITEM_SCHEMA = {
  type: "object",
  properties: {
    product_id: { type: "string", description: "ID of the product from the catalog (e.g. \"p3\")" },
    food_name: { type: "string", description: "The product's exact name_he from the catalog — never translated" },
    grams: { type: "number" },
    calories: { type: "number" },
    protein: { type: "number" },
    carbs: { type: "number" },
    fat: { type: "number" },
    estimated_cost: { type: "number" },
  },
};

const MEAL_SCHEMA = {
  type: "object",
  properties: {
    meal_type: { type: "string", enum: MEAL_TYPES },
    meal_name: { type: "string", description: "Human-readable Hebrew dish name, e.g. \"חזה עוף עם אורז, סלט ירקות וטחינה\"" },
    items: { type: "array", items: ITEM_SCHEMA },
  },
};

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    days: {
      type: "array",
      items: {
        type: "object",
        properties: {
          day_name: { type: "string" },
          meals: { type: "array", items: MEAL_SCHEMA },
        },
      },
    },
  },
};

function catalogForPrompt(catalog, densities) {
  const r = n => (n == null ? null : Math.round(n * 10) / 10);
  return JSON.stringify(catalog.map(p => {
    const d = densities?.get(p.id);
    return {
      id: p.id,
      name_he: p.name_he,
      category: p.category,
      quantity: p.quantity,
      meal_roles: p.meal_roles,
      kosher: p.kosher,
      max_grams_per_meal: portionCap(p),
      per_100g: d
        ? { calories: r(d.kcal), protein: r(d.protein), carbs: r(d.carbs), fat: r(d.fat) }
        : { list_totals: { calories: p.calories, protein: p.protein, carbs: p.carbs, fat: p.fat } },
    };
  }), null, 1);
}

function calorieRules(profile) {
  const target = profile?.daily_calories || 2000;
  const budget = Object.entries(MEAL_SHARE).map(([m, f]) => `${m} ≈ ${Math.round(target * f)} kcal`).join(", ");
  return `CALORIES (the primary constraint):
- The daily calorie target is ${target} kcal. Every day's total must be within ±5% (${Math.round(target * 0.95)}–${Math.round(target * 1.05)} kcal) — falling short is as wrong as exceeding it.
- Per-meal budget: ${budget}.
- Size portions from per_100g: item calories = grams × per_100g.calories / 100. Add up each day before answering.
- Calories come first. Within that range, protein is the next priority (see PROTEIN).
${proteinRules(profile)}`;
}

function proteinRules(profile) {
  const protein = profile?.protein_target;
  if (!protein) return "";
  const carbs = profile?.carbs_target;
  const fat = profile?.fat_target;
  const budget = Object.entries(MEAL_SHARE).map(([m, f]) => `${m} ≈ ${Math.round(protein * f)}g`).join(", ");
  return `PROTEIN:
- Daily protein target: ${protein}g. Aim for 90–110% of it every day (${Math.round(protein * 0.9)}–${Math.round(protein * 1.1)}g), using per_100g.protein to compute it.
- Per-meal protein budget: ${budget}. Every main meal and breakfast needs a real protein source from the catalog (fish, poultry, eggs, cottage/cheese/yogurt, tuna, legumes) in a meaningful portion.
- Once protein is in range, do not add more protein foods to reach calories.${fat ? `
- Fat: about ${fat}g per day (at most ${Math.round(fat * 1.15)}g). Keep oil, tahini, nuts and yellow cheese to modest amounts.` : ""}${carbs ? `
- Carbs supply the remaining energy: about ${carbs}g per day. Reach the calorie target mainly with carbohydrate sides spread over the meals (bread at breakfast/dinner, rice/pasta/potatoes at lunch/dinner, fruit at breakfast/snacks).` : ""}
- Portions stay realistic (never above max_grams_per_meal).`;
}

function restrictionRules(profile) {
  const dietary = profile?.dietary_preferences || [];
  const allergies = profile?.allergies || [];
  const lines = [];
  if (dietary.includes("vegan") || dietary.includes("טבעוני")) {
    lines.push("- USER IS VEGAN: ABSOLUTELY NO meat, poultry, fish, dairy, eggs, honey, or any animal products. If the catalog contains non-vegan items, do NOT include them in the meal plan.");
  }
  if (dietary.includes("vegetarian") || dietary.includes("צמחוני")) {
    lines.push("- USER IS VEGETARIAN: NO meat, poultry, or fish.");
  }
  if (dietary.includes("kosher") || dietary.includes("כשר")) {
    lines.push("- USER KEEPS KOSHER: strictly separate meat and dairy — every meal is either meat-based or dairy-based, never both.");
  }
  if (allergies.length) lines.push(`- ALLERGIES (NEVER include): ${allergies.join(", ")}`);
  return lines.length ? `⚠️ CRITICAL DIETARY RESTRICTIONS - MUST BE STRICTLY FOLLOWED:\n${lines.join("\n")}` : "";
}

const MEAL_COMPOSITION_RULES = `HOW TO BUILD THE MEALS (most important):
- The plan must resemble realistic meals eaten by humans. Do not simply combine foods because their macros fit. Create recognizable, culturally plausible meals using the available shopping-list products.
- Use a modern Israeli/Mediterranean eating style unless the user's preferences specify otherwise.
- Use the user's available products intelligently: bread belongs naturally in breakfasts/sandwiches, milk naturally with coffee or cereal, coffee naturally in breakfast, nuts and fruit naturally as snacks.
- Every meal gets a "meal_name": a short, natural Hebrew dish name describing the plate, mentioning only products that are actually in that meal's items (e.g. "חזה עוף עם אורז, סלט ירקות וטחינה", "חביתה עם לחם וסלט", "קורנפלקס עם חלב ובננה + קפה"). The items list underneath holds the ingredient quantities.
- Main meals (lunch, dinner) are a composed plate: a protein + a carbohydrate and/or vegetables + optionally a healthy fat/condiment (olive oil, tahini).
- Breakfast is a recognizable Israeli breakfast, e.g. bread + cottage/cheese + vegetables + coffee with milk; an omelette with bread and salad; yogurt with fruit and nuts; cornflakes with milk and banana. Only use products that exist in the catalog.
- Coffee (if in the catalog) appears naturally, usually at breakfast (optionally a daytime snack), as a drink next to food — never as a meal by itself and never at dinner. If both coffee and milk exist, serve coffee with milk.
- Milk is used as an ingredient/drink: in coffee, with cereal, or as a breakfast beverage alongside food — never as a snack by itself.
- Snacks are real snack foods: fruit, nuts, yogurt, a small dairy item, or a small sandwich. NEVER as snacks: plain milk, plain bread, raw rice/pasta, chicken/meat/fish, cooking oil, tahini alone, avocado (avocado goes on bread at breakfast or in a salad at lunch/dinner, about half an avocado).
- Respect each product's "meal_roles" — place products only in the meal types listed for them.
- Never put a product with kosher "meat" and a product with kosher "dairy" in the same meal (e.g. chicken + cheese is NOT allowed). Dairy breakfast, meat lunch, dairy dinner is fine.
- One main protein per plate: never two meats/fish in the same meal, and never meat/poultry together with fish (e.g. chicken + fish fillet is NOT allowed). Fill the plate with a carb side and vegetables instead.
- Variety across the week: vary breakfasts, lunches and dinners; do not repeat the same meal_name more than twice. Rotate proteins (poultry, fish, tuna, eggs, cottage/cheese, legumes) — do not use the same protein source at more than 3 lunches.`;

const NAMING_RULES = `NAMING (strict):
- Every item MUST reference a catalog product: set "product_id" to its id and "food_name" to its exact "name_he", copied character-for-character.
- Never translate product names and never invent products that are not in the catalog.
- All text (meal_name, food_name) must be Hebrew. No English words and no transliterated English (write "מלפפון", never "קוקומבר").
- "meal_type" must be one of: Breakfast, Lunch, Dinner, Snacks (these keys stay in English).`;

function buildPlanPrompt({ catalog, densities, profile, daysToGenerate }) {
  const dietary = profile?.dietary_preferences || [];
  const allergies = profile?.allergies || [];
  return `You are a nutrition meal plan generator for an Israeli user. Create a ${daysToGenerate}-day meal plan using ONLY the products in the catalog below.

${restrictionRules(profile)}

USER PROFILE:
- Daily calories target: ${profile?.daily_calories || 2000}
- Protein target: ${profile?.protein_target || 150}g/day
- Carbs target: ${profile?.carbs_target || 200}g/day
- Fat target: ${profile?.fat_target || 67}g/day
- Goal: ${profile?.goal || "maintenance"}
- Dietary preferences: ${dietary.join(", ") || "None"}
- Favorite foods: ${(profile?.favorite_foods || []).join(", ") || "None"}
- Disliked foods: ${(profile?.disliked_foods || []).join(", ") || "None"}
- Allergies: ${allergies.join(", ") || "None"}

PRODUCT CATALOG (the user's shopping list; per_100g is nutrition per 100g as eaten):
${catalogForPrompt(catalog, densities)}

${calorieRules(profile)}

${MEAL_COMPOSITION_RULES}

${NAMING_RULES}

NUTRITION:
- FIRST AND FOREMOST: strictly follow all dietary restrictions above — skip any product that violates them.
- Each day has exactly 4 meals, in this order: Breakfast, Lunch, Dinner, Snacks.
- Use realistic single-person portions. Never exceed a product's max_grams_per_meal (e.g. bread ≤150g ≈ 4 slices, yellow cheese ≤100g, cottage ≤250g, cooked rice/pasta ≤300g, vegetables ≤300g). If the target is high, spread calories across all four meals rather than inflating one ingredient.
- grams = the edible amount as eaten (cooked weight for rice/pasta/legumes).
- Each item needs: product_id, food_name, grams, calories, protein, carbs, fat, estimated_cost (portion share of the product price).

Day names: ${DAY_NAMES.slice(0, daysToGenerate).join(", ")}.`;
}

function mealCalories(meal) {
  return meal.items.reduce((s, i) => s + (Number(i.calories) || 0), 0);
}

function buildRepairPrompt({ catalog, densities, profile, plan, problems }) {
  const dailyTarget = profile?.daily_calories || 2000;
  const lunchProteinUse = {};
  for (const day of plan.days) {
    const lunch = day.meals.find(m => m.meal_type === "Lunch");
    const main = lunch?.items.map(i => catalog.find(p => p.id === i.product_id))
      .find(p => p && ["meat", "fish", "eggs", "dairy_protein", "legumes"].includes(p.group));
    if (main) lunchProteinUse[main.name_he] = (lunchProteinUse[main.name_he] || 0) + 1;
  }
  const bad = problems.map(({ dayIndex, mealIndex, reasons }) => {
    const day = plan.days[dayIndex];
    const meal = day.meals[mealIndex];
    const others = day.meals.reduce((s, m, i) => (i === mealIndex ? s : s + mealCalories(m)), 0);
    const target = Math.round(Math.min(1300, Math.max(meal.meal_type === "Snacks" ? 150 : 350, dailyTarget - others)));
    return {
      day_index: dayIndex,
      meal_index: mealIndex,
      day_name: day.day_name,
      meal_type: meal.meal_type,
      current_meal: { meal_name: meal.meal_name, items: meal.items.map(i => i.food_name) },
      problems: reasons,
      target_calories: target,
      other_meals_that_day: day.meals.filter((_, i) => i !== mealIndex).map(m => m.meal_name),
    };
  });
  return `You are fixing individual meals in an Israeli meal plan (meal plan repair). Replace each meal below with a new, realistic meal of the same meal_type that fixes the listed problems, close to its target_calories, using ONLY catalog products and realistic portions (never above max_grams_per_meal).

${restrictionRules(profile)}

Daily targets: ${profile?.daily_calories || 2000} kcal, ${profile?.protein_target || 150}g protein.

PRODUCT CATALOG (per_100g is nutrition per 100g as eaten):
${catalogForPrompt(catalog, densities)}

MEALS TO REPLACE:
${JSON.stringify(bad, null, 1)}

Current lunch protein usage across the week (a replacement lunch must not push any product above 3): ${JSON.stringify(lunchProteinUse)}

${MEAL_COMPOSITION_RULES}

${NAMING_RULES}

Return one replacement per meal, keeping day_index and meal_index.`;
}

const REPAIR_SCHEMA = {
  type: "object",
  properties: {
    replacements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          day_index: { type: "number" },
          meal_index: { type: "number" },
          meal: MEAL_SCHEMA,
        },
      },
    },
  },
};

/**
 * Generates a validated nutrition plan for a shopping list.
 * Returns { days, weekly_calories, estimated_weekly_cost, validation }.
 */
const PLAIN_WATER = /^\s*(מים|מי ברז|מי מעיין|סודה|מים מוגזים|מי סודה|מי עדן|נביעות|מי נביעות|נביעות טבעיות)(?![א-ת])/;
const isPlainWater = name => PLAIN_WATER.test(String(name || ""));

export const PLAN_FAILED_MESSAGE = "לא הצלחנו ליצור את התפריט כרגע. נסו שוב.";
const RETRY_NOTE = "\n\nIMPORTANT: return exactly 7 days (Sunday to Saturday), each with Breakfast, Lunch, Dinner and Snacks meals that have items. Top-level JSON object: {\"days\": [...]}.";

/**
 * The plan's days from the AI answer. Besides the expected {"days": [...]},
 * accepts only the shape actually observed from the model: the data wrapped
 * like the schema, {"type": "object", "properties": {"days": [...]}}.
 */
export function planDays(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  if (Array.isArray(raw.days)) return raw.days;
  if (raw.type === "object" && Array.isArray(raw.properties?.days)) return raw.properties.days;
  return [];
}

/** True for at least 7 days, each with meals that all contain items. */
export function isCompleteWeek(days) {
  return Array.isArray(days) && days.length >= 7 && days.slice(0, 7).every(d =>
    Array.isArray(d?.meals) && d.meals.length >= 3 &&
    d.meals.every(m => Array.isArray(m?.items) && m.items.length > 0));
}

const describeAnswer = raw => raw == null ? "no JSON"
  : `keys: ${Object.keys(raw).join(", ") || "none"}, days: ${planDays(raw).length}`;

/** Hebrew notes for a day that misses a target, with its real numbers. */
function targetWarnings(report, { calories, protein, fat }) {
  const notes = [];
  const basketLimited = report.limits?.includes("protein limited by basket");
  for (const f of report.failures || []) {
    if (f.startsWith("calories")) notes.push(`קלוריות: ${report.after} — ${report.after > calories ? "מעל ה" : "מתחת ל"}יעד של ${calories}`);
    else if (f.startsWith("protein") && report.protein > protein) notes.push(`חלבון: ${report.protein} גרם — מעל יעד של ${protein} גרם`);
    else if (f.startsWith("protein")) notes.push(`חלבון: ${report.protein} גרם — מתחת ליעד של ${protein} גרם`);
    else if (f.startsWith("fat")) notes.push(`שומן: ${report.fat} גרם — ${report.fat > fat ? "מעל ה" : "מתחת ל"}יעד של ${fat} גרם`);
  }
  if (basketLimited) notes.push(`חלבון: ${report.protein} גרם — מתחת ליעד של ${protein} גרם, כי מקורות החלבון שבסל לא מספיקים בתוך יעד הקלוריות`);
  return notes;
}

/**
 * Generates one day again (for a day the closure pass could not bring within
 * ±3%) and runs it through the same repair and balancing. Returns
 * { day, report } when the new day is within range, otherwise null.
 */
async function regenerateDay({ dayIndex, catalog, densities, listDensities, profile, targets }) {
  let raw;
  try {
    raw = await invokeLLM({
      prompt: buildPlanPrompt({ catalog, densities: listDensities, profile, daysToGenerate: 1 }),
      response_json_schema: PLAN_SCHEMA,
    });
  } catch (err) {
    if (err.status) throw err;
    return null;
  }
  const days = planDays(raw);
  const one = days[0];
  if (!one || !Array.isArray(one.meals) || one.meals.length < 3 || !one.meals.every(m => Array.isArray(m?.items) && m.items.length)) return null;
  const single = { days: [{ ...one, day_name: DAY_NAMES[dayIndex] }] };
  canonicalizePlan(single, catalog);
  forceRepair(single, catalog);
  applyDensities(single, densities);
  finalizeDays(single, catalog, densities, targets);
  const [report] = closeCalories(single, catalog, densities, targets);
  return report.ok ? { day: single.days[0], report } : null;
}

export async function generateNutritionPlan({ list, profile }) {
  // The plan is always a full Israeli week (Sunday → Saturday). The basket's
  // shopping_period_days is about how often the user shops (e.g. 30/6 = 5 days)
  // and must not shorten the weekly menu.
  const daysToGenerate = 7;
  const target = profile?.daily_calories || 2000;
  // Plain water adds nothing to a meal — it stays in the basket, not the menu
  const catalog = buildProductCatalog(list.items.filter(i => !isPlainWater(i.name)));
  // Per-100g values from the shopping list alone (before any AI output exists)
  const listDensities = buildDensities(catalog, { days: [] });

  const requestPlan = async retry => {
    try {
      return await invokeLLM({
        prompt: buildPlanPrompt({ catalog, densities: listDensities, profile, daysToGenerate }) + (retry ? RETRY_NOTE : ""),
        response_json_schema: PLAN_SCHEMA,
      });
    } catch (err) {
      // API errors (auth, billing, rate limit) are reported as they are;
      // a truncated or non-JSON answer counts as an invalid plan
      if (err.status) throw err;
      console.warn(`[nutrition plan] unreadable AI answer: ${err.message}`);
      return null;
    }
  };
  // A plan is only usable with 7 days that each have meals with items. One
  // regeneration, then an error — an empty or partial plan is never returned.
  let raw = await requestPlan(false);
  let days = planDays(raw);
  if (!IS_DEMO_MODE && !isCompleteWeek(days)) {
    console.warn(`[nutrition plan] invalid AI plan (${describeAnswer(raw)}), regenerating once`);
    raw = await requestPlan(true);
    days = planDays(raw);
  }
  if (!IS_DEMO_MODE && !isCompleteWeek(days)) {
    console.warn(`[nutrition plan] invalid AI plan after retry (${describeAnswer(raw)})`);
    throw new Error(PLAN_FAILED_MESSAGE);
  }

  // Demo responses aren't tied to the user's list — return them unchanged
  if (IS_DEMO_MODE) return raw;

  // Day names come from position (Sunday first), not from the AI's labels
  const plan = {
    days: days.slice(0, daysToGenerate).map((day, i) => ({ ...day, day_name: DAY_NAMES[i] })),
  };
  const dropped = canonicalizePlan(plan, catalog);
  let problems = validatePlan(plan, catalog);
  const initialProblems = problems;

  if (problems.length) {
    console.warn("[nutrition plan] regenerating meals that break meal rules:", problems);
    const repair = await invokeLLM({
      prompt: buildRepairPrompt({ catalog, densities: listDensities, profile, plan, problems }),
      response_json_schema: REPAIR_SCHEMA,
    });
    for (const r of repair.replacements || []) {
      const day = plan.days[r.day_index];
      if (!day?.meals[r.meal_index] || !r.meal) continue;
      const expectedType = day.meals[r.meal_index].meal_type;
      const candidate = { days: [{ meals: [{ ...r.meal, meal_type: expectedType }] }] };
      dropped.push(...canonicalizePlan(candidate, catalog));
      day.meals[r.meal_index] = candidate.days[0].meals[0];
    }
    forceRepair(plan, catalog);
    problems = validatePlan(plan, catalog);
  }

  // Calories come from the actual portions, then each day is balanced to the target
  const dailyCalories = () => plan.days.map(d => Math.round(d.meals.reduce((s, m) => s + m.items.reduce((t, i) => t + (Number(i.calories) || 0), 0), 0)));
  const aiDailyCalories = dailyCalories();
  const densities = buildDensities(catalog, plan);
  applyDensities(plan, densities);
  const itemDailyCalories = dailyCalories();
  // One deterministic pass per day: protein into range → excess fat down →
  // missing calories mostly from carbs (see finalizeDays)
  const targets = { calories: target, protein: profile?.protein_target, fat: profile?.fat_target };
  const balanced = finalizeDays(plan, catalog, densities, targets);
  // Calories are a hard constraint (±3%), together with protein 90–110%,
  // fat 85–115% and realistic portions
  let calories = closeCalories(plan, catalog, densities, targets);

  // A day that cannot meet all of them is generated again on its own (once)
  // instead of being forced. If it still cannot (the basket does not hold
  // enough of the right food), the best version of the day is kept and the
  // shortfall is written on the day, so the user still gets a menu and sees why.
  for (const report of calories.filter(r => !r.ok)) {
    const dayIndex = plan.days.findIndex(d => d.day_name === report.day);
    console.warn(`[nutrition plan] ${report.day}: ${report.failures.join(", ")} (${report.after} kcal, P${report.protein}, F${report.fat}) — regenerating the day`);
    const fresh = await regenerateDay({ dayIndex, catalog, densities, listDensities, profile, targets });
    if (fresh) {
      plan.days[dayIndex] = fresh.day;
      calories = calories.map(r => (r.day === report.day ? fresh.report : r));
    }
  }
  for (const report of calories) {
    const day = plan.days.find(d => d.day_name === report.day);
    const warnings = targetWarnings(report, targets);
    if (day && warnings.length) day.target_warnings = warnings;
  }
  if (calories.some(r => !r.ok)) {
    console.warn("[nutrition plan] saved with days below their targets:", calories.filter(r => !r.ok));
  }
  problems = validatePlan(plan, catalog);

  if (dropped.length) console.warn("[nutrition plan] dropped items not in shopping list:", dropped);
  if (problems.length) console.warn("[nutrition plan] remaining issues after repair:", problems);
  console.info("[nutrition plan] daily calories vs target:", calories);

  recomputeTotals(plan);
  return {
    ...plan,
    validation: {
      initial_issues: initialProblems.length,
      remaining_issues: problems,
      dropped_items: dropped,
      target_calories: target,
      ai_daily_calories: aiDailyCalories,
      item_daily_calories: itemDailyCalories,
      balanced,
      calories,
    },
  };
}
