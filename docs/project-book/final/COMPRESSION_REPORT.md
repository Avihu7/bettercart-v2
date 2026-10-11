# Compression report — Submission edition

Date: 2026-10-12. Code baseline: `3471663` (production code untouched).

| | Master edition | Submission edition |
|---|---|---|
| Files | `BetterCart_Project_Book.docx/.pdf` (kept, not rebuilt) | `BetterCart_Project_Book_Submission.docx/.pdf` |
| Content source | `content/` | `content-submission/` |
| Pages | 129 | **39** (target 35–40) |
| Chapters | 9 | 8 |
| Figures (total) | 20 | 13 |
| – technical diagrams | 14 | 9 |
| – screenshots | 6 | 4 |
| Appendices | 6 | 2 (half a page each) |
| References | 21 | 12 (only those cited) |
| Pseudocode blocks | 5 | 4 |
| Yellow placeholders | 15 | 0 |

Typography is unchanged: David 14 / Times New Roman 12, 1.5 line spacing, 2.5 cm margins, centred page number, same table and caption styles. The reduction comes from editing only.

## Page ranges (Submission)

| Part | Pages |
|---|---|
| Cover, abstract (Hebrew + English), contents, abbreviations | 1–4 |
| 1 מבוא | 5–6 |
| 2 תיאור המערכת, דרישות וארכיטקטורה | 7–10 |
| 3 עיבוד קבלות והתאמת מוצרים לקטלוג | 11–16 |
| 4 התאמה אישית ובניית הסל החכם | 17–21 |
| 5 תכנון התפריט השבועי, אופטימיזציה וולידציה | 22–29 |
| 6 תקציב ורשימת הקניות הסופית | 30–32 |
| 7 בדיקות, QA ותוצאות | 33–35 |
| 8 סיכום, מסקנות והמשך עבודה | 36–37 |
| נספחים א–ב | 38 |
| מקורות | 39 |

Chapter 5 is one page over its budget (8 instead of 6–7) and chapter 2 one over (4 instead of 3); chapters 6–8 are at or under budget.

## Sections merged

- Master chapters 2 (requirements, overview) and 3 (technologies, architecture) → one chapter 2.
- The algorithm benchmark and the Simulated Annealing discussion moved from the QA chapter and a separate section into the planner chapter (5.7, 5.8).
- Health score and purchase history: each reduced to one structured subsection (purpose, input, algorithm, output, role, limitation).
- Planner objective: two weight tables → one table.
- QA: twelve sections → five; the receipt results are stated once (table 3.2) and referenced from the QA chapter.
- Limitations: stated once per chapter and once in the conclusions.

## Sections removed from the Submission edition

- Lists of figures and of tables; the terminology table (a short abbreviations table remains).
- Requirements tables, user-flow figure, end-to-end data-flow table.
- Client layers, state flow, API table, generic CRUD, per-table schema description, security hardening details.
- Catalog field description, receipt insights, backward-compatibility notes.
- Health-score tables (three), the meal-role and meal-template tables, validator table.
- Basket: need table, explanation table, replacement details.
- Planner: the per-scenario benchmark table, regression analysis per scenario, neighbourhood figure.
- Budget: spending classes, confidence levels, budget card description, monthly comparison, budget figure, final-list figure and pseudocode.
- QA: per-day menu tables, basket scenario table, security table, performance table, receipt-input error table.
- Appendices: install details, API reference, benchmark scenarios, bug table, repository map.

## Material moved out (still in the repository)

- Full master edition: `BetterCart_Project_Book.pdf` (129 pages).
- QA evidence: `docs/project-book/qa/`.
- Algorithm audit and benchmark data: `docs/algorithm-audit/`.

## Technical material deliberately preserved

- Receipt pipeline end to end, with the AI boundary, server-side key, schema-enforced output and the reason for it.
- Catalog matching: problem statement, three tiers, confidence formulas, thresholds in two layers, one flowchart, one pseudocode block, complexity, alternatives.
- Health score and purchase history with the exact implementation values (0.55 / 0.20 / 0.25, 30-day half-life, 12-receipt window, shrinkage by N/5, regular-product thresholds).
- Smart Basket as a deterministic quota-guided greedy heuristic: hard filters, anchor, nine needs, `candidateScore` (0.30 / 0.25 / 0.20 / 0.15 / 0.10), worked example, pseudocode, flow diagram, budget trim order, alternatives table, complexity.
- Weekly planner: 7×4 state, C^28 search space, hard constraints via candidates, objective with all weight groups (carbohydrate weight 0.25), greedy and local-search pseudocode, acceptance and stopping rules, complexity, four variants, lexicographic selection.
- Balancing as post-processing (calories → protein → fat) with the known meal-rule limitation; validator as a separate layer; "planner objective ≠ validator".
- Extended Neighbourhood experiment with the exact results (9/10 objective, 3/3/4, 10/10 valid, deterministic, 457.3 → 1,221.4 ms) and the decision to keep the current algorithm.
- Simulated Annealing as considered, not implemented, not measured.
- Budget as a strong goal and not a hard constraint; the basket-vs-menu cost limitation; the worked shopping-list example.
- QA headline numbers (402 + 6 tests, 35 days, 27 isolation requests) and the "not tested" statements.

## New evidence added in this phase

`receipt_example2.jpeg` (a phone photo of a real, crumpled store receipt) was run once through the unchanged production pipeline. Result: `docs/project-book/qa/evidence/receipt-example2-results.json`; write-up appended to `docs/project-book/qa/final-qa-report.md`; used in table 3.2 and in sections 3.6, 7.2, 8.1 and 8.3 of the Submission edition. It is presented as qualitative evidence only; no accuracy rate is derived.

## Visual QA

Every page of the Submission PDF was rendered and inspected (three full passes of contact sheets, plus re-inspection of the pages changed by each fix). Corrections made: a contents page spilling onto a nearly empty page (now shared with the abbreviations table); a formula that wrapped inside its cell (split into two lines); a worked example whose inline arithmetic was reordered by the RTL layout (replaced by a small table); a results table split across pages (tables of up to 14 rows are now kept together); near-empty pages at the ends of chapters 2, 4, 6, 7 and 8 (text tightened); an appendix with code spans breaking across lines (rewritten); appendices moved before the references, as the guidelines order them.

## Remaining yellow placeholders (need Aviad's input)

None. All three were supplied by the authors on 2026-10-12 (motivation §1.1, products examined §1.3, catalog provenance §3.3) and inserted as written.

## References

Verified online on 2026-10-11/12 (author, title, venue, volume, pages): [1] Stigler, [2] Dantzig, [4] Navarro, [6] Kirkpatrick et al., [7] Mifflin et al., [8] Frankenfield et al.
Corrected by the check: [9] Provos & Mazières — pages 81–92 (the master says 81–91 and "FREENIX Track"; the master was not changed).
Finalised on 2026-10-12 as instructed by the authors: [3] Huang et al. with pp. 1516–1520 and DOI 10.1109/ICDAR.2019.00244 (pages and DOI supplied by the authors; the online check here confirmed the paper but could not confirm the DOI); [5] Russell & Norvig, 4th ed., Pearson, 2020; [10] Claude Platform documentation, https://platform.claude.com/docs (site confirmed online), accessed 12.10.2026.
Added on 2026-10-12 at the authors' request: [11] Shufersal and [12] Rami Levy price-transparency pages; both URLs were supplied and checked by the authors (access date written as 12.10.2026).
Dropped because they are no longer cited: CORD, Hoos & Stützle, Glover, ISSN position stand, RFC 6265, OWASP, SQLite, React, Express, Vite, Tel-Hai guidelines.
