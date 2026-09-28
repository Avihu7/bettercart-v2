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

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

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

function catalogForPrompt(catalog) {
  return JSON.stringify(catalog.map(p => ({
    id: p.id,
    name_he: p.name_he,
    category: p.category,
    quantity: p.quantity,
    meal_roles: p.meal_roles,
    kosher: p.kosher,
    max_grams_per_meal: portionCap(p),
    list_totals: { calories: p.calories, protein: p.protein, carbs: p.carbs, fat: p.fat, price: p.price },
  })), null, 1);
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
- Snacks are real snack foods: fruit, nuts, yogurt, a small dairy item, or a small sandwich. NEVER as snacks: plain milk, plain bread, raw rice/pasta, chicken/meat/fish, cooking oil, tahini alone.
- Respect each product's "meal_roles" — place products only in the meal types listed for them.
- Never put a product with kosher "meat" and a product with kosher "dairy" in the same meal (e.g. chicken + cheese is NOT allowed). Dairy breakfast, meat lunch, dairy dinner is fine.
- Variety across the week: vary breakfasts, lunches and dinners; do not repeat the same meal_name more than twice. Rotate proteins (poultry, fish, tuna, eggs, cottage/cheese, legumes) — do not use the same protein source at more than 3 lunches.`;

const NAMING_RULES = `NAMING (strict):
- Every item MUST reference a catalog product: set "product_id" to its id and "food_name" to its exact "name_he", copied character-for-character.
- Never translate product names and never invent products that are not in the catalog.
- All text (meal_name, food_name) must be Hebrew. No English words and no transliterated English (write "מלפפון", never "קוקומבר").
- "meal_type" must be one of: Breakfast, Lunch, Dinner, Snacks (these keys stay in English).`;

function buildPlanPrompt({ catalog, profile, daysToGenerate }) {
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

PRODUCT CATALOG (the user's shopping list; list_totals are for the whole purchased quantity):
${catalogForPrompt(catalog)}

${MEAL_COMPOSITION_RULES}

${NAMING_RULES}

NUTRITION:
- FIRST AND FOREMOST: strictly follow all dietary restrictions above — skip any product that violates them.
- Each day has exactly 4 meals, in this order: Breakfast, Lunch, Dinner, Snacks.
- Match the daily calorie and protein targets as closely as possible — but with realistic single-person portions. Never exceed a product's max_grams_per_meal (e.g. bread ≤150g ≈ 4 slices, yellow cheese ≤100g, cottage ≤250g, cooked rice/pasta ≤300g, vegetables ≤300g). If the target is high, spread calories across all four meals rather than inflating one ingredient.
- grams = the edible amount as eaten (cooked weight for rice/pasta/legumes).
- Each item needs: product_id, food_name, grams, calories, protein, carbs, fat, estimated_cost (portion share of the product price).

Day names: ${DAY_NAMES.slice(0, daysToGenerate).join(", ")}.`;
}

function mealCalories(meal) {
  return meal.items.reduce((s, i) => s + (Number(i.calories) || 0), 0);
}

function buildRepairPrompt({ catalog, profile, plan, problems }) {
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

PRODUCT CATALOG:
${catalogForPrompt(catalog)}

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
export async function generateNutritionPlan({ list, profile }) {
  const daysToGenerate = Math.min(list.shopping_period_days || 7, 7);
  const catalog = buildProductCatalog(list.items);

  const raw = await invokeLLM({
    prompt: buildPlanPrompt({ catalog, profile, daysToGenerate }),
    response_json_schema: PLAN_SCHEMA,
  });

  // Demo responses aren't tied to the user's list — return them unchanged
  if (IS_DEMO_MODE) return raw;

  const plan = { days: raw.days || [] };
  const dropped = canonicalizePlan(plan, catalog);
  let problems = validatePlan(plan, catalog);
  const initialProblems = problems;

  if (problems.length) {
    console.warn("[nutrition plan] regenerating meals that break meal rules:", problems);
    const repair = await invokeLLM({
      prompt: buildRepairPrompt({ catalog, profile, plan, problems }),
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

  if (dropped.length) console.warn("[nutrition plan] dropped items not in shopping list:", dropped);
  if (problems.length) console.warn("[nutrition plan] remaining issues after repair:", problems);

  recomputeTotals(plan);
  return {
    ...plan,
    validation: {
      initial_issues: initialProblems.length,
      remaining_issues: problems,
      dropped_items: dropped,
    },
  };
}
