# Draft 1 — Status

> **Updated 2026-10-11 after the pre-final QA and bug-fix stage.** The sections below the line "Git Snapshot Used"
> are the Draft 1 record; this block is the current state.

# QA Status (2026-10-11)

Full record: `docs/project-book/qa/final-qa-report.md`. Raw data: `docs/project-book/qa/evidence/headless-qa-results.json`.

| | |
|---|---|
| Worktree | HEAD `3673ff9` + uncommitted fixes. **No submission commit exists yet.** |
| Automated | `npm test` 402 passed / 6 skipped / 0 failed · `npm run test:integration` 6 / 6 · lint exit 0 · build OK · `git diff --check` clean |
| Browser end-to-end | PASS — register → onboarding → real receipt (image) → review → manual match → basket → replace / remove / alternative → weekly plan → rebuild → budget → final list → results → print page → refresh → logout / login |
| Real receipt AI | Works; one photographed **sample** receipt read as image and as PDF. Store receipts: NOT TESTED |
| Two-user isolation | PASS (27 requests) |
| Basket / planner / budget / final list | PASS, with documented limitations |
| Acceptance gate | Passed, with three open conditions: store receipts, key rotation if earlier builds were shared, commit |

## Issues fixed in this stage

| # | Issue | Planned / found in QA |
|---|---|---|
| A | "דג" inside "דגנים" — classifier and 508 catalog rows | planned |
| B | Pet food marked as food — rule and 233 catalog rows | planned |
| C | Anthropic key in the browser → server-side | planned |
| D | PDF upload did not work → works; accepted types tightened | planned |
| E | Receipt reading failed on "750 מ"ל" (invalid JSON) → schema-enforced answer | found in QA |
| F | History regular duplicated a receipt item | found in QA |
| G | Pickled / honey variant auto-matched to the plain product | found in QA |
| H | "150X3ג" read as 3 g (tuna at ₪7,300 per kg) | found in QA |
| I | One egg carton charged as two | found in QA |

## Draft text changed because of the fixes

- `02` §2.4, §2.5.1, §2.5.3; `03` §3.2, §3.2.1, §3.4.1, §3.4.4, §3.6.5; `04` §4.1, §4.2.2, §4.2.3, §4.7; `05` §5.1.4, §5.3.2; `06` §6.8; `00` abstract (test counts); `08` rewritten with evidence; `09` limitations and alternatives.
- Each changed chapter carries a comment line at the top saying it describes the uncommitted worktree.
- **Still to do in Draft 2:** §3.6 needs one more sentence on the AI routes in the security list; §4.2.2 should describe the strict tool call in the pseudo-flow; chapter 2's non-functional table can now cite measured timings (row ל-9).

## Remaining limitations (for chapters 4, 6, 8, 9)

1. Receipt reading verified on one sample receipt only; no accuracy figure.
2. Catalog matching recall — a quarter to a third of ordinary lines needed the user; variants accepted automatically.
3. Keyword classification (fish in oil → oil; a cereal with "פירות" in its name → fruit; non-food rows still flagged as food in the catalog).
4. Tight budget: basket fits, menu overruns (shown as level 3).
5. Household reserve from one or two receipts applied in full.
6. High calorie targets met by stacking carbohydrates.
7. Balancer ±3% vs validator ±5% (1 of 35 days between the two).
8. Alternative-menu labels name the variant, not the outcome.
9. Saved plans and lists accumulate.
10. Stale interface text on the landing and upload pages.
11. No automated tests for routes, auth, isolation, pages.
12. Not tested: password-reset email, printed output, accepted-budget flow in the UI, warning on removal in the UI, other browsers, mobile, concurrency.

## VERIFY markers after this stage

| File | Before | Now | Resolved by QA |
|---|---|---|---|
| 00-front-matter.md | 10 | 10 | — (the results sentence can now be written from the QA report) |
| 01-introduction.md | 6 | 6 | — |
| 02-requirements-system-overview.md | 3 | 3 | the response-time marker can now cite §8.10 |
| 03-technologies-architecture.md | 3 | 3 | — |
| 04-receipt-processing-catalog.md | 10 | 7 | PDF upload; re-measure of §4.7; reach of the two catalog defects |
| 05-personalization-smart-basket.md | 2 | 2 | — |
| 06-weekly-meal-planner.md | 6 | 5 | effect of the grain/fish defect on the menu |
| 07-budget-final-list.md | 3 | 3 | — |
| **Chapters 1–7** | **33** | **29** | |
| 08-testing-results-outline.md | 1 | 2 | (new: re-run on the submission commit) |
| 09-conclusions-outline.md | 6 | 6 | — |
| **All draft files** | **50** | **47** | |

Markers that QA made answerable but that still need wording by a person: model IDs (accepted by the API; documentation reference missing), abstract results, response times, estimated-vs-real cost (still not measured).

What still needs Aviad / Noam is unchanged: cover details, motivation, existing solutions, catalog provenance, nutrition sources, the reasons for the AI → deterministic change, team roles, supervisor requirements. Two questions from `open-questions.md` are now closed: #21 (catalog defects — fixed) and #33 (PDF — works). New: confirm the fixes, commit them, and decide about key rotation.

---

# Git Snapshot Used

| | |
|---|---|
| branch | `feat/basket-menu-fixes` (= `origin/feat/basket-menu-fixes`) |
| commit | `3673ff9` — fix: QA round 8 — suggest "בנייה מחדש" only when another valid menu exists |
| date | 2026-10-11 (commit dated 2026-10-08) |
| working tree | no tracked file modified; untracked: `docs/project-book/`, `project_book/`, `receipt_example.png`, two stray `server/products 2.db-*` files |
| code changed since the preparation phase | no — same commit |

Checks run for this draft, all on `3673ff9`, 2026-10-11:
- `npx vitest run` → 24 files passed, 1 skipped; 317 tests passed, 6 skipped.
- `npm run lint` → exit code 0, no errors.
- Not run: `npm run test:integration`, `npm run build`.
- Catalog numbers: from the read-only queries of the same day (not re-queried; database file unchanged since 2026-10-08).

# Chapters

Completeness is an estimate of how much of the final text exists, not of its polish.

| Chapter | Draft Status | Evidence Status | Missing Information |
|---|---|---|---|
| 00 Front matter | Skeleton + abstract draft (HE + EN) + abbreviations and glossary. ~50% | Abstract statements verified; results sentence is a placeholder | Cover details (title, names, IDs, supervisor, semester); acknowledgements; results for the abstract |
| 1 Introduction | Full draft. ~65% | System facts verified; motivation and related work are framing only | Original motivation; solutions actually reviewed; academic references; reasons for the AI→deterministic change |
| 2 Requirements and overview | Full draft. ~85% | Requirements derived from verified features; AI boundary verified by code search | Original requirements document, if any; measured response times |
| 3 Technologies and architecture | Full draft. ~85% | All statements traced to code | Library versions at the submission commit; whether client-side algorithms were a deliberate decision |
| 4 Receipt processing and catalog | Full draft. ~80% | Code and database verified; limitations measured | Catalog source and import process; nutrition-data source; model IDs confirmed; PDF upload; OCR and matching accuracy |
| 5 Personalization and smart basket | Full draft. ~90% | Formulas, weights, thresholds copied from code | Whether health-score values and weights have a source |
| 6 Weekly meal planner | Full draft. ~85% | Algorithm, weights, tolerances verified in code | Scientific sources for target formulas and reference values; how weights were tuned; intent of the ±3% / ±5% gap |
| 7 Budget and final list | Full draft. ~85% | Model, formulas and UI labels verified in code | Reason for the budget-model change; details of basket-page saving suggestions |
| 8 Testing and results | Outline only (as instructed). ~15% | Automated test and lint results recorded; everything else pending | Full manual QA; real receipts; isolation tests; performance; scenario tables |
| 9 Conclusions | Outline only (as instructed). ~15% | Bullet points from verified evidence only | QA results; team's own retrospective |

**Overall for chapters 1–7: about 80%** as technical content. What is missing is mostly external information (people, sources, provenance), not system description.

Length: chapters 1–7 ≈ 19,700 words in Markdown (including tables and pseudocode). Chapters 5 and 6 are the longest by design.

# Structure decisions to review

The section structure follows the Draft 1 brief. Differences from the table of contents proposed in the preparation phase (`.claude/skills/bettercart-project-book/working/project-book-status.md`):

1. **Profile and nutrition targets** have no section of their own in the brief. They are placed in §6.1.2 (planner goals), because the planner is where they are enforced. Alternative: a §5.1 before the health score, as in the earlier proposal.
2. **Chapter 2 §2.4** uses a table instead of a second figure; one figure (2.1) covers user flow and data flow.
3. **Chapter 5 has a short §5.9** and **chapter 7 a short §7.8** linking to the next stage; remove if the supervisor prefers no summary sections.
4. **Rebuild / alternatives** are in §6.7.5 (under validation, as the brief lists "rebuild logic" there) and §5.8.3 for baskets.
5. **No standalone UI chapter**, as agreed in the proposed outline; screens appear where the feature is explained.
6. Several sections use a third heading level (e.g. 5.5.1). No fourth level is used.

# Verified Claims

Each is recorded with its source in `.claude/skills/bettercart-project-book/templates/evidence-register.md`.

- AI is used only to read the receipt, in two calls (image transcription, line extraction), both sent from the browser. No AI call in `server/`. No AI in basket, menu, validation, budget or final list.
- The AI prompt asks only for printed data; classification, category, menu fit, health score, nutrition and insights are computed by rules.
- Two SQLite databases: user data (8 tables, WAL, ownership by `created_by`) and a read-only product catalog.
- The main algorithms run in the browser; the server stores results and computes catalog matching, health score on save, purchase history and authentication.
- Authentication: bcrypt cost 12; 256-bit session token in an HttpOnly cookie, SHA-256 stored; ownership scoping on every query; protected fields stripped; 404 for another user's row; login and reset throttling; single-use 30-minute reset tokens.
- Catalog: 82,564 rows, 39,345 distinct names, Shufersal only active, calories on ~30% of rows, prices dated May 2026.
- Catalog matching: three search tiers, confidence formulas, server thresholds 0.85 / 0.75 / 0.70, plus a stricter client rule.
- Health score: fixed scores → group base → name adjustments → clamp 0–10; recomputed by the server on every save.
- Purchase history: window of 12 receipts; raw = 0.55·frequency + 0.20·recency + 0.25·quality; half-life 30 days; confidence = min(N/5, 1); score = 0.5 + confidence·(raw − 0.5).
- Smart basket: receipt + regulars as anchor; hard filters before ranking; nine ordered needs; candidateScore = 0.30·nutrition + 0.25·health + 0.20·history + 0.15·price + 0.10·variety; deterministic tie-breaks; duplicate rules; budget-aware selection and trim order; reasons on every added item; deterministic alternatives.
- Weekly planner: always 7 days Sunday–Saturday, 4 slots; candidate meals from patterns; objective = Σ meal score − weekly penalty; greedy + fixed-order local search (≤ 6 passes); four weight variants; best week chosen after balancing and validation.
- Balancing priority calories → protein → fat → carbohydrates; closure at ±3%.
- Validator: six areas, four quality levels, calories ±5%; level 4 and incomplete weeks are never saved.
- Budget: weekly = monthly × 7/30; household reserve from receipt history; food budget = weekly − reserve (or an accepted amount); three statuses; receipts are history only.
- Final list: weekly usage +10%, cooked→dry, purchase units rounded up, one pricing model; menu cost equals list cost.
- 317 automated tests pass; lint passes.

# VERIFY Markers Remaining

Counted with `grep -o "\[VERIFY:"`.

| File | `[VERIFY]` | `[FINALIZE AFTER QA]` |
|---|---|---|
| 00-front-matter.md | 10 | 2 |
| 01-introduction.md | 6 | 0 |
| 02-requirements-system-overview.md | 3 | 0 |
| 03-technologies-architecture.md | 3 | 0 |
| 04-receipt-processing-catalog.md | 10 | 0 |
| 05-personalization-smart-basket.md | 2 | 0 |
| 06-weekly-meal-planner.md | 6 | 0 |
| 07-budget-final-list.md | 3 | 0 |
| **Chapters 1–7** | **33** | 0 |
| **Front matter + chapters 1–7** | **43** | 2 |
| 08-testing-results-outline.md | 1 | 1 |
| 09-conclusions-outline.md | 6 | 12 |
| **All draft files** | **50** | **15** |

By kind (front matter + chapters 1–7, total 43):
- Cover and academic details: 8.
- Answers needed from Aviad / Noam (motivation, history, design intent, how constants were chosen): 13.
- Needs a test or measurement (reading accuracy, matching accuracy, PDF upload, model IDs, performance ×2, cost gap, defect reproductions ×3): 10.
- Catalog provenance: 3.
- Existing solutions and academic literature: 2.
- Scientific / nutrition sources: 2.
- Refresh at the submission commit (versions, catalog numbers): 2.
- Results for the abstract (one per language): 2.
- More code reading: 1 (basket-page saving suggestions).

# QA-Dependent Sections

- Whole of chapter 8 and chapter 9.
- Abstract: results and conclusion sentences.
- §2.2 requirement ל-9 (response times).
- §4.1 (PDF upload), §4.2 (model IDs, reading accuracy), §4.5.4 (matching accuracy).
- §4.7 — every number must be re-measured at the submission commit; wording depends on whether the two catalog defects are fixed.
- §5.1.4, §6.8 item 2 — consequences of the grain/fish defect, to be reproduced end to end.
- §6.4.3 — run time.
- §7.4.4 — estimated vs real cost.
- All screenshots (to be taken during the final QA run).

# User Input Required

Full list: `open-questions.md` (37 items). The ones that block text:

1. Cover details: project title (HE / EN), full names and IDs, supervisor and title, semester.
2. Original motivation for the project (§1.1).
3. Existing solutions actually reviewed, and whether to do a short literature review now (§1.5).
4. Catalog provenance: where `products.db` came from, how it was imported, source of nutrition values (§4.4).
5. Sources for the nutrition formulas and reference values (§6.1.2, §6.5.1).
6. Why AI generation of the basket and menu was replaced, and what was observed (§1.6, §2.5, §9.2).
7. Decision on the two open catalog defects: fix or document.
8. Submission commit / branch.
9. Real receipts and an API key with credit, or a decision to report reading accuracy as not measured.
10. Supervisor requirements not in the slides (length, citation style, number of chapters).

# Official-guideline notes

- **Number of chapters.** The Tel-Hai slides say "usually 5–6 chapters"; the draft has 9. To confirm with the supervisor.
- **Abstract.** The slides ask for about half a page, Hebrew on the top half and English on the bottom half of one page. The current two abstracts together are longer than one page and must be cut to roughly 120–150 words each.
- **No code listings in the body.** The draft uses pseudocode blocks (6 short ones) and formulas, no source listings. Confirm pseudocode is acceptable in the body; otherwise move it to appendix ה.
- **Third person / passive.** Applied throughout. Quoted UI strings keep their original first-person wording ("הוספנו…", "שמרנו…") because they are quotations.
- **Three heading levels.** Respected.
- **References.** None yet; the slides require every relied-upon source to be listed. Plan in the evidence register.
- **Readme.** Required in the submission package; the repository has none.
- **Previous work** is an expected part of the introduction; §1.5 is currently a framing paragraph with two [VERIFY] markers.

# Known weaknesses of Draft 1

- Hebrew was written directly as technical prose and has not had a language edit; some sentences are dense, and terminology should be checked against the glossary in `00-front-matter.md`.
- Tables are heavy in chapters 5–6; some may read better as figures after layout.
- Mathematical formulas are written inline as plain text; they need equation formatting in Word, and LTR/RTL mixing must be checked there.
- The health-score tables (§5.1.3) summarise long keyword lists; wording should be re-checked against `healthScore.js` before final.
- `ShoppingListPage.jsx`, `ReceiptResults.jsx`, `NutritionPlanPage.jsx` and `basketBudget.js` were read selectively; statements about them rest on the library modules they call.

# Next Recommended Step

1. Aviad reviews chapters 5 and 6 first (the algorithmic core) for technical accuracy and level of detail, then 3, 4, 7, then 1–2.
2. Aviad / Noam answer the ten blocking items above; the rest of `open-questions.md` can follow.
3. Decide on the two catalog defects and fix the submission commit.
4. Run the final QA on that commit (chapter 8 outline lists exactly what to record), including real receipts if possible, and take the screenshots during that run.
5. Then: Draft 2 (apply answers, write chapters 8–9, draw the 10 diagrams, references) → DOCX → visual review → PDF → final checklist.
