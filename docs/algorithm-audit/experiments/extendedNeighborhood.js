/**
 * EXPERIMENT ONLY — not production code, never imported by the app.
 *
 * A copy of the weekly planner's search (src/lib/weeklyPlanner.js at c7247a3) with a
 * pluggable neighborhood. Candidates, scoring context, static scores, the objective, the
 * greedy construction and the single-slot local search are the production ones, line for
 * line (the runner checks that neighborhood "baseline" returns exactly what production
 * planWeek returns). Only what happens AFTER the production local search has converged differs:
 *
 *   baseline   nothing more (= production)
 *   swap       + cross-day swaps
 *   pair       + coordinated two-slot replacements
 *   extended   + both
 *
 * Extended search (variable neighborhood descent, deterministic, bounded):
 *   repeat up to MAX_ROUNDS times:
 *     swap sweep  — for every meal type and every day a (fixed order): the best improving
 *                   exchange of that meal with the same meal type of a later day b; applied at once
 *     pair sweep  — for a fixed list of 33 slot pairs: the TOP_K alternatives of each slot
 *                   (ranked by the week's objective with that slot alone replaced) are combined,
 *                   and the best improving combination replaces both slots as one move
 *     nothing accepted → stop; otherwise the production single-slot search runs again
 *
 * Every state is a week of production candidates in slots of their own meal type, so every
 * hard rule the candidates carry (diet, allergies, dislikes, kosher, meal rules) holds in
 * every state; no slot is ever emptied. Only strict improvements (> EPS) are accepted, ties
 * keep the earlier option, there is no randomness: same input → same week.
 */
import { generateCandidates, MEAL_TYPES } from "@/lib/menuCandidates";
import { scoringContext, scoreMeal, weeklyPenalty } from "@/lib/mealScoring";
import { WEEK_DAYS } from "@/lib/weekDays";

const DAY_NAMES = WEEK_DAYS.map(d => d.key);
// As in production
const MAX_PASSES = 6;
const EPS = 1e-9;

// The experiment's own bounds
export const LIMITS = {
  TOP_K: 8, // alternatives per slot combined in a two-slot move
  MAX_ROUNDS: 6, // extended rounds (the same number as the production pass limit)
  SWAP_EVALS_PER_SWEEP: 4 * 21, // 4 meal types × C(7,2) day pairs
  SLOT_PAIRS: 33, // 21 same-day pairs + 12 consecutive-day pairs
  PAIR_EVALS_PER_SWEEP: 33 * 8 * 8, // at most TOP_K² combinations per slot pair
};

// Two-slot moves are tried only where the objective couples two slots directly:
//   same day: breakfast–lunch, breakfast–dinner, lunch–dinner (sameDay, sameDayCore, proteinShort, dayFit)
//   consecutive days: lunch–lunch, dinner–dinner (consecutive)
const B = 0, L = 1, D = 2;
export const SLOT_PAIRS = [
  ...DAY_NAMES.flatMap((_, d) => [[[d, B], [d, L]], [[d, B], [d, D]], [[d, L], [d, D]]]),
  ...[L, D].flatMap(s => [0, 1, 2, 3, 4, 5].map(d => [[d, s], [d + 1, s]])),
];

const r3 = n => Math.round(n * 1000) / 1000;

export function planWeekExperimental({ catalog, densities, profile, budget = null, weights = {}, avoid = null }, { neighborhood = "baseline" } = {}) {
  const candidates = generateCandidates({ catalog, densities, profile });
  const ctx = scoringContext({ catalog, densities, profile, budget, candidates, weights, avoid });
  const staticScore = new Map(Object.values(candidates).flat().map(c => [c, scoreMeal(c, ctx).score]));

  const count = { greedy: 0, single: 0, swap: 0, rank: 0, pair: 0, other: 0 };
  let phase = "other";
  const week = DAY_NAMES.map(() => MEAL_TYPES.map(() => null));
  const objective = () => {
    count[phase]++;
    let s = 0;
    for (const day of week) for (const c of day) if (c) s += staticScore.get(c);
    return s - weeklyPenalty(week, ctx).penalty;
  };
  const bestFor = (di, si, current) => {
    const options = candidates[MEAL_TYPES[si]];
    let best = current, bestValue = -Infinity;
    for (const c of options) {
      week[di][si] = c;
      const v = objective();
      if (v > bestValue + EPS) { best = c; bestValue = v; }
    }
    week[di][si] = current;
    return { best, bestValue };
  };

  // ── Greedy construction (production)
  phase = "greedy";
  for (let di = 0; di < week.length; di++) {
    for (let si = 0; si < MEAL_TYPES.length; si++) {
      if (!candidates[MEAL_TYPES[si]].length) continue;
      week[di][si] = bestFor(di, si, null).best;
    }
  }
  const greedyValue = objective();

  // ── Single-slot local search (production)
  const singleSlotSearch = () => {
    phase = "single";
    let passes = 0, swaps = 0;
    for (; passes < MAX_PASSES; passes++) {
      let changed = false;
      for (let di = 0; di < week.length; di++) {
        for (let si = 0; si < MEAL_TYPES.length; si++) {
          const current = week[di][si];
          if (!current) continue;
          const before = objective();
          const { best, bestValue } = bestFor(di, si, current);
          if (best !== current && bestValue > before + EPS) {
            week[di][si] = best;
            changed = true;
            swaps++;
          }
        }
      }
      if (!changed) break;
    }
    return { passes, swaps };
  };
  const first = singleSlotSearch();
  phase = "other";
  const baselineValue = objective();

  // ── Extended neighborhood (experiment)
  const accepted = { swaps: 0, pairs: 0, singleAfterExtended: 0 };
  const examples = [];
  const partsNow = () => weeklyPenalty(week, ctx).parts;
  const changedParts = (before, after) => Object.fromEntries(Object.keys(after)
    .filter(k => Math.abs(after[k] - before[k]) > 1e-9)
    .map(k => [k, { from: r3(before[k]), to: r3(after[k]), weighted: r3(-(ctx.W[k] || 0) * (after[k] - before[k])) }]));
  const label = (d, s) => `${DAY_NAMES[d]}/${MEAL_TYPES[s]}`;
  const valueWith = (changes) => {
    const saved = changes.map(([d, s]) => week[d][s]);
    changes.forEach(([d, s, c]) => { week[d][s] = c; });
    const v = objective();
    changes.forEach(([d, s], i) => { week[d][s] = saved[i]; });
    return v;
  };
  // How an accepted move looks to the production search: each half alone, and both together
  const record = (type, before, a, b) => {
    const prev = phase; phase = "other";
    const partsBefore = partsNow();
    const dA = valueWith([a]) - before, dB = valueWith([b]) - before, dBoth = valueWith([a, b]) - before;
    const saved = [week[a[0]][a[1]], week[b[0]][b[1]]];
    week[a[0]][a[1]] = a[2]; week[b[0]][b[1]] = b[2];
    const partsAfter = partsNow();
    const staticDelta = staticScore.get(a[2]) + staticScore.get(b[2]) - staticScore.get(saved[0]) - staticScore.get(saved[1]);
    week[a[0]][a[1]] = saved[0]; week[b[0]][b[1]] = saved[1];
    examples.push({
      type, slots: [label(a[0], a[1]), label(b[0], b[1])],
      from: [saved[0].meal.meal_name, saved[1].meal.meal_name], to: [a[2].meal.meal_name, b[2].meal.meal_name],
      deltaFirstAlone: r3(dA), deltaSecondAlone: r3(dB), deltaTogether: r3(dBoth),
      eachAloneRejected: dA <= EPS && dB <= EPS,
      staticDelta: r3(staticDelta), penaltyParts: changedParts(partsBefore, partsAfter),
    });
    phase = prev;
  };

  const swapSweep = () => {
    phase = "swap";
    let n = 0;
    for (let si = 0; si < MEAL_TYPES.length; si++) {
      for (let a = 0; a < week.length; a++) {
        const ca = week[a][si];
        if (!ca) continue;
        const before = objective();
        let bestB = -1, bestValue = before;
        for (let b = a + 1; b < week.length; b++) {
          const cb = week[b][si];
          if (!cb || cb === ca) continue;
          week[a][si] = cb; week[b][si] = ca;
          const v = objective();
          week[a][si] = ca; week[b][si] = cb;
          if (v > bestValue + EPS) { bestValue = v; bestB = b; }
        }
        if (bestB >= 0) {
          const cb = week[bestB][si];
          record("swap", before, [a, si, cb], [bestB, si, ca]);
          week[a][si] = cb; week[bestB][si] = ca;
          n++;
        }
      }
    }
    return n;
  };

  const pairSweep = () => {
    let n = 0;
    const cache = new Map();
    const topK = (d, s) => {
      const key = `${d}:${s}`;
      if (cache.has(key)) return cache.get(key);
      phase = "rank";
      const current = week[d][s];
      const ranked = [];
      for (const c of candidates[MEAL_TYPES[s]]) {
        if (c === current) continue;
        week[d][s] = c;
        ranked.push({ c, v: objective() });
      }
      week[d][s] = current;
      // stable sort: ties keep generation order
      const top = ranked.map((r, i) => ({ ...r, i })).sort((x, y) => y.v - x.v || x.i - y.i).slice(0, LIMITS.TOP_K).map(r => r.c);
      cache.set(key, top);
      return top;
    };
    for (const [[d1, s1], [d2, s2]] of SLOT_PAIRS) {
      const c1 = week[d1][s1], c2 = week[d2][s2];
      if (!c1 || !c2) continue;
      const A = topK(d1, s1), Bs = topK(d2, s2);
      if (!A.length || !Bs.length) continue;
      phase = "pair";
      const before = objective();
      let best = null, bestValue = before;
      for (const x of A) {
        for (const y of Bs) {
          week[d1][s1] = x; week[d2][s2] = y;
          const v = objective();
          if (v > bestValue + EPS) { bestValue = v; best = [x, y]; }
        }
      }
      week[d1][s1] = c1; week[d2][s2] = c2;
      if (best) {
        record("pair", before, [d1, s1, best[0]], [d2, s2, best[1]]);
        week[d1][s1] = best[0]; week[d2][s2] = best[1];
        cache.clear();
        n++;
      }
    }
    return n;
  };

  let rounds = 0;
  if (neighborhood !== "baseline") {
    for (; rounds < LIMITS.MAX_ROUNDS; rounds++) {
      const s = neighborhood === "extended" || neighborhood === "swap" ? swapSweep() : 0;
      const p = neighborhood === "extended" || neighborhood === "pair" ? pairSweep() : 0;
      accepted.swaps += s; accepted.pairs += p;
      if (!s && !p) break;
      accepted.singleAfterExtended += singleSlotSearch().swaps;
    }
  }

  phase = "other";
  const final = weeklyPenalty(week, ctx);
  const finalValue = objective();
  return {
    days: week.map((day, di) => ({
      day_name: DAY_NAMES[di],
      meals: day.filter(Boolean).map(c => structuredClone(c.meal)),
    })),
    stats: {
      // the production stats, same meaning
      candidates: Object.fromEntries(MEAL_TYPES.map(t => [t, candidates[t].length])),
      greedyObjective: r3(greedyValue),
      objective: r3(finalValue),
      localSearchPasses: first.passes + 1,
      localSearchSwaps: first.swaps,
      penalty: final.parts,
      estimatedCost: Math.round(final.estimatedCost * 10) / 10,
      // the experiment's
      experiment: {
        neighborhood,
        baselineObjective: r3(baselineValue),
        gain: r3(finalValue - baselineValue),
        rounds: neighborhood === "baseline" ? 0 : Math.min(rounds + 1, LIMITS.MAX_ROUNDS),
        accepted: { single: first.swaps, ...accepted },
        evaluations: { ...count, total: Object.values(count).reduce((a, b) => a + b, 0) },
        examples: examples.slice(0, 6),
        examplesTotal: examples.length,
        eachAloneRejected: examples.filter(e => e.eachAloneRejected).length,
      },
    },
  };
}
