/**
 * Weekly planner — deterministic greedy construction + fixed-order local search.
 *
 *   candidates (menuCandidates.js) → scored (mealScoring.js)
 *     → greedy: day by day, meal by meal, the candidate that maximizes the
 *       weekly objective given everything chosen so far
 *     → local search: for every slot in a fixed order (Sunday breakfast …
 *       Saturday snacks), the candidate that improves the whole week's
 *       objective the most replaces the current one; repeated until a full
 *       pass changes nothing (or MAX_PASSES)
 * Ties keep the earlier candidate (generation order), so the same basket,
 * profile and budget always give the same week. No randomness, no I/O.
 *
 * Complexity: S = 28 slots, C = candidates per meal type, objective = O(S).
 * Greedy O(S·C·S); each local-search pass O(S·C·S); C is a few hundred at most.
 */
import { generateCandidates, MEAL_TYPES } from "@/lib/menuCandidates";
import { scoringContext, scoreMeal, weeklyPenalty } from "@/lib/mealScoring";
import { WEEK_DAYS } from "@/lib/weekDays";

const DAY_NAMES = WEEK_DAYS.map(d => d.key);
const MAX_PASSES = 6;
const EPS = 1e-9;

/**
 * Plans the week. Returns { days, stats } — days in the plan shape the rest of
 * the pipeline uses: [{ day_name, meals: [{ meal_type, meal_name, items: [{ product_id, food_name, grams }] }] }].
 */
export function planWeek({ catalog, densities, profile, budget = null, weights = {} }) {
  const candidates = generateCandidates({ catalog, densities, profile });
  const ctx = scoringContext({ catalog, densities, profile, budget, candidates, weights });
  const staticScore = new Map(Object.values(candidates).flat().map(c => [c, scoreMeal(c, ctx).score]));

  // week[day][slot] — slot order = MEAL_TYPES
  const week = DAY_NAMES.map(() => MEAL_TYPES.map(() => null));
  const objective = () => {
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

  // Greedy construction
  for (let di = 0; di < week.length; di++) {
    for (let si = 0; si < MEAL_TYPES.length; si++) {
      if (!candidates[MEAL_TYPES[si]].length) continue;
      week[di][si] = bestFor(di, si, null).best;
    }
  }
  const greedyValue = objective();

  // Fixed-order local search: best improving replacement per slot, until a pass changes nothing
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

  const final = weeklyPenalty(week, ctx);
  return {
    days: week.map((day, di) => ({
      day_name: DAY_NAMES[di],
      meals: day.filter(Boolean).map(c => structuredClone(c.meal)),
    })),
    stats: {
      candidates: Object.fromEntries(MEAL_TYPES.map(t => [t, candidates[t].length])),
      greedyObjective: Math.round(greedyValue * 1000) / 1000,
      objective: Math.round(objective() * 1000) / 1000,
      localSearchPasses: passes + 1,
      localSearchSwaps: swaps,
      penalty: final.parts,
      estimatedCost: Math.round(final.estimatedCost * 10) / 10,
    },
  };
}
