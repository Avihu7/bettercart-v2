/**
 * EXPERIMENT ONLY. Builds the fixed 100-scenario set of the extended benchmark: scenarios100.json.
 *
 *   npx vite-node docs/algorithm-audit/experiments/buildScenarios100.mjs
 *
 * 10 scenarios are the original hand-picked ones (scenarios.js, unchanged) and 90 are SYNTHETIC:
 * generated here from a seeded pseudo-random generator, so the same file is produced on every run.
 * A synthetic scenario is a profile (body data -> the app's own calorie and macro formulas, diet,
 * allergy, disliked and favourite foods, monthly budget) and a basket sampled from the 38 products of
 * the project's fixture catalog (tests/fixtures/baskets.js). No real user data is involved.
 *
 * Design: goal x basket size x budget tier form a full 3 x 3 x 3 grid that repeats; the diet follows
 * a fixed quota; everything else is drawn from the seeded generator.
 * Acceptance rule (fixed before any comparison, PRODUCTION planner only): a candidate is kept when
 * the production pipeline builds a complete week for it. A candidate it refuses (IncompleteMenuError
 * etc.) is replaced by the next draw for the same design cell; the refusals are counted in the output.
 * The extended algorithm is never run here.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { calculateBMR, calculateDailyCalories, calculateMacros } from "@/lib/calculations";
import { generateNutritionPlan } from "@/lib/nutritionPlanGenerator";
import { profileConflict } from "@/lib/basketAlternatives";
import { weeklyBudget } from "@/lib/pricing";
import { ITEMS } from "../../../tests/fixtures/baskets";

const SEED = 20261012;
const TARGET = 90;
const OUT = fileURLToPath(new URL("./scenarios100.json", import.meta.url));

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const KEYS = Object.keys(ITEMS);
const byCat = cat => KEYS.filter(k => ITEMS[k].category === cat);
const GROUPS = {
  protein: [...byCat("protein"), "cottage", "whiteCheese", "yogurt"],
  bread: ["bread", "pita", "oats"],
  grain: ["rice", "pasta", "quinoa", "potato"],
  fat: byCat("fat"),
  vegetable: byCat("vegetable"),
  fruit: byCat("fruit"),
};
// diet quota over the 90 synthetic scenarios (omnivore 36, vegetarian 14, vegan 12, lactose-free 9, gluten-free 9, kosher-style omnivore 10)
const DIETS = [...Array(36).fill([]), ...Array(14).fill(["צמחוני"]), ...Array(12).fill(["טבעוני"]), ...Array(9).fill(["ללא לקטוז"]), ...Array(9).fill(["ללא גלוטן"]), ...Array(10).fill(["כשר"])];
const GOALS = ["weight_loss", "maintenance", "weight_gain"];
const SIZES = [{ name: "sparse", min: 9, max: 12, veg: 2, protein: 2 }, { name: "medium", min: 14, max: 20, veg: 3, protein: 3 }, { name: "rich", min: 22, max: 30, veg: 4, protein: 4 }];
const BUDGETS = [{ name: "tight", min: 1200, max: 1500 }, { name: "normal", min: 1600, max: 2200 }, { name: "generous", min: 2400, max: 3400 }];
const ALLERGIES = ["אגוזים", "דגים", "ביצים", "חלב", "סויה"];
const ACTIVITY = ["sedentary", "lightly_active", "moderately_active", "very_active"];
const STRENGTH = ["none", "1-2", "3-5", "6-7"];

function candidate(slot, attempt) {
  const rnd = mulberry32(SEED + slot * 1000 + attempt);
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // the diet order is a fixed permutation of the quota, so diets are spread over the design grid
  const diet = DIET_ORDER[slot];
  const goal = GOALS[slot % 3], size = SIZES[Math.floor(slot / 3) % 3], tier = BUDGETS[Math.floor(slot / 9) % 3];
  const gender = rnd() < 0.5 ? "male" : "female";
  const weight = gender === "male" ? int(62, 102) : int(50, 85), height = gender === "male" ? int(165, 195) : int(152, 180), age = int(20, 62);
  const activity = pick(ACTIVITY), strength = pick(STRENGTH);
  const allergies = rnd() < 0.3 ? [pick(ALLERGIES)] : [];
  const daily_calories = calculateDailyCalories(calculateBMR(weight, height, age, gender), activity, goal);
  const m = calculateMacros(daily_calories, goal, weight, strength);
  const profile = { weight, height, age, gender, activity_level: activity, goal, strength_training: strength, daily_calories,
    protein_target: m.protein, carbs_target: m.carbs, fat_target: m.fat, monthly_budget: Math.round(int(tier.min, tier.max) / 50) * 50, purchases_per_month: 4,
    dietary_preferences: diet, allergies, favorite_foods: [], disliked_foods: [], onboarding_complete: true };

  // basket: a guaranteed core the profile can eat, then random extras (which may include products it cannot eat)
  const ok = k => !profileConflict(ITEMS[k], profile);
  const chosen = new Set();
  const take = (group, n) => shuffle(GROUPS[group].filter(ok)).slice(0, n).forEach(k => chosen.add(k));
  take("protein", size.protein); take("bread", 1); take("grain", size.name === "sparse" ? 1 : 2); take("fat", size.name === "sparse" ? 1 : 2); take("vegetable", size.veg); take("fruit", size.name === "sparse" ? 1 : 2);
  const total = int(size.min, size.max);
  const clash = rnd() < 0.4;   // 40% of the baskets may also hold products the profile cannot eat, as a real basket can
  for (const k of shuffle(KEYS)) { if (chosen.size >= total) break; if (clash || ok(k)) chosen.add(k); }
  const keys = KEYS.filter(k => chosen.has(k));
  const names = keys.filter(ok).map(k => ITEMS[k].name);
  if (rnd() < 0.3) profile.disliked_foods = shuffle(names).slice(0, int(1, 2));
  if (rnd() < 0.3) profile.favorite_foods = shuffle(names.filter(n => !profile.disliked_foods.includes(n))).slice(0, int(1, 2));
  return { design: { goal, size: size.name, budget: tier.name, diet: diet[0] || "ללא העדפה" }, keys, profile };
}
// fixed permutation of the diet quota
const DIET_ORDER = (() => { const r = mulberry32(SEED ^ 0x5f3759df); const a = [...DIETS]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; })();

console.info = () => {}; console.warn = () => {};
const scenarios = [], refused = [];
for (let slot = 0; slot < TARGET; slot++) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const c = candidate(slot, attempt);
    const items = c.keys.map(k => ITEMS[k]);
    let error = null;
    try { await generateNutritionPlan({ list: { items }, profile: c.profile, budget: weeklyBudget(c.profile) }); } catch (e) { error = e.name; }
    if (!error) { scenarios.push({ id: `G${String(slot + 11).padStart(3, "0")}`, slot, attempt, ...c }); break; }
    refused.push({ slot, attempt, error, design: c.design, products: c.keys.length });
  }
}
// diversity: no two scenarios share a basket and a profile; how alike are the baskets
const sig = s => JSON.stringify([s.keys, s.profile]);
const jacc = (a, b) => { const A = new Set(a), B = new Set(b); const inter = [...A].filter(x => B.has(x)).length; return inter / (A.size + B.size - inter); };
const sims = []; for (let i = 0; i < scenarios.length; i++) for (let j = i + 1; j < scenarios.length; j++) sims.push(jacc(scenarios[i].keys, scenarios[j].keys));
sims.sort((a, b) => a - b);
const tally = f => scenarios.reduce((o, s) => { const k = f(s); o[k] = (o[k] || 0) + 1; return o; }, {});
const meta = { seed: SEED, generated: scenarios.length, refusedCandidates: refused.length, refusedDetail: refused,
  distinctScenarios: new Set(scenarios.map(sig)).size, distinctBaskets: new Set(scenarios.map(s => s.keys.join(","))).size,
  basketJaccard: { min: +sims[0].toFixed(2), median: +sims[Math.floor(sims.length / 2)].toFixed(2), max: +sims[sims.length - 1].toFixed(2) },
  byGoal: tally(s => s.design.goal), bySize: tally(s => s.design.size), byBudget: tally(s => s.design.budget), byDiet: tally(s => s.design.diet),
  withAllergy: scenarios.filter(s => s.profile.allergies.length).length, withDislikes: scenarios.filter(s => s.profile.disliked_foods.length).length, withFavourites: scenarios.filter(s => s.profile.favorite_foods.length).length,
  products: { min: Math.min(...scenarios.map(s => s.keys.length)), max: Math.max(...scenarios.map(s => s.keys.length)) },
  calories: { min: Math.min(...scenarios.map(s => s.profile.daily_calories)), max: Math.max(...scenarios.map(s => s.profile.daily_calories)) },
  monthlyBudget: { min: Math.min(...scenarios.map(s => s.profile.monthly_budget)), max: Math.max(...scenarios.map(s => s.profile.monthly_budget)) } };
writeFileSync(OUT, JSON.stringify({ meta, scenarios }, null, 1));
const { refusedDetail, ...brief } = meta;
console.log(JSON.stringify(brief, null, 1));
