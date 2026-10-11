# BetterCart Algorithm Freeze

Handoff for the next session. Closed on 2026-10-11. Everything below is verified against the code at the baseline commit unless marked otherwise.

## Baseline

- Branch: `feat/basket-menu-fixes`
- Commit: `c7247a3` (`fix: complete pre-final QA and submission hardening`)
- The production algorithms are frozen at this commit for the submission version.
- The earlier audit files were written against `3673ff9`. The planner's search, scoring, candidate generation, budget fit, validator and plan selection are byte-identical between `3673ff9` and `c7247a3`; so are the basket's scoring and selection (`smartBasketEngine.js`, `basketAlternatives.js`).

## Smart Basket

Files: `src/lib/basketBuilder.js` (`buildBasket`), `src/lib/smartBasketEngine.js` (`selectCandidates`, `rankCandidates`), `src/lib/basketAlternatives.js`.

- Deterministic, no AI. The receipt's menu-fit food items and strong purchase-history regulars (score ≥ 0.72, quality ≥ 0.6, at most 5) are the anchor; they go in unscored.
- Hard filters run before any scoring: non-food, diet and allergies, disliked foods, supplements, duplicates.
- Quota-driven greedy construction: nine weekly needs in a fixed order (3 protein kinds, bread, 2 grains, oil, 2 fats, 4 vegetables, 2 fruits, a breakfast base, a dairy product). For each missing need, the best-ranked candidate that fits the remaining budget is added; the ranking is recomputed after every pick.
- Candidates: 55 fixed candidate types looked up in the catalog (one product per type) plus non-regular history products. At most 12 additions with a receipt, 18 without, and up to 4 optional picks.
- After the engine: missing staples from a fixed priority list, greedy protein completion (up to 3 products, while the basket's protein ceiling is under 120% of the target), then a greedy budget trim (optional picks first; staples never).
- Ranking key, in order: favorite food first, then the score below, then health, price, name.

```
candidateScore =
  0.30 nutrition
+ 0.25 health
+ 0.20 history
+ 0.15 price
+ 0.10 variety
```

Verified notes on the formula: `price` is min–max normalized among the options being compared; `history` is 0.5 (neutral) for every catalog candidate; `variety` is constant across the options of most needs. There is no objective function for the basket as a whole.

**KEEP CURRENT ALGORITHM**

## Weekly Planner

Files: `src/lib/weeklyPlanner.js` (`planWeek`), `src/lib/mealScoring.js`, `src/lib/menuCandidates.js`, `src/lib/nutritionPlanGenerator.js`.

- State: 7 days × 4 slots (breakfast, lunch, dinner, snacks), each holding one candidate meal. Every candidate already satisfies diet, allergies, dislikes, kosher separation and the meal rules, so every state is valid. Portions are not part of the search.
- Greedy initial construction: day by day (Sunday → Saturday), slot by slot; the candidate that maximizes the objective of the partial week.
- Deterministic local search (a hill-climbing variant): the neighborhood is single-slot replacement. For each slot in a fixed order, the best candidate for that slot replaces the current one, at once.
- Improving moves only (gain > 1e-9). No equal or worse moves, no randomness; ties keep the earlier candidate.
- Stopping condition: a full pass with no change, or 6 passes (`MAX_PASSES`). In every measured run it stopped after 1–4 passes.
- Four planner variants (weight vectors): `balanced`, `protein`, `budget`, `variety`.
- After the search, each of the four weeks goes through portion balancing (`finalizeDays`, `closeCalories`), budget fitting (`fitPlanToBudget`) and validation (`validateMenu`). The best week is chosen lexicographically on the final menu: quality level, failed checks, diversity, cost above 85% of the budget, limited checks, cost.

Pipeline: greedy construction → deterministic local search → balancing → budget processing → validation → final plan selection.

**KEEP CURRENT ALGORITHM**

## Objective Function Notes

Verified implementation facts only.

- `objective(week) = Σ scoreMeal(candidate) − weeklyPenalty(week)`, maximized. `WEIGHTS` has 29 distinct keys.
- **Effective carbohydrate weight = 0.25.** The key `carbs` appears twice in `WEIGHTS` (`carbs: 1` for the meal score, `carbs: 0.25` for the weekly penalty); the later one wins, so both uses run at 0.25. Verified by execution. Any document that says 1 is wrong.
- Carbohydrates have no daily target in any stage; the validator reports them and does not grade them.
- Calorie tolerances: ±3% is the balancing target (`CLOSURE_TOLERANCE`), ±5% is the validator threshold.
- The planner objective is a proxy for final-plan quality. It is evaluated on starting portions and on a linear cost estimate. The later stages introduce additional criteria: balancing sets the real portions, budget fitting uses real pack prices, and the validator applies its own thresholds for repetition, nutrition and budget.
- Diet, allergies, dislikes, kosher separation and meal roles are never scored; candidates that break them are not generated.
- Open, unchanged at `c7247a3`, not addressed in this stage: the balancing stage can introduce a meal-rule violation (seen in benchmark scenario S08 and in the earlier audit). Affected variants are graded level 4 and discarded; the chosen menu was valid in every measured case.

## Extended Neighborhood Benchmark

Experiment: the production planner plus two deterministic move types after its local search converges — cross-day swap, and coordinated two-slot replacement. Ten fixed scenarios, final menu as the primary outcome.

- 3/10 improved (all small: the validator's diversity figure only)
- 3/10 unchanged (1 identical menu, 2 different menus with the same rank)
- 4/10 regressed (2 dropped a quality level; one of those also went over budget)
- 10/10 hard-valid in both versions
- Deterministic in both versions (10 repeated runs per scenario and algorithm)
- 457 ms baseline median runtime for the full pipeline (Node 22, Apple M1 Pro; not measured in a browser)
- Approximately +167% runtime overhead (1,221 ms median)
- The internal objective rose in 9 of 10 scenarios, including all four regressions.

Classification: **REGRESSION**

Decision: **NOT IMPLEMENTED**

The extended neighborhood did escape local optima, but that did not translate consistently into better final plans. Improvement in the internal objective alone is insufficient.

## Simulated Annealing

- CONSIDERED
- NOT IMPLEMENTED
- NOT BENCHMARKED

Engineering reason: Simulated Annealing was considered but not selected because the empirical evidence did not justify introducing a more complex stochastic search method. The extended-neighborhood benchmark showed that additional search power does not consistently improve the final user-facing plan, which suggests search power is not the primary bottleneck. SA would also add stochastic behavior, temperature and cooling parameters, runtime cost, reproducibility concerns and extra QA.

Do not claim that SA was experimentally shown to perform worse. It was never run.

## Final Submission Algorithm Decision

- Smart Basket: **FROZEN**
- Weekly Planner: **FROZEN**
- Extended Neighborhood: **REJECTED FOR PRODUCTION**
- Simulated Annealing: **NOT SELECTED**

No further search-algorithm work is planned for the submission version.

## Evidence Files

All under `docs/algorithm-audit/`.

| File | What it holds | Baseline |
|---|---|---|
| `ALGORITHM_FREEZE.md` | This file: the final decision | `c7247a3` |
| `extended-neighborhood-benchmark.md` | The benchmark report (Hebrew): method, scenarios, full results, regressions, runtime | `c7247a3` |
| `project-book-evidence.md` | Evidence rows and safe / unsafe wordings, ready for the evidence register (Hebrew) | `c7247a3` |
| `experiments/README.md` | How to rerun; what is reused from production; the neighborhood's bounds | `c7247a3` |
| `experiments/results.json` | Machine-readable results | `c7247a3` |
| `experiments/scenarios.js`, `extendedNeighborhood.js`, `metrics.js`, `runBenchmark.js`, `vitest.config.js`, `feasibilityCheck.mjs` | Scenarios, experimental search, measurements, runner | `c7247a3` |
| `current-algorithms.md` | Algorithm map of all components, complexity, algorithm vs business rules (Hebrew) | written against `3673ff9`, status note added |
| `meal-planner-analysis.md` | Planner deep dive, objective tables, pseudocode, earlier probe measurements (Hebrew) | written against `3673ff9`, status note added |
| `smart-basket-analysis.md` | Basket deep dive, formula terms, pseudocode (Hebrew) | written against `3673ff9`, status note added |
| `alternatives-comparison.md` | SA mapping, alternatives table, exact-solution discussion (Hebrew) | written against `3673ff9`, status note added |
| `benchmark-plan.md` | The plan written before the experiment; now marked as executed (Hebrew) | written against `3673ff9`, status note added |

Where an older file and this file disagree, this file and the benchmark report win.

Rerun: `npx vitest run --config docs/algorithm-audit/experiments/vitest.config.js` (about six minutes; `npm test` does not pick it up).

## Guidance for Project Book Session

- The next session should use this file and the benchmark report as the authoritative algorithmic evidence when updating Chapters 5, 6, 8 and 9.
- No project-book file was changed in this stage. `docs/project-book/` and `.claude/skills/bettercart-project-book/` are untouched, including the evidence register.
- Known discrepancy to resolve there: the Chapter 6 draft's scoring table and `architecture-notes.md` list the carbohydrate weight as 1; the effective value is 0.25.
- Runtime figures here were measured under Node, not in a browser.
- The extended neighborhood is experimental code under `docs/algorithm-audit/experiments/` and is not production behavior.
