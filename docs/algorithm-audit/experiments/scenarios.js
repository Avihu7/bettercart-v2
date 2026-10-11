/**
 * EXPERIMENT ONLY. The fixed benchmark scenarios: a basket + the profile it is planned for.
 *
 * Sources (nothing is generated at run time, no network, no catalog lookups):
 *   tests/fixtures/baskets.js          the project's own test baskets (hand-built, Shufersal-like prices)
 *   tests/fixtures/qaRound4Basket.json a basket BetterCart built in manual QA round 4
 *   tests/fixtures/qaRound5State.json  the real profile + BetterCart-built basket of the QA account in round 5
 *   tests/fixtures/qaRound7State.json  the same account in round 7 (a control: its menu is over the budget)
 * Macro targets of the two profiles written here come from the app's own formula
 * (src/lib/calculations.js calculateMacros), not from numbers picked for the experiment.
 *
 * Scenario design used the PRODUCTION planner only (feasibilityCheck.mjs), by two rules fixed
 * before the comparison: S03 is the newest real weight-loss QA state whose production menu is
 * within its budget (round 7 and 6 are over, round 5 fits); S08's budget is the lowest monthly
 * budget, in ₪50 steps, at which the production menu of the economy basket is within budget.
 *
 * The weekly food budget of every scenario is weeklyBudget(profile) (src/lib/pricing.js):
 * no household reserve and no accepted override, as in the project's tests.
 */
import { calculateBMR, calculateDailyCalories, calculateMacros } from "@/lib/calculations";
import { ITEMS as I, BASKETS, BASE_PROFILE } from "../../../tests/fixtures/baskets";
import QA4_BASKET from "../../../tests/fixtures/qaRound4Basket.json";
import QA5 from "../../../tests/fixtures/qaRound5State.json";
import QA7 from "../../../tests/fixtures/qaRound7State.json";

/** A profile from body data, with the app's own calorie and macro formulas. */
function profileFrom({ weight, height, age, gender, activity, goal, strength, monthly_budget, ...rest }) {
  const daily_calories = calculateDailyCalories(calculateBMR(weight, height, age, gender), activity, goal);
  const m = calculateMacros(daily_calories, goal, weight, strength);
  return {
    weight, height, age, gender, activity_level: activity, goal, strength_training: strength,
    daily_calories, protein_target: m.protein, carbs_target: m.carbs, fat_target: m.fat,
    monthly_budget, purchases_per_month: 4, dietary_preferences: [], allergies: [], favorite_foods: [], disliked_foods: [],
    onboarding_complete: true, ...rest,
  };
}

const RICH = BASKETS.rich.items;
// Every product of the fixture catalog: 38 products, several of each kind
const ALL_ITEMS = Object.values(I);
// An everyday low-cost basket: cheap proteins and staples only
const ECONOMY = [I.chicken, I.eggs, I.lentils, I.chickpeas, I.cottage, I.yogurt, I.milk, I.rice, I.pasta, I.bread, I.oats, I.potato,
  I.tomato, I.cucumber, I.carrot, I.banana, I.apple, I.oil, I.tahini, I.coffee];

export const SCENARIOS = [
  { id: "S01-omnivore", title: "Standard omnivore", source: "tests/fixtures/baskets.js — rich (26 products), BASE_PROFILE",
    items: RICH, profile: BASE_PROFILE },
  { id: "S02-strength", title: "High-protein / strength training", source: "rich basket + turkey, white cheese, quinoa; profile from calculateMacros (85 kg, maintenance, strength 6-7)",
    items: [...RICH, I.turkey, I.whiteCheese, I.quinoa],
    profile: profileFrom({ weight: 85, height: 180, age: 28, gender: "male", activity: "moderately_active", goal: "maintenance", strength: "6-7", monthly_budget: 2400 }) },
  { id: "S03-weight-loss", title: "Weight loss (real QA account)", source: "tests/fixtures/qaRound5State.json — the QA account's real weight-loss profile and BetterCart-built basket",
    items: QA5.basket, profile: QA5.profile },
  { id: "S04-vegan", title: "Vegan", source: "tests/fixtures/baskets.js — vegan",
    items: BASKETS.vegan.items, profile: BASKETS.vegan.profile },
  { id: "S05-vegetarian", title: "Vegetarian", source: "tests/fixtures/baskets.js — vegetarian",
    items: BASKETS.vegetarian.items, profile: BASKETS.vegetarian.profile },
  { id: "S06-allergies", title: "Allergies (nuts, fish)", source: "tests/fixtures/baskets.js — allergies (the basket holds nuts and fish the profile cannot eat)",
    items: BASKETS.allergies.items, profile: BASKETS.allergies.profile },
  { id: "S07-dislikes", title: "Several disliked foods", source: "tests/fixtures/qaRound4Basket.json — a BetterCart-built basket; profile from calculateMacros (83 kg, maintenance, strength 3-5) with 4 disliked foods the basket holds",
    items: QA4_BASKET,
    profile: profileFrom({ weight: 83, height: 180, age: 30, gender: "male", activity: "moderately_active", goal: "maintenance", strength: "3-5", monthly_budget: 1700,
      favorite_foods: ["חזה עוף"], disliked_foods: ["סרדינים", "בולגרית", "בננה", "קישוא"] }) },
  { id: "S08-tight-budget", title: "Tight but feasible budget", source: "economy basket (20 cheap fixture products), BASE_PROFILE with ₪1,200 a month — the lowest budget (₪50 steps) the production planner still fits",
    items: ECONOMY, profile: { ...BASE_PROFILE, monthly_budget: 1200 } },
  { id: "S09-sparse", title: "Sparse basket", source: "tests/fixtures/baskets.js — limited (8 products)",
    items: BASKETS.limited.items, profile: BASKETS.limited.profile },
  { id: "S10-large", title: "Large basket with many alike products", source: "all 38 products of the fixture catalog, BASE_PROFILE with a larger budget",
    items: ALL_ITEMS, profile: { ...BASE_PROFILE, monthly_budget: 2200 } },
];

// Kept apart from the comparison: inputs the planner is expected to refuse or to miss the budget on.
export const CONTROLS = [
  { id: "C1-impossible-budget", title: "Budget far below the basket's cost", source: "tests/fixtures/baskets.js — expensive (₪900 a month)",
    items: BASKETS.expensive.items, profile: BASKETS.expensive.profile },
  { id: "C3-real-menu-over-budget", title: "Real QA account, round 7: the basket fits the budget, the menu does not", source: "tests/fixtures/qaRound7State.json",
    items: QA7.basket.items, profile: QA7.profile },
  { id: "C2-cannot-fill-week", title: "Three products: no complete week", source: "tests/fixtures/baskets.js — tiny",
    items: BASKETS.tiny.items, profile: BASKETS.tiny.profile },
];
