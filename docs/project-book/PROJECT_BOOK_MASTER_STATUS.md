# BetterCart Project Book — master status

Control panel for the academic Project Book. Updated 2026-10-11.

## Current state

| Item | State |
|---|---|
| Deliverables | `final/BetterCart_Project_Book.docx` (editable master), `final/BetterCart_Project_Book.pdf` (129 pages, A4, RTL) |
| Status | **First complete submission candidate — waiting for Aviad's review.** Not committed, not pushed. |
| Code baseline | `3471663` on `feat/basket-menu-fixes` (QA baseline `c7247a3`; the two differ only in `docs/algorithm-audit/`) |
| Production code | Untouched in this phase (`git diff -- src/ server/ tests/` is empty) |
| Format | Hebrew David 14, English Times New Roman 12, 1.5 line spacing, centred page number, 3 heading levels |

## Where things are

| Path | What |
|---|---|
| `final/content/*.md`, `final/content/meta.json` | The book's content and cover data — edit here, then rebuild |
| `final/figures/src/*.html` → `final/figures/*.png` | 14 technical diagrams (rendered with Chrome), 6 screenshots |
| `final/build/` | `build.cjs` (content → DOCX), `export_pdf.sh` (Word → PDF), QA helpers, `README.md` |
| `draft/` | Draft 1 (superseded by `final/content`; kept as history) |
| `qa/` | Final QA report and raw evidence |
| `../algorithm-audit/` | Algorithm freeze, audit and the Extended Neighborhood benchmark |

Rebuild: `cd final/build && npm install && node build.cjs && ./export_pdf.sh`.
Manual edits made directly in the DOCX are overwritten by `node build.cjs`.

## Structure

Cover · contents · list of figures · list of tables · abstract (Hebrew + English, one page) · abbreviations and terms ·
1 מבוא · 2 דרישות ותיאור כללי (incl. algorithm map) · 3 טכנולוגיות וארכיטקטורה · 4 עיבוד קבלות והתאמה לקטלוג ·
5 התאמה אישית והסל החכם · 6 תכנון התפריט, אופטימיזציה וולידציה · 7 תקציב ורשימה סופית ·
8 בדיקות, QA והערכת האלגוריתמים · 9 סיכום, מסקנות והמשך עבודה · נספחים א–ו · מקורות (21).

## Missing information from Aviad / Noam (highlighted in yellow in the book)

1. Official project title in Hebrew and in English (cover carries a working title).
2. Full names and ID numbers of both authors.
3. Supervisor's name and academic degree; partner company, if any.
4. Semester and year of submission.
5. Personal motivation for choosing the topic (§1.1).
6. Existing products actually examined during the project, if any (§1.5).
7. Catalog provenance: how and when `products.db` was imported, and the source of its nutrition values (§4.4.1).
8. Division of work between the authors (Appendix ו).
9. Whether to add an acknowledgements page (optional by the guidelines; not included).

## References that still need confirmation

All 21 entries were written from known bibliographic data and were **not** re-checked online in this phase.
- [3] SROIE and [4] CORD: confirm page numbers / venue wording.
- [11] ISSN position stand: cited as overlapping the protein range; confirm it is acceptable to cite, since the code does not name its source.
- [13] bcrypt paper: confirm page range.
- [15]–[20] web documentation: confirm URLs and replace the access date with the real one.
- [21] Tel-Hai guidelines: confirm the document's official title and year.

## Statements written as "design decision" because no source exists in the repository

Health-score base values and adjustments (§5.1) · purchase-history weights, half-life, window (§5.2) ·
basket score weights (§5.5) · planner weights (§6.4.2) · activity factors, ±400 kcal, protein and fat constants (§6.1.2) ·
reference nutrition values and plausibility ranges (§6.7.1) · the reason for single-chain operation (§4.4.2) ·
the reason for the earlier generative → deterministic change (§1.6) · the earlier budget model (§7.1.1).
If Aviad or Noam have the real source or reasoning, replace the neutral wording.

## Known gaps in the evidence (stated in the book as "not tested")

Real store receipts · labelled matching accuracy · browser / load performance · estimated vs. real purchase cost ·
password-reset e-mail end to end · printed output · other browsers and mobile width · Simulated Annealing (considered only).

## Checks done on the candidate

- Built DOCX opened, fields refreshed and re-saved by Microsoft Word; PDF exported by Word (fonts embedded: David, Times New Roman, Cambria Math, Courier New).
- Visual inspection of rendered pages: cover, contents, lists, abstract, abbreviations, algorithm map, architecture, ER diagram, receipt chapter, matching flow, basket pseudocode, planner pseudocode, SA discussion, balancing limitation, budget, worked example, benchmark tables and chart, screenshots, appendices, references.
- Text scan of the PDF: no `VERIFY` / `FINALIZE` markers, no raw markup; 15 intentional "להשלמה" placeholders.
- The DOCX XSD validator of the docx skill could not run (missing Python module `defusedxml`); Word's own open/save was used instead.

## Open review points for Aviad

- Length: 129 pages. The guidelines give no limit; if a shorter book is wanted, the natural cuts are §3.3–3.4, §5.8, §6.2–6.3 and Appendix ה.
- Screenshots 01 (onboarding) and 08 (print view) exist in `assets/screenshots/` and are not used.

## Submission edition (added 2026-10-12)

| Item | State |
|---|---|
| Files | `final/BetterCart_Project_Book_Submission.docx` / `.pdf` — **39 pages**, 8 chapters, 2 short appendices, 12 references |
| Source | `final/content-submission/` (the master in `final/content/` and its DOCX/PDF were not touched) |
| Rebuild | `cd final/build && BOOK_CONTENT=../content-submission node build.cjs ../BetterCart_Project_Book_Submission.docx && ./export_pdf.sh ../BetterCart_Project_Book_Submission.docx .. BetterCart_Project_Book_Submission` |
| Confirmed details inserted | Hebrew title, approved English title, both authors with ID numbers, supervisor, year 2026, division of work (Appendix א) |
| New evidence | one run of `receipt_example2.jpeg` through the production pipeline (`qa/evidence/receipt-example2-results.json`) |
| Report | `final/COMPRESSION_REPORT.md` — what was cut, kept, verified and what is still open |

Still open for the Submission edition: no yellow placeholders (motivation §1.1, products examined §1.3 and catalog provenance §3.3 were supplied by the authors on 2026-10-12) and no open references (finalised 2026-10-12; the DOI of [3] was supplied by the authors and not independently confirmed). The master edition still carries the old placeholders and the unverified 21-entry reference list.
