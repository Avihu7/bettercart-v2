/**
 * EXPERIMENT ONLY — the benchmark runner. Not part of the app or of `npm test`.
 *
 *   npx vitest run --config docs/algorithm-audit/experiments/vitest.config.js
 *
 * Compares, on the fixed scenarios of scenarios.js:
 *   BASELINE   the production planner (src/lib/weeklyPlanner.js planWeek, untouched)
 *   EXTENDED   the same search + cross-day swaps + coordinated two-slot replacements
 *              (extendedNeighborhood.js); "swap" and "pair" alone are run too, to attribute a change
 *
 * Everything around the planner is the production code itself: the runner calls the real
 * generateNutritionPlan (candidates → planner ×4 variants → balancing → budget fit → validation
 * → choice of the best week) and only substitutes the module the planner is imported from.
 * In "production" mode the substitute forwards to the real planWeek.
 *
 * Output: results.json next to this file.
 */
import { it, vi } from "vitest";
import os from "node:os";
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ctl = vi.hoisted(() => ({ mode: "production", calls: [] }));
vi.mock("@/lib/weeklyPlanner", async importOriginal => {
  const actual = await importOriginal();
  const { planWeekExperimental } = await import("./extendedNeighborhood.js");
  return {
    ...actual,
    planWeek(args) {
      const t = performance.now();
      const result = ctl.mode === "production" ? actual.planWeek(args) : planWeekExperimental(args, { neighborhood: ctl.mode });
      ctl.calls.push({ ms: performance.now() - t, stats: result.stats });
      return result;
    },
  };
});

import { generateNutritionPlan } from "@/lib/nutritionPlanGenerator";
import { WEIGHTS, PLANNER_VARIANTS } from "@/lib/mealScoring";
import { buildProductCatalog } from "@/lib/mealPlanRules";
import { buildDensities } from "@/lib/mealPlanCalories";
import { profileConflict, isSupplement, isDisliked } from "@/lib/basketAlternatives";
import { isPlainWater } from "@/lib/receiptClassifier";
import { weeklyBudget } from "@/lib/pricing";
import { planWeekExperimental, LIMITS, SLOT_PAIRS } from "./extendedNeighborhood.js";
import { measure, compareRank } from "./metrics.js";
import { SCENARIOS, CONTROLS } from "./scenarios.js";

const TIMING_RUNS = Number(process.env.BENCH_TIMING_RUNS ?? 10);
const ONLY = process.env.BENCH_ONLY ? process.env.BENCH_ONLY.split(",") : null;
const OUT = fileURLToPath(new URL(process.env.BENCH_OUT || "./results.json", import.meta.url));
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const git = cmd => execSync(`git ${cmd}`, { cwd: REPO }).toString().trim();

const r1 = n => Math.round(n * 10) / 10;
const r3 = n => Math.round(n * 1000) / 1000;
const median = a => { const v = [...a].sort((x, y) => x - y); return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2; };
const timing = a => ({ runs: a.length, mean: r1(a.reduce((s, x) => s + x, 0) / a.length), median: r1(median(a)), min: r1(Math.min(...a)), max: r1(Math.max(...a)) });
const fingerprint = days => JSON.stringify(days.map(d => [d.day_name, d.meals.map(m => [m.meal_type, m.meal_name, m.items.map(i => [i.food_name, i.grams])])]));
const compactPlan = days => days.map(d => ({
  day: d.day_name, kcal: d.total_calories, protein: d.total_protein, fat: d.total_fat, carbs: d.total_carbs,
  meals: d.meals.map(m => `${m.meal_type}: ${m.items.map(i => `${i.food_name} ${i.grams}g`).join(" + ")}`),
}));

async function build(mode, { items, profile }, budget) {
  ctl.mode = mode;
  ctl.calls = [];
  const t = performance.now();
  let plan = null, error = null;
  try { plan = await generateNutritionPlan({ list: { items }, profile, budget }); }
  catch (e) { error = { name: e.name, message: String(e.message).slice(0, 200) }; }
  const ms = performance.now() - t;
  const calls = ctl.calls.slice();
  ctl.mode = "production";
  return { plan, error, ms, plannerMs: calls.reduce((s, c) => s + c.ms, 0), calls };
}

/** One algorithm's final result for a scenario: the menu's measurements + what the search did. */
function describe(run, scenario, budget, { withExamples = false } = {}) {
  if (run.error) return { error: run.error };
  const m = measure({ plan: run.plan, items: scenario.items, profile: scenario.profile, budget });
  const chosen = run.plan.validation.planner.chosen;
  const search = run.calls.slice(0, PLANNER_VARIANTS.length).map((c, i) => {
    const e = c.stats.experiment;
    return {
      variant: PLANNER_VARIANTS[i].name,
      greedyObjective: c.stats.greedyObjective, objective: c.stats.objective,
      baselinePasses: c.stats.localSearchPasses, baselineSwaps: c.stats.localSearchSwaps,
      ...(e ? {
        baselineObjective: e.baselineObjective, gain: e.gain, rounds: e.rounds, accepted: e.accepted, evaluations: e.evaluations,
        movesWhereEachHalfAloneIsRejected: e.eachAloneRejected, movesRecorded: e.examplesTotal,
        ...(withExamples ? { examples: e.examples } : {}),
      } : {}),
    };
  });
  return {
    chosenVariant: chosen,
    variants: run.plan.validation.planner.variants,
    ...m,
    search,
    fingerprint: fingerprint(run.plan.days),
    plan: compactPlan(run.plan.days),
  };
}

function outcome(base, ext) {
  if (base.error || ext.error) return base.error && ext.error ? "both refused" : ext.error ? "regressed (extended refused)" : "improved (baseline refused)";
  if (base.structure.hardValid && !ext.structure.hardValid) return "regressed (hard validity)";
  if (base.fingerprint === ext.fingerprint) return "identical menu";
  const c = compareRank(ext.rank, base.rank);
  return c < 0 ? "improved" : c > 0 ? "regressed" : "different menu, same rank";
}
const RANK_KEYS = ["quality level", "failed checks", "diversity", "cost above 85% of budget", "limited checks", "cost"];
const decidedBy = (base, ext) => {
  if (base.error || ext.error) return null;
  const i = base.rank.findIndex((v, k) => v !== ext.rank[k]);
  return i < 0 ? null : RANK_KEYS[i];
};

it("extended-neighborhood benchmark", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const actualPlanner = await vi.importActual("@/lib/weeklyPlanner");
  const srcBefore = git("status --porcelain -- src server tests package.json vite.config.js");

  const results = {
    generated: new Date().toISOString(),
    baselineCommit: git("rev-parse HEAD"),
    environment: { node: process.version, platform: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, cores: os.cpus().length, runner: "vitest (node environment)" },
    timingRuns: TIMING_RUNS,
    limits: { ...LIMITS, slotPairs: SLOT_PAIRS.length, productionMaxPasses: 6, eps: 1e-9 },
    objective: { effectiveWeights: WEIGHTS, weightKeys: Object.keys(WEIGHTS).length, variants: PLANNER_VARIANTS },
    scenarios: [], controls: [],
  };

  const scenarios = SCENARIOS.filter(s => !ONLY || ONLY.includes(s.id));
  for (const scenario of scenarios) {
    const { items, profile } = scenario;
    const budget = weeklyBudget(profile);
    const eatable = items.filter(i => !isPlainWater(i.name) && !profileConflict(i, profile) && !isSupplement(i) && !isDisliked(i.name, profile?.disliked_foods || []));
    const catalog = buildProductCatalog(eatable);
    const densities = buildDensities(catalog, { days: [] });

    // 1. the experiment's copy of the search, with no extra moves, must be the production planner
    const replica = PLANNER_VARIANTS.map(v => {
      const args = { catalog, densities, profile, budget, weights: v.weights };
      const prod = actualPlanner.planWeek(args);
      const copy = planWeekExperimental(args, { neighborhood: "baseline" });
      return { variant: v.name, sameWeek: JSON.stringify(prod.days) === JSON.stringify(copy.days),
        sameObjective: prod.stats.objective === copy.stats.objective && prod.stats.greedyObjective === copy.stats.greedyObjective,
        candidates: prod.stats.candidates };
    });

    // 2. quality: one run each (both are deterministic — checked in 3)
    const runs = {};
    for (const mode of ["production", "extended", "swap", "pair"]) runs[mode] = await build(mode, scenario, budget);
    const baseline = describe(runs.production, scenario, budget);
    const extended = describe(runs.extended, scenario, budget, { withExamples: true });
    const swapOnly = describe(runs.swap, scenario, budget);
    const pairOnly = describe(runs.pair, scenario, budget);

    // 3. timing and reproducibility: alternate the two algorithms, after one warm-up run each
    const times = { production: { total: [], planner: [], prints: new Set() }, extended: { total: [], planner: [], prints: new Set() } };
    if (TIMING_RUNS > 0) {
      for (const mode of ["production", "extended"]) await build(mode, scenario, budget);
      for (let i = 0; i < TIMING_RUNS; i++) {
        for (const mode of ["production", "extended"]) {
          const r = await build(mode, scenario, budget);
          times[mode].total.push(r.ms);
          times[mode].planner.push(r.plannerMs);
          times[mode].prints.add(r.plan ? fingerprint(r.plan.days) : `error:${r.error.name}`);
        }
      }
    }
    const timed = mode => (TIMING_RUNS > 0 ? {
      fullPipelineMs: timing(times[mode].total), plannerOnlyMs: timing(times[mode].planner),
      samePlanInEveryRun: times[mode].prints.size === 1,
      sameAsQualityRun: times[mode].prints.has((mode === "production" ? baseline : extended).fingerprint ?? `error:${(mode === "production" ? baseline : extended).error?.name}`),
    } : null);

    const strip = x => { const { fingerprint: _f, ...rest } = x; return rest; };
    results.scenarios.push({
      id: scenario.id, title: scenario.title, source: scenario.source,
      input: {
        products: items.length, eatable: eatable.length, productNames: items.map(i => i.name),
        profile: Object.fromEntries(["daily_calories", "protein_target", "fat_target", "carbs_target", "monthly_budget", "goal", "strength_training", "weight",
          "dietary_preferences", "allergies", "favorite_foods", "disliked_foods"].filter(k => profile[k] !== undefined).map(k => [k, profile[k]])),
        weeklyFoodBudget: budget, candidates: replica[0].candidates,
      },
      replicaEqualsProduction: replica.every(r => r.sameWeek && r.sameObjective),
      outcome: outcome(baseline, extended),
      decidedBy: decidedBy(baseline, extended),
      // which move type alone gives the extended final menu
      attribution: baseline.error || extended.error ? null : {
        swapOnlyOutcome: outcome(baseline, swapOnly), pairOnlyOutcome: outcome(baseline, pairOnly),
        swapOnlyGivesExtendedMenu: swapOnly.fingerprint === extended.fingerprint, pairOnlyGivesExtendedMenu: pairOnly.fingerprint === extended.fingerprint,
        swapOnlyRank: swapOnly.rank, pairOnlyRank: pairOnly.rank,
      },
      baseline: strip(baseline), extended: strip(extended),
      timing: { baseline: timed("production"), extended: timed("extended") },
    });
  }

  // Controls: inputs the planner should refuse or cannot fit — reported, not part of the comparison
  for (const control of ONLY ? [] : CONTROLS) {
    const budget = weeklyBudget(control.profile);
    const b = await build("production", control, budget), e = await build("extended", control, budget);
    const brief = r => (r.error ? { refused: r.error.name } : (() => { const m = measure({ plan: r.plan, items: control.items, profile: control.profile, budget });
      return { level: m.validator.level, failed: m.validator.failed, cost: m.budget.cost, budget, hardValid: m.structure.hardValid }; })());
    results.controls.push({ id: control.id, title: control.title, source: control.source, baseline: brief(b), extended: brief(e),
      sameMenu: !b.error && !e.error && fingerprint(b.plan.days) === fingerprint(e.plan.days) });
  }

  // Summary
  const sc = results.scenarios;
  const all = k => sc.flatMap(s => (s.timing[k] ? [s.timing[k].fullPipelineMs.median] : []));
  const allPlanner = k => sc.flatMap(s => (s.timing[k] ? [s.timing[k].plannerOnlyMs.median] : []));
  const count = f => sc.filter(f).length;
  results.summary = {
    scenarios: sc.length,
    improved: count(s => s.outcome.startsWith("improved")),
    regressed: count(s => s.outcome.startsWith("regressed")),
    identicalMenu: count(s => s.outcome === "identical menu"),
    differentMenuSameRank: count(s => s.outcome === "different menu, same rank"),
    hardValidBaseline: count(s => s.baseline.structure?.hardValid), hardValidExtended: count(s => s.extended.structure?.hardValid),
    replicaEqualsProductionEverywhere: sc.every(s => s.replicaEqualsProduction),
    deterministic: TIMING_RUNS > 0 ? sc.every(s => s.timing.baseline.samePlanInEveryRun && s.timing.extended.samePlanInEveryRun &&
      s.timing.baseline.sameAsQualityRun && s.timing.extended.sameAsQualityRun) : null,
    medianFullPipelineMs: TIMING_RUNS > 0 ? { baseline: r1(median(all("baseline"))), extended: r1(median(all("extended"))) } : null,
    medianPlannerOnlyMs: TIMING_RUNS > 0 ? { baseline: r1(median(allPlanner("baseline"))), extended: r1(median(allPlanner("extended"))) } : null,
    objectiveGainInChosenVariant: sc.map(s => ({ id: s.id, gain: s.extended.search?.find(v => v.variant === s.extended.chosenVariant)?.gain ?? null })),
  };
  if (results.summary.medianFullPipelineMs) {
    const { baseline, extended } = results.summary.medianFullPipelineMs;
    results.summary.fullPipelineOverheadPct = r1((extended - baseline) / baseline * 100);
    const p = results.summary.medianPlannerOnlyMs;
    results.summary.plannerOnlyOverheadPct = r1((p.extended - p.baseline) / p.baseline * 100);
  }
  // Production code must not have changed while the benchmark ran
  results.productionUnchangedDuringRun = srcBefore === git("status --porcelain -- src server tests package.json vite.config.js");
  results.productionWorkingTreeStatus = srcBefore || "clean";
  results.headAfter = git("rev-parse HEAD");

  writeFileSync(OUT, JSON.stringify(results, null, 1));
  void r3;
});
