// EXPERIMENT ONLY. Scenario design aid: runs the PRODUCTION planner only (nothing experimental), to see
// which budget / which real weight-loss basket gives a feasible baseline menu.
//   npx vite-node docs/algorithm-audit/experiments/feasibilityCheck.mjs
import { generateNutritionPlan } from "@/lib/nutritionPlanGenerator";
import { validateMenu } from "@/lib/validateMenu";
import { weeklyBudget } from "@/lib/pricing";
import { ITEMS as I, BASE_PROFILE } from "../../../tests/fixtures/baskets.js";
import QA5 from "../../../tests/fixtures/qaRound5State.json";
import QA6 from "../../../tests/fixtures/qaRound6State.json";
import QA7 from "../../../tests/fixtures/qaRound7State.json";
console.info = () => {}; console.warn = () => {};
const run = async (label, items, profile) => {
  const budget = weeklyBudget(profile);
  try {
    const plan = await generateNutritionPlan({ list: { items }, profile, budget });
    const q = validateMenu({ plan, basketItems: items, profile, budget });
    console.log(label, "budget", budget, "cost", plan.estimated_weekly_cost, "L" + q.level, JSON.stringify(q.failed), plan.validation.planner.chosen);
  } catch (e) { console.log(label, "ERR", e.name); }
};
const ECONOMY = [I.chicken, I.eggs, I.lentils, I.chickpeas, I.cottage, I.yogurt, I.milk, I.rice, I.pasta, I.bread, I.oats, I.potato, I.tomato, I.cucumber, I.carrot, I.banana, I.apple, I.oil, I.tahini, I.coffee];
for (const m of [1150, 1200, 1250, 1300, 1350, 1400, 1450, 1500]) await run("economy monthly " + m, ECONOMY, { ...BASE_PROFILE, monthly_budget: m });
await run("qa7", QA7.basket.items, QA7.profile);
await run("qa6", QA6.basket, QA6.profile);
await run("qa5", QA5.basket, QA5.profile);
console.log(Object.keys(I).length);
