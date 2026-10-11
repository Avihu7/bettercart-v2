# BetterCart v2 — Final QA Report (pre-final QA and bug-fix stage)

Status of this document: evidence for chapter 8 of the project book. It records what was run and what came out. Nothing here is a benchmark or a statistical claim.

Legend: **PASS** · **FAIL** · **NOT TESTED** · **BLOCKED** · **LIMITATION** (works as built, with a documented weakness).

---

# Environment

| | |
|---|---|
| Date | 2026-10-11 |
| Repository | `bettercart_v2`, branch `feat/basket-menu-fixes` |
| HEAD | `3673ff9` (unchanged — nothing was committed) |
| Worktree | HEAD + the uncommitted changes listed under "Files changed". All results below are for this worktree, not for `3673ff9` alone |
| Machine | Apple M1 Pro, 16 GB, macOS 26.6.2 |
| Node / npm | v22.21.0 / 10.9.4 |
| Browser | Google Chrome (desktop), window 1280×900, driven through browser automation |
| Servers | `npm run dev:full` — Vite on `http://localhost:5173`, API on `http://localhost:3001` |
| Receipt AI | Real calls to the Anthropic API from the server (`ANTHROPIC_API_KEY`, account had credit). Models as in `server/ai.js`: `claude-sonnet-5` (file transcription), `claude-haiku-4-5-20251001` (line extraction). Both IDs were accepted by the API on this date |
| Catalog | `server/products.db` after the repair script of this stage |
| Accounts | Throwaway accounts on `example.com` addresses, created for this run. They remain in the local `server/bettercart.db` (git-ignored) |

How the QA was done:

1. **Automated suites** — `npm test`, `npm run test:integration`, `npm run lint`, `npm run build`.
2. **Headless QA harness** — `docs/project-book/qa/scripts/headless-qa.mjs`, run with `npx vite-node`. It imports the application's own modules (the same code the pages call), talks to the running API with real sessions, and writes `docs/project-book/qa/evidence/headless-qa-results.json`. Seven accounts, 30 steps. It records results; pass/fail below is my reading of them.
3. **Browser run** — one demo account (`demo@example.com`) through the whole UI flow, with the sample receipt image uploaded through the upload control. Screenshots were taken during this run.

Limits of the method, stated once: the harness approves "needs review" suggestions automatically and picks the first search result for unmatched lines, so its baskets contain a few products a careful user would not choose (e.g. pickled cucumbers). The browser run made these choices by hand.

---

# Automated Tests

| Command | When | Result |
|---|---|---|
| `npx vitest run` | before any change (baseline, `3673ff9`) | 24 files passed, 1 skipped · 317 tests passed, 6 skipped |
| `npm run lint` | baseline | exit 0 |
| `npm test` | final worktree | **25 files passed, 1 skipped · 402 tests passed, 6 skipped · 0 failed** · 14.9 s |
| `npm run test:integration` (API running) | final worktree | **1 file passed · 6 tests passed · 0 failed · 0 skipped** · 8.8 s |
| `npm run lint` (ESLint, `--quiet`) | final worktree | **exit 0, no errors** (`--quiet` hides warnings) |
| `npm run build` | final worktree | **success** — 2,450 modules, JS bundle 878 kB (270 kB gzip). Vite warns that the bundle is over 500 kB; not an error |
| `git diff --check` | final worktree | **clean** |

The file skipped by `npm test` is `tests/integration/catalog.test.js` (6 tests); it needs the API and is the file `npm run test:integration` runs. So every existing test ran in one of the two commands, and none failed.

Tests added in this stage: `tests/preFinalFixes.test.js`, 85 tests (402 − 317), one group per fix (A–I below).

Not covered by automated tests (unchanged): Express routes, authentication and user isolation, React pages. These were checked with the harness and the browser run only.

---

# Targeted Bug Fixes

Four issues were planned (A–D). Five more were found during the QA itself (E–I); each was reproduced before it was touched, and each is a correctness problem in the core flow. All changes are bug or security fixes; no feature was added.

## A. "דג" inside "דגנים" — FIXED

- **Problem.** Grain products were treated as fish: `לחם דגנים מלאים`, `פריכיות דגנים`, `חטיף דגנים`, `פסטה מדגנים מלאים` → food group `fish`. A multigrain bread became a main protein, got the fish health base (9), and was excluded for vegetarians and fish allergy.
- **Root cause — two layers (case C of the brief: both).**
  1. Runtime: `classifyProduct` (`src/lib/mealPlanRules.js`) matches terms by substring, and the fish group had the bare term `"דג"`, tested before bread and grain.
  2. Catalog data: the import had the same mistake. Rows with the letters "דג" anywhere in the name were filed `sub_category = 'fish'`, `category = 'protein'`, with a generic fish nutrition profile (130 kcal / 22 g protein, source "USDA average").
- **Fix.**
  1. The term is now a word pattern: "דג" / "דגים" / "דגי", optionally with a one-letter Hebrew prefix, and not followed by another Hebrew letter. Two terms were added so that names that had been fish only through those letters stay fish: `קרפיון` (catalog name "דגקרפיון…") and the fish brand `דלידג`. No product exception list.
  2. `server/scripts/repair-fish-and-pet.js` (dry run by default, `--apply` to write, idempotent). It touches only rows filed as fish whose name contains the letters "דג", is not fish by the fixed classifier and is not another protein food. Such a row gets the category of its real food group and the catalog's own "no nutrition data" state; no nutrition values are invented. A backup of `products.db` was taken first (and the file is tracked in git).
- **Counts.** Dry run and apply gave the same numbers: **508 rows re-filed** (Shufersal 366, Rami Levy 142; 252 distinct names) → bakery 102, carb 93, fruit 34, vegetable 3, other 276. 6 rows that the classifier reads as another protein were listed and left. 596 rows filed as fish through other fish words were not touched. A second run changes 0 rows.
- **Verification.**
  - Old vs new classifier over every distinct catalog name: 245 names changed group, all away from `fish`; of the 120 names that are still fish through the word "דג", a sample was read and all were fish products.
  - `דג`, `דג סלמון`, `פילה דג`, `דגים טריים`, `קציצות דגים`, `דגי ים` → `fish`. `דגנים` → `other`; `לחם דגנים`, `לחם דגנים מלאים`, `פריכיות דגנים` → `bread`; `דגני בוקר` → `cereal` (unit tests, group A).
  - Shufersal food rows with "דגנ" in the name and `category = 'protein'`: **310 before, 0 after**.
  - End to end (harness, account B): a receipt line `לחם דגנים מלא 750 גרם` → food, category carb, group bread, health score 7, matched to the catalog row of the same name (now `bakery`).
- **Status: PASS.**
- **Left as it is:** `דג הרינג בשמן` is read as `oil` by `classifyProduct` because the oil term is tested before the general fish term (only tuna, sardines and mackerel are tested before oil). This is older behavior, unrelated to the "דג" letters, and the basket code strips packing liquids before classifying. Recorded under Known Remaining Limitations.

## B. Pet food marked as human food — FIXED

- **Problem.** Cat and dog food had `is_food = 1` in the catalog, many as `protein` ("לה קט פטה סלמון", "פריסקיז…", "סופר קט טונה").
- **Root cause.** Import data. The runtime rule (`src/lib/nonFood.js`) only knew `לחתול` / `לכלב` at a word start and two brands, so it caught none of these names.
- **Could they reach the flow?** Before the fix: a receipt line with such a name was classified as food and could be matched and enter a basket; catalog search returned them. They were not among the basket engine's own candidates (a fixed list of food types).
- **Fix.** One rule, `PET_FOOD`, used by receipt reading and by the repair script: the animal named as a word (`חתול` — except the cheese brand "החתול המחייך" — `חתלתול`, `כלב`, `כלבים`), also when glued to the previous word as some catalog names are; pet-food brands found in the catalog (לה קט, סופר קט, פיין קט, פריסקיז, דוגלי, פיין דוג, גורמה גולד, פנסיפיסט / פנסי פיסט, נייטיב ווי, מונג פרש, פורינה, בונזו); fish feed. It is part of the "never food" rule, so food words in the name (salmon, chicken) do not override it.
- **Counts.** **233 rows → `is_food = 0`, category `pet`** (202 in the first pass: Shufersal 129, Rami Levy 73, 145 names; 31 Shufersal rows / 21 names in a second pass after three more brands were found during QA). Before: 114 of the first 202 were `protein`.
- **Sample before → after.** `לה קט פטה סלמון 100 גרם`: is_food 1, protein → is_food 0, pet. `פריסקיז עוף ברוטב 156גרם`: is_food 1, protein → 0, pet. `דוגלי בוגר בקר 3 ק"ג`: is_food 1, other → 0, pet.
- **Kept as food (checked):** `החתול המחייך גבינה מותכת`, `כדורי מוצרלה קטן`, `פטה כבשים 20%`, `קיט קט`, `קונפיטורה`, `תפוח אדמה גורמה` (unit tests, group B).
- **Verification.** Harness: receipt lines `לה קט פטה סלמון`, `פריסקיז עוף ברוטב`, `דוגלי בוגר בקר` → not food, no health score, not sent to matching, absent from the basket. Catalog search for `לה קט`, `פריסקיז`, `חתול`, `כלב`, `דוגלי`, and the first 20 results for `סלמון`, `טונה`, `פטה`: 0 pet products. `match-items` on three pet names: no match.
- **Status: PASS.** Limit: the rule is a keyword list; a pet brand that is in neither list nor names the animal would not be caught.

Catalog totals: 82,564 rows before and after; food rows 64,620 → **64,387**; non-food 17,944 → **18,177**.

## C. Anthropic API key in the browser — FIXED

- **Before.** `src/lib/ai.js` read `import.meta.env.VITE_ANTHROPIC_API_KEY` and called `https://api.anthropic.com/v1/messages` from the browser with the header `anthropic-dangerous-direct-browser-access`. Any `VITE_` value is compiled into the client bundle, so the key was readable by anyone who could load the app.
- **After.** Browser → `POST /api/ai/receipt-file` or `/api/ai/receipt-text` (session required) → `server/ai.js` → Anthropic. The key is `ANTHROPIC_API_KEY`, read only by the server from `.env.local`. `GET /api/ai/status` returns `{ configured: true | false }` and nothing else; `false` puts the client in demo mode. The two routes do exactly the two receipt requests with fixed prompts; they are not a general proxy. The prompt and schema moved to `src/lib/receiptPrompt.js`, shared with the server. The receipt-reading behavior is otherwise unchanged; the basket and the planner still contain no AI call.
- **Local change outside git:** in `.env.local` the variable was renamed from `VITE_ANTHROPIC_API_KEY` to `ANTHROPIC_API_KEY` (value untouched, not read or printed).
- **Verification.**
  - The built bundle (`dist/assets`) was scanned after `npm run build`: no `sk-ant-`, no `api.anthropic.com`, no `x-api-key`, no `VITE_ANTHROPIC`; it does not contain the value of either key in `.env.local`. It contains `/api/ai/`.
  - Unit tests (group C): no file under `src/` names the provider host, the key header or a `VITE_ANTHROPIC` variable; the client posts to `/api/ai/receipt-text` with the session cookie and only a content-type header; with no key on the server no AI request is made.
  - Live: the AI routes answer 401 without a session; with one, the status answer has the single field `configured`.
  - The server logs status, error type and code only.
- **Status: PASS.**
- **Follow-up for the owner (not done here):** the key was usable from the browser in every earlier build, and `docs/SHARE_LOCAL_DEMO.md` describes sharing a local build with other people. If that was ever done with a real key, **rotate the key**. No key was found in tracked files or in git history (see Secret scan).

## D. PDF receipt upload — FIXED (made to work)

- **Before.** The upload control accepted `image/*,.pdf` and said "PDF, PNG, JPG נתמכים", but every file was sent as an `image` block with its own media type. A PDF could not work, and `image/*` also offered formats the API does not read (e.g. HEIC).
- **Decision.** With the request already moving to the server, supporting PDF is one branch: a PDF goes as a `document` block. That is small and could be tested live, so PDF was made to work rather than removed.
- **Fix.** `fileContentBlock` in `server/ai.js`: JPEG / PNG / WEBP / GIF → `image`, PDF → `document`, anything else → HTTP 415 with code `unsupported_media` and a Hebrew message. The control's `accept` list is now exactly those five types; the caption says "PDF, PNG, JPG, WEBP". Files over 7 MB are refused in the browser with the existing "file too large" message.
- **Verification (live).**

| Input | Result |
|---|---|
| PNG photo of the sample receipt (2.3 MB) | 200 — 24 of 24 lines read (see Real Receipt QA) |
| The same receipt as a one-page PDF (2.8 MB) | 200 — 24 lines extracted |
| `text/plain` | 415 `unsupported_media`, "סוג הקובץ אינו נתמך…" |
| `image/heic` | 415 `unsupported_media` |
| no media type | 415 `unsupported_media` |
| empty file content | 400 `bad_request`, "הקובץ ריק" |
| PNG type with bytes that are not an image | 502, code `unknown` — the provider refuses it; the page shows the general error |
| empty receipt text | 400 |
| receipt text over 20,000 characters | 413 `too_large` |
| any of the above without a session | 401 |

- **Status: PASS.** Limit: a corrupt image is reported with the general message, not a specific one.

## E. Receipt reading failed on Hebrew units ("750 מ"ל") — FOUND IN QA, FIXED

- **Problem.** The first real reading of the sample receipt failed: `Expected ',' or '}' after property value in JSON`. Reproduced 3 of 3 times.
- **Root cause.** The model was asked to answer with JSON as plain text and wrote the quote in `מ"ל` / `ק"ג` unescaped (`"original_name": "שמן זית 750 מ"ל"`). `JSON.parse` fails, so any receipt with such a line could not be read. This is older than the server move; the earlier smoke QA ran in demo mode and could not see it.
- **Fix.** The answer now comes through a tool call the model must make, with the schema enforced by the API (`strict: true`, `additionalProperties: false`, required fields), so the server receives a parsed object. A first attempt without `strict` was not enough: in one run the model sent the item list as a single string.
- **Verification.** After the fix: 6 direct extraction runs (3 from the image, 3 from the PDF), 2 full harness runs (image and PDF each) and the browser run. Every answer was a valid object with 24 items; the quote in `מ"ל` survived (in one PDF run the model itself cut that name short — a reading slip, not a parsing failure). Unit tests (group E) check the request shape and that such text survives.
- **Status: PASS.**

## F. A regular from purchase history duplicated a receipt item — FOUND IN QA, FIXED

- **Problem.** With three receipts, the basket held `חלב תנובה 1 ליטר 3% × 2` (this receipt) and `חלב תנובה 3% 1 ליטר` (history regular) — the same catalog product twice; the same for cottage and chicken breast.
- **Root cause.** `buildBasket` compared a history regular with the basket by name containment only. The receipt AI words the same product differently on different receipts.
- **Fix.** A regular is skipped when the basket already has the same catalog product id, or when it is a duplicate by the engine's own rule (`isDuplicate`: same product, produce family or product type). `src/lib/basketBuilder.js`, one helper.
- **Verification.** Harness, 3 receipts: 0 duplicates; the three regulars are recognized as already present. Unit tests (group F), including that a regular the receipt does not have is still added.
- **Status: PASS.**

## G. A different product accepted as a confident match — FOUND IN QA, FIXED

- **Problem.** `מלפפונים 1.5 קילוגרם` was matched automatically to `מלפפונים בחומץ צנצנת680ג` (pickled), and `קורנפלקס תלמה 750 גרם` to `קורנפלקס דבש 448ג תלמה`.
- **Root cause.** The client rule that blocks "a catalog name that turns the product into another one" listed `במלח`, `כבוש`, `חמוצ`, `מתוק`… but not `בחומץ` or `דבש`.
- **Fix.** Those two words were added to the same list (`src/lib/receiptReview.js`). Such a match is now a suggestion the user must approve.
- **Verification.** Harness and browser run: both lines arrive as "דורש בדיקה". Unit tests (group G).
- **Status: PASS** for these cases. The general weakness remains — see Catalog Matching Sample.

## H. Multipack weight "150X3ג" read as 3 g — FOUND IN QA, FIXED

- **Problem.** In the browser run the basket showed `טונה במים מארז 4 · 3 גרם · ₪7300 לק"ג`. The planner then avoided tuna as far too expensive.
- **Root cause.** `parseQuantityGrams` recognized the multipack sign as `×`, `x` or `*`, not capital `X`; the catalog writes "טונה במים 150X3ג".
- **Fix.** Capital `X` added to that pattern (`src/lib/mealPlanCalories.js`).
- **Verification.** Browser run after the fix: `450 גרם · ₪33.1 לק"ג`; tuna appears in the menu and on the final list as `450 גרם × 3`. Unit tests (group H).
- **Status: PASS.**

## I. One carton of eggs charged as two — FOUND IN QA, FIXED

- **Problem.** The final list in the browser run showed `ביצים L קרטון 12 — תבנית 12 ביצים — ₪69.80`: one carton, the price of two.
- **Root cause.** For eggs the purchase amount was always `cartons × 720 g`, then priced by the item's own pack weight; the basket item's pack was 500 g, so 720 g cost two packs.
- **Fix.** A carton is one pack of the item: its own pack weight is used when it has one (`src/lib/shoppingOptimizer.js`).
- **Verification.** Browser run after the fix: `תבנית 12 ביצים — ₪34.90`; list total ₪485.70 (was ₪520.60). Unit tests (group I).
- **Status: PASS.**
- **Side effect observed, as designed:** the menu saved before this fix carried the old cost; when the page recomputed, the validator's "menu cost = list cost" check failed and the menu was shown as level 3 until it was rebuilt. That is the check doing its job.

---

# End-to-End QA

Browser run, account `demo@example.com`, 2026-10-11, worktree as described. Profile: male, 30, 178 cm, 78 kg, moderately active, maintenance, ₪3,200 per month, 4 shopping trips.

| # | Scenario | Expected | Actual | Status | Evidence |
|---|---|---|---|---|---|
| 1 | Register | Account created, signed in, sent to onboarding | As expected; "החשבון נוצר בהצלחה" | PASS | browser run |
| 2 | Onboarding, 5 steps | Targets computed and saved | 2,709 kcal, protein 125 g, fat 90 g, carbs 350 g, BMI 24.6, BMR 1,748 — equal to the harness computation | PASS | `01-onboarding-calculated-targets.jpg` |
| 3 | Receipt upload (image through the upload control) | Not in demo mode; file accepted | "רשתות נתמכות" notice shown (not the demo notice); PNG accepted | PASS | browser run |
| 4 | Receipt processing (real AI) | Lines read, saved, page moves to review | 24 lines, 19 food / 5 non-food, store "שופרסל דיל", 28/9/2026, total ₪599.90; done within the 25 s waited (not timed precisely) | PASS | `02-receipt-review.jpg` |
| 5 | Receipt review | Uncertain matches wait for the user; non-food listed apart | 11 matched automatically, 8 "דורש בדיקה", 5 non-food lines listed separately; basket button says 8 items remain | PASS | `02-receipt-review.jpg` |
| 6 | Manual match correction | Search the catalog, pick a product | Cucumbers → searched "מלפפון" → picked "מלפפון 1 ק"ג". 5 lines corrected this way, 3 approved as suggested; review list emptied | PASS | `03-manual-catalog-match.jpg` |
| 6a | Search box prefilled with the full receipt name | Useful results | "לא נמצאו מוצרים מתאימים" until the text is shortened by hand | LIMITATION | browser run |
| 7 | Smart basket | Built from the receipt, completed, within budget, reasons shown | 21 products (19 from the receipt, 2 added with a reason); ₪374.70 of a ₪624 food budget | PASS | `04-smart-basket-items-and-reasons.jpg` |
| 8 | Replacement | Similar products offered; choosing one replaces the item | Chicken breast: 3 similar (turkey breast, drumsticks, ground beef) + other protein sources, each marked "שומר על יעד החלבון שלך"; turkey chosen, basket updated | PASS | browser run |
| 9 | Removal | Item removed; warning only when a need is no longer met | Lettuce removed (21 → 20), bread removed (→ 19); no warning — cornflakes still cover the bread/cereal need | PASS | browser run |
| 9a | Removal that breaks a need | Warning | Not exercised in the browser. In the harness, removing every protein gives the issue `protein`, removing bread and cereal gives `bread` | NOT TESTED in UI | harness `A_replace_remove` |
| 10 | Alternative basket ("בחירה מחדש") | Next basket that meets the same goals; wraps around | 1 → "סל חלופי 2 מתוך 3" → "3 מתוך 3" → back to the first; the receipt items stay, the added vegetables change. From the hand-edited basket it returned the recommended one | PASS | browser run |
| 11 | Weekly meal plan | 7 days, 4 meals a day, from the basket | 7 days, Sunday–Saturday, 4 meals each; 18,986 kcal for the week | PASS | `06-weekly-plan-day-view.jpg` |
| 12 | Validation / quality | Quality card with level and summary | "תפריט מגוון, מאוזן ובתקציב — רמה 1 מתוך 4"; 6 protein sources, 5 breakfast styles | PASS | `05-weekly-plan-quality-and-budget.jpg` |
| 12a | Rebuild ("בנייה מחדש") | Different menus in a fixed order, then back to the first | 5 menus (2: saving, 3: protein, 4: balanced, 5: "as different as possible"), then "חזרנו לתפריט הראשון"; all level 1 | PASS | browser run |
| 12b | Label of alternative 2, "עם דגש על חיסכון" | Cheaper than the recommended menu | ₪522.40 against ₪485.70 for the recommended one — the label names the planner variant, not the outcome | LIMITATION | browser run |
| 13 | Budget summary | Five numbers, consistent | ₪747 − ₪123 = ₪624; cost ₪485.70; left ₪138.30; history "לפי קבלה אחת בלבד" | PASS | `05-weekly-plan-quality-and-budget.jpg` |
| 14 | Final shopping list | Quantities from the menu; total = menu cost | 20 products, ₪485.70 = menu cost; tahini listed as not used by the menu | PASS | `07-final-shopping-list.jpg` |
| 15 | Final results | Three tabs with the same data | List total ₪485.70, same rows | PASS | browser run |
| 16 | Print view | RTL page with profile, list and the 7 days | Direction RTL; all seven day names present; total ₪485.70. The print dialog itself was not opened (a native dialog cannot be driven by the automation) | PASS (page) / NOT TESTED (printed output) | `08-print-view.jpg` |
| 17 | Refresh | Data still there | Receipt (19 products, ₪599.90), basket (21), menu (level 1, ₪485.70), final list (₪485.70, 20 products) all reload | PASS | browser run |
| 18 | Logout / login | Logged out → login page, API 401; login → same data | `/login`, API 401; a protected address redirects to login; after login the final list shows ₪485.70 | PASS | browser run |
| 19 | Browser console | No errors | No errors or exceptions reported on the final pages | PASS | browser run |

---

# Real Receipt QA

**What was available:** one receipt image, `receipt_example.png` — a photograph of a printed **sample** receipt ("דוגמה — לא לתשלום", "קבלה לדוגמה לצורכי בדיקה בלבד"), 24 product lines, total ₪599.90. No genuine store receipts were available to this run, and the 3–5 receipts asked for could not be reached. The ground truth was typed from the image by reading it.

No accuracy percentage is claimed. The table counts lines.

| Input | Lines printed | Lines extracted | Names read correctly | Prices correct | Store / date / total | Time (transcribe + extract) | Notes |
|---|---|---|---|---|---|---|---|
| PNG photo, harness (final run) | 24 | 24 | 24 | 24 | all correct | 7.3 s + 11.6 s | — |
| PNG photo, browser run | 24 | 24 | 24 | 24 | all correct | under 25 s in total | 19 food / 5 non-food, classified by rules |
| Same receipt as PDF, harness (final run) | 24 | 24 | 23 | 24 | all correct | 7.5 s + 12.3 s | "שמפו פינוק" read as "שמפו פנטין" (a non-food line) |
| PDF, an earlier run of this stage | 24 | 24 | 23 | 24 | all correct | — | "שמן זית 750 מ"ל" came back as "שמן זית 750 מ" |

Observations:

- The "×2" printed on four lines was kept in the name or put in the quantity field, differently from run to run. The price read is the line price, as printed.
- The cleaned name spells units out ("1 ק"ג" → "1 קילוגרם"). With the unit in the name, an exact catalog match is rarer (see the next section).
- The same image does not always give the same wording. Receipt reading is the one non-deterministic step of the system.

**Status:** reading this one sample receipt — **PASS**. Reading accuracy on real store receipts — **NOT TESTED** (no receipts available). The report must not state an accuracy figure.

Catalog match of the 19 food lines read from the image (harness, automatic step only):

| Line (cleaned name) | Status | Catalog product | Type | Confidence | Health score |
|---|---|---|---|---|---|
| חלב תנובה 1 ליטר 3% × 2 | matched | חלב תנובה 3% 1 ליטר | token | 0.82 | 8 |
| לחם אחיד פרוס | matched | לחם אחיד פרוס | exact | 1 | 5 |
| קוטג' תנובה 250 גרם 5% × 2 | matched | קוטג' תנובה 5% 250 גרם | token | 0.82 | 8 |
| גבינה צהובה עמק 200 גרם | matched | גבינה צהובה עמק 200 גרם | exact | 1 | 5 |
| ביצים L תבנית 30 | not_found | ביצים L קרטון 12 | token | 0.62 | 8 |
| שמן זית 750 מיליליטר | matched | שמן זית  750 מ"ל | exact | 1 | 8 |
| אורז בסמטי 1 קילוגרם | not_found | אורז פרסי סוגת 1 ק"ג | token | 0.62 | 6 |
| חזה עוף טרי 1 קילוגרם | matched | חזה עוף טרי 1 ק"ג | token | 0.83 | 8 |
| פילה סלמון קפוא 700 גרם | not_found | פילה סלמון נתחים 600 גרם | token | 0.69 | 9 |
| קפה נמס עלית 200 גרם | not_found | משקה גו קפה אגוזי לוז340 | token | 0.51 | 6 |
| פסטה ברילה 500 גרם × 2 | matched | פסטה פנה ברילה 500 גרם | token | 0.82 | 6 |
| טונה במים מארז 4 | matched | טונה במים 150X3ג | token | 0.83 | 9 |
| עגבניות 1.5 קילוגרם | matched | עגבניות שרי 500 גרם | token | 0.83 | 10 |
| מלפפונים 1.5 קילוגרם | needs_review | מלפפונים בחומץ צנצנת680ג | token | 0.83 | 10 |
| תפוח עץ פינק ליידי 1 קילוגרם | not_found | תפוח עץ גולדן 1 ק"ג | token | 0.56 | 9 |
| בננות 1 קילוגרם | not_found | תותים ובננות מוקפאים 300 | token | 0.37 | 9 |
| טחינה גולמית 500 גרם | matched | טחינה גולמית 500 גרם סלה | partial | 0.93 | 8 |
| קורנפלקס תלמה 750 גרם | needs_review | קורנפלקס דבש 448ג תלמה | token | 0.8 | 5 |
| שקדים טבעיים 250 גרם | matched | שקדים טבעיים 200 גרם | token | 0.82 | 9 |

11 matched automatically, 2 flagged for review with a wrong-variant suggestion, 6 not found (a suggestion shown; in 3 of them the suggestion is the right kind of product). Of the 11 automatic matches, 7 are the product on the receipt and 4 are a variant of it (penne for "פסטה ברילה", a 3-can pack for "מארז 4", cherry tomatoes for "עגבניות", a 200 g pack for 250 g of almonds).

---

# Catalog Matching Sample

32 product names as they would appear on a receipt, sent to `POST /api/products/match-items`, then through the client's acceptance rule (`matchPatch`). "Correct?" is my judgment from reading each result. This is a hand-picked sample; it says nothing statistical.

| Product (as on a receipt) | Expected | Catalog result (type, confidence) | Status in the app | Correct? |
|---|---|---|---|---|
| חלב תנובה 3% 1 ליטר | חלב 3% | חלב תנובה 3% 1 ליטר (exact, 1) | matched | yes |
| קוטג' תנובה 5% 250 גרם | קוטג' 5% | קוטג' תנובה 5% 250 גרם (exact, 1) | matched | yes |
| גבינה צהובה עמק 200 גרם | גבינה צהובה | גבינה צהובה עמק 200 גרם (exact, 1) | matched | yes |
| יוגורט טבעי 3% | יוגורט | יוגורט עיזים 500 מ"ל (rejected, 0.63) | not_found | miss — product exists under other wording |
| ביצים L תבנית 12 | ביצים | ביצים L קרטון 12 (rejected, 0.62) | not_found | miss — suggestion is the right product (62%), below threshold |
| חזה עוף טרי | חזה עוף | חזה עוף טרי ארוז (partial, 0.89) | matched | yes |
| בשר בקר טחון טרי | בשר טחון | בשר בקר טחון טרי קג (partial, 0.89) | matched | yes |
| פילה סלמון קפוא | סלמון | פילה סלמון קפוא צילה (partial, 0.91) | matched | yes |
| טונה במים | טונה | טונה במים 150X3ג (partial, 0.87) | matched | yes (3-can pack) |
| עדשים אדומות 500 גרם | עדשים | עדשים אדומות 500 גרם (exact, 1) | matched | yes |
| אורז בסמטי 1 ק"ג | אורז בסמטי | אורז פרסי סוגת 1 ק"ג (rejected, 0.62) | not_found | miss — suggests Persian rice |
| פסטה ברילה 500 גרם | פסטה | פסטה פנה ברילה 500 גרם (token, 0.82) | matched | variant (penne) |
| לחם אחיד פרוס | לחם אחיד | לחם אחיד פרוס (exact, 1) | matched | yes |
| לחם דגנים מלא 750 גרם | לחם דגנים | לחם דגנים מלא 750 גרם (exact, 1) | matched | yes (bakery, no longer fish) |
| קורנפלקס תלמה 750 גרם | קורנפלקס | קורנפלקס דבש 448ג תלמה (token, 0.8) | needs_review | flagged correctly — suggestion is honey cornflakes |
| עגבניות | עגבניות | עגבניות שרי 500 גרם (partial, 0.82) | matched | variant (cherry tomatoes) |
| מלפפונים | מלפפונים | מלפפונים במלח 7-9 5 (partial, 0.83) | needs_review | flagged correctly — suggestion is pickled |
| בננות | בננות | תותים ובננות מוקפאים 300 (rejected, 0.72) | not_found | miss — suggests frozen strawberries and bananas |
| תפוח עץ פינק ליידי | תפוח עץ | תפוח עץ גולדן 1 ק"ג (rejected, 0.56) | not_found | miss — suggests Golden apple |
| גזר | גזר | גזר תפזורת (partial, 0.8) | matched | yes |
| שמן זית 750 מ"ל | שמן זית | שמן זית  750 מ"ל (exact, 1) | matched | yes |
| טחינה גולמית 500 גרם | טחינה | טחינה גולמית 500 גרם סלה (partial, 0.93) | matched | yes |
| שקדים טבעיים 250 גרם | שקדים | שקדים טבעיים 200 גרם (token, 0.82) | matched | variant (200 g pack) |
| קפה נמס עלית 200 גרם | קפה נמס | משקה גו קפה אגוזי לוז340 (rejected, 0.51) | not_found | miss — unrelated suggestion |
| ח.עוף טרי | חזה עוף (קיצור) | חזה עוף טרי 1 ק"ג (rejected, 0.58) | not_found | miss — abbreviation; suggestion is right (58%) |
| עגבניה שרי | עגבניות שרי | עגבניה שרי צהוב (partial, 0.89) | matched | yes |
| חטיף במבה 80 גרם | במבה | במבה חטיף בוטנים 200 גרם (token, 0.77) | needs_review | flagged — right product, other pack size |
| קוקה קולה 1.5 ליטר | קולה | קוקה קולה 1.5 ליטר (exact, 1) | matched | yes |
| שמפו פינוק 700 מ"ל | לא מזון | פינוק ת.רחצה מנגו+שקד700 (rejected, 0.58) | non_food | yes — non-food |
| נייר טואלט 24 גלילים | לא מזון | נייר גלגול (rejected, 0.54) | non_food | yes — non-food |
| לה קט פטה סלמון 100 גרם | לא מזון (חיות) | קציצות דג סלמון לבשול 75 (rejected, 0.58) | non_food | yes — non-food (pet) |
| מוצר שלא קיים בכלל xyz | ללא התאמה | שוקיים עוף קפוא (rejected, 0.37) | not_found | yes — no match |

Summary of the 32:

| Outcome | Count | Comment |
|---|---|---|
| Matched automatically | 18 | 15 the product itself, 3 a variant (pasta shape, cherry tomatoes, pack size); none a different product |
| Flagged for review | 3 | all three rightly — a pickled / honey variant, or another pack size |
| Not found | 8 | 1 rightly (a name that does not exist); 7 are products the catalog has under other wording |
| Not food (not sent to matching) | 3 | all rightly |

**Status:** no wrong product was accepted automatically in this sample — **PASS** on safety. Recall — **LIMITATION**: everyday items (yogurt, eggs, basmati rice, bananas, apples, instant coffee, an abbreviated name) needed the user. Causes seen: a quantity or brand in the name prevents the exact and substring tiers, and the token tier ranks candidates by the catalog's own score rather than by closeness to the name. Not changed in this stage (it is the matching algorithm, not a bug).

---

# User Isolation

Two accounts. A has a profile, 3 receipts, 48 receipt items, 2 lists and a plan. B then requests A's data, including by A's real record ids. Harness, real HTTP.

| Request | What | HTTP | Result |
|---|---|---|---|
| `GET /api/userProfile` | B lists userProfile | 200 | 1 rows, 0 of A's 1 |
| `GET /api/userProfile?created_by=user_<id>` | B lists userProfile filtered by A's id | 200 | 1 rows, 0 owned by A |
| `GET /api/receipts` | B lists receipts | 200 | 1 rows, 0 of A's 3 |
| `GET /api/receipts?created_by=user_<id>` | B lists receipts filtered by A's id | 200 | 1 rows, 0 owned by A |
| `GET /api/receiptItems` | B lists receiptItems | 200 | 9 rows, 0 of A's 48 |
| `GET /api/receiptItems?created_by=user_<id>` | B lists receiptItems filtered by A's id | 200 | 9 rows, 0 owned by A |
| `GET /api/shoppingLists` | B lists shoppingLists | 200 | 0 rows, 0 of A's 2 |
| `GET /api/shoppingLists?created_by=user_<id>` | B lists shoppingLists filtered by A's id | 200 | 0 rows, 0 owned by A |
| `GET /api/nutritionPlans` | B lists nutritionPlans | 200 | 0 rows, 0 of A's 1 |
| `GET /api/nutritionPlans?created_by=user_<id>` | B lists nutritionPlans filtered by A's id | 200 | 0 rows, 0 owned by A |
| `PATCH /api/receipts/<id>` | B updates A's receipts | 404 | error |
| `DELETE /api/receipts/<id>` | B deletes A's receipts | 404 | error |
| `PATCH /api/receiptItems/<id>` | B updates A's receiptItems | 404 | error |
| `DELETE /api/receiptItems/<id>` | B deletes A's receiptItems | 404 | error |
| `PATCH /api/shoppingLists/<id>` | B updates A's shoppingLists | 404 | error |
| `DELETE /api/shoppingLists/<id>` | B deletes A's shoppingLists | 404 | error |
| `PATCH /api/nutritionPlans/<id>` | B updates A's nutritionPlans | 404 | error |
| `DELETE /api/nutritionPlans/<id>` | B deletes A's nutritionPlans | 404 | error |
| `PATCH /api/userProfile/<id>` | B updates A's userProfile | 404 | error |
| `DELETE /api/userProfile/<id>` | B deletes A's userProfile | 404 | error |
| `GET /api/receiptItems?receipt_id=<id>` | B reads A's items by receipt id | 200 | 0 rows |
| `POST /api/receipts` | B creates a receipt with created_by = A | 201 | owner=B, id set by server |
| `GET /api/purchase-history` | B reads purchase history | 200 | only B's own products |
| `GET /api/receipts` | no session: list receipts | 401 | error |
| `GET /api/userProfile` | no session: list userProfile | 401 | error |
| `GET /api/purchase-history` | no session: purchase history | 401 | error |
| `GET /api/receipts` | forged cookie | 401 | error |

After all of the above: A's five records are still present and A's receipt still has its own store name.

- Lists never contain another user's rows; a `created_by` filter in the query is ignored.
- Update and delete of another user's record by id → **404** (by design: the same answer as for a record that does not exist).
- `created_by` and `id` sent by the client are ignored; the owner is the session's user.
- Without a session, or with a made-up cookie → 401.

**Status: PASS** for all five entities and the purchase-history route.

Accounts and sessions (same run):

| Check | Result |
|---|---|
| Wrong password / unknown email | 401 / 401 (same answer) |
| Register an existing email | 409 |
| Password of 7 characters / invalid email | 400 / 400 |
| State-changing request with a foreign `Origin` | 403 |
| `GET /api/auth/me` and login response fields | `id`, `email` only |
| Session cookie attributes | HttpOnly, SameSite, Path, Max-Age (Secure only in production mode) |
| Second login for the same account | sees the same data |
| Logout, then the same cookie | 401; the account's other session still works |
| 12 failed logins for one address | 401 ×10, then 429 ×2 |

**Status: PASS.** NOT TESTED: password reset by email end to end (needs a real mailbox), session expiry after 30 days.

---

# Smart Basket

Harness, real catalog. "Receipt" below is the sample receipt (as read by the AI for account A, typed lines for the others).

| Case | Setup | Result | Status |
|---|---|---|---|
| A. One receipt | Profile 1, 1 receipt | 20 products: 17 from the receipt, 3 added (carrot, lettuce, clementine); ₪405.40 of ₪624; no profile conflict, no non-food, no pet food, no duplicate produce family; every added item has a reason | PASS |
| B. Multiple receipts | + 2 older receipts | History: 21 products, confidence 0.6 (3 receipts); milk, cottage, chicken at 0.762, tomatoes 0.792. All four are already on the receipt and are **not** added again (fix F); lentils (0.667) enter through the candidate pool. 21 products, ₪412.40 of ₪688 | PASS |
| C. No history, no receipt | Profile 1, nothing uploaded | 15 products, all added by the engine, 4 of them staples; ₪198.30 of ₪747; a level-1 menu can be built from it | PASS |
| D. Vegan | Vegan, nut allergy, dislikes mushrooms; receipt also contains cottage, chicken, almonds, mushrooms | None of the four in the basket; 0 animal products; added seitan, whole bread, potatoes, lettuce, clementine, oats | PASS |
| E. Allergy / disliked | as D; and profile 3 dislikes salmon | Nuts and mushrooms excluded (D); salmon from the receipt excluded for profile 3, tuna (favourite) kept | PASS |
| F. Tight budget | ₪1,500 per month → ₪350 a week, reserve ₪123 → food budget ₪227 | Basket ₪222.40, within the food budget | PASS |
| F2. Insufficient budget | ₪500 per month → ₪117 a week, reserve ₪123 → food budget ₪0 | Everything trimmed except one staple (potatoes, ₪5.90); sufficiency issues `bread`, `fat`, `protein` reported | PASS — behaves as designed; see Budget |
| G. Duplicate families | all baskets above | 0 duplicate produce families in every basket | PASS |
| H. Replacement | chicken breast | 3 options of the same kind, none in conflict with the profile, all keep the protein goal; after replacing, no sufficiency issue | PASS |
| I. Removal | remove all protein foods / bread and cereal | issues `protein` / `bread` | PASS |
| J. Alternatives | "בחירה מחדש" 5 times | baskets 2, 3, 4, 5 of 5, then back to the first; all within budget, all without sufficiency issues, the receipt items kept in every one; difference from the previous basket 0.5–1.0 | PASS |
| Determinism | build twice from the same inputs | identical items, order, quantities and total | PASS |

Hard constraints came before ranking in every case: no basket contained a product in conflict with its profile.

---

# Weekly Planner

Harness. Balancing aims at calories within **±3%** of the target (closure pass); the validator grades at **±5%**. The two columns are reported separately.

**Profile 1 — maintenance, omnivore (account A, receipt read by the AI)** — targets 2709 kcal, protein 125 g, fat 90 g; quality level 1; failed checks: none; limited: none; cost ₪467 of ₪624; variant chosen: budget.

| Day | kcal | diff % | ≤ ±3% | ≤ ±5% | protein g | % of target | fat g | % of target | fat 75–115% |
|---|---|---|---|---|---|---|---|---|---|
| Sunday | 2709 | 0 | yes | yes | 134.5 | 108 | 94.8 | 105 | yes |
| Monday | 2700 | -0.3 | yes | yes | 136.4 | 109 | 87.2 | 97 | yes |
| Tuesday | 2713 | 0.1 | yes | yes | 135.8 | 109 | 94.4 | 105 | yes |
| Wednesday | 2689 | -0.7 | yes | yes | 135 | 108 | 94.5 | 105 | yes |
| Thursday | 2716 | 0.3 | yes | yes | 138 | 110 | 93.8 | 104 | yes |
| Friday | 2706 | -0.1 | yes | yes | 136.8 | 109 | 88.8 | 99 | yes |
| Saturday | 2726 | 0.6 | yes | yes | 133.9 | 107 | 98.1 | 109 | yes |

**Profile 2 — weight loss, vegan, nut allergy, dislikes mushrooms** — targets 1463 kcal, protein 112 g, fat 49 g; quality level 1; failed checks: none; limited: none; cost ₪198.6 of ₪607; variant chosen: budget.

| Day | kcal | diff % | ≤ ±3% | ≤ ±5% | protein g | % of target | fat g | % of target | fat 75–115% |
|---|---|---|---|---|---|---|---|---|---|
| Sunday | 1471 | 0.5 | yes | yes | 109.5 | 98 | 48 | 98 | yes |
| Monday | 1463 | 0 | yes | yes | 110.4 | 99 | 47.6 | 97 | yes |
| Tuesday | 1473 | 0.7 | yes | yes | 109 | 97 | 48.2 | 98 | yes |
| Wednesday | 1471 | 0.5 | yes | yes | 110 | 98 | 44.2 | 90 | yes |
| Thursday | 1465 | 0.1 | yes | yes | 110.8 | 99 | 43.8 | 89 | yes |
| Friday | 1468 | 0.3 | yes | yes | 110.8 | 99 | 45.5 | 93 | yes |
| Saturday | 1462 | -0.1 | yes | yes | 110.3 | 98 | 42 | 86 | yes |

**Profile 3 — weight gain, strength training 3–5/week, favourite tuna, dislikes salmon** — targets 3417 kcal, protein 130 g, fat 95 g; quality level 2; failed checks: cross_meal_repeat; limited: product_repeat; cost ₪350.2 of ₪810; variant chosen: budget.

| Day | kcal | diff % | ≤ ±3% | ≤ ±5% | protein g | % of target | fat g | % of target | fat 75–115% |
|---|---|---|---|---|---|---|---|---|---|
| Sunday | 3346 | -2.1 | yes | yes | 137.8 | 106 | 93.6 | 99 | yes |
| Monday | 3394 | -0.7 | yes | yes | 139.8 | 108 | 86.3 | 91 | yes |
| Tuesday | 3423 | 0.2 | yes | yes | 154.1 | 119 | 93.8 | 99 | yes |
| Wednesday | 3317 | -2.9 | yes | yes | 136.5 | 105 | 88.5 | 93 | yes |
| Thursday | 3300 | -3.4 | no | yes | 132.5 | 102 | 97.6 | 103 | yes |
| Friday | 3370 | -1.4 | yes | yes | 138.4 | 106 | 94.3 | 99 | yes |
| Saturday | 3419 | 0.1 | yes | yes | 138 | 106 | 101.5 | 107 | yes |

**Profile 1 with a ₪1,500 monthly budget** — targets 2709 kcal, protein 125 g, fat 90 g; quality level 3; failed checks: within_budget, cross_meal_repeat; limited: product_repeat; cost ₪355.1 of ₪227; variant chosen: balanced.

| Day | kcal | diff % | ≤ ±3% | ≤ ±5% | protein g | % of target | fat g | % of target | fat 75–115% |
|---|---|---|---|---|---|---|---|---|---|
| Sunday | 2691 | -0.7 | yes | yes | 136 | 109 | 81.9 | 91 | yes |
| Monday | 2705 | -0.1 | yes | yes | 132.6 | 106 | 86.4 | 96 | yes |
| Tuesday | 2699 | -0.4 | yes | yes | 129.4 | 104 | 82.3 | 91 | yes |
| Wednesday | 2712 | 0.1 | yes | yes | 133.3 | 107 | 83.7 | 93 | yes |
| Thursday | 2710 | 0 | yes | yes | 134.3 | 107 | 84.8 | 94 | yes |
| Friday | 2684 | -0.9 | yes | yes | 133.1 | 106 | 86.4 | 96 | yes |
| Saturday | 2707 | -0.1 | yes | yes | 132.7 | 106 | 80.4 | 89 | yes |

**Profile 1 without any receipt** — targets 2709 kcal, protein 125 g, fat 90 g; quality level 1; failed checks: none; limited: none; cost ₪277.4 of ₪747; variant chosen: budget.

| Day | kcal | diff % | ≤ ±3% | ≤ ±5% | protein g | % of target | fat g | % of target | fat 75–115% |
|---|---|---|---|---|---|---|---|---|---|
| Sunday | 2711 | 0.1 | yes | yes | 134.2 | 107 | 84.4 | 94 | yes |
| Monday | 2710 | 0 | yes | yes | 133.8 | 107 | 85.1 | 95 | yes |
| Tuesday | 2736 | 1 | yes | yes | 135.6 | 108 | 78 | 87 | yes |
| Wednesday | 2689 | -0.7 | yes | yes | 132.8 | 106 | 95.3 | 106 | yes |
| Thursday | 2705 | -0.1 | yes | yes | 134.8 | 108 | 76.4 | 85 | yes |
| Friday | 2706 | -0.1 | yes | yes | 137.4 | 110 | 83.8 | 93 | yes |
| Saturday | 2719 | 0.4 | yes | yes | 133.9 | 107 | 84.9 | 94 | yes |

Structure checks, all five plans:

| Check | Result |
|---|---|
| Exactly 7 days, Sunday → Saturday | yes, all 5 |
| Meals per day | 4 in every day of every plan |
| Breakfast, lunch and dinner every day (no partial plan) | yes, all 35 days |
| Every menu product is in the basket | yes |
| Product in conflict with the profile (diet, allergy) | 0 |
| Meat with dairy in one meal | 0 |
| More than one meat/fish product on one plate | 0 |
| Same inputs → same menu | identical (profile 1, built twice) |

Across the 35 days: calories within ±3% on **34**, within ±5% on **35**; protein at least 90% of target on **35** (above 110% on 1: profile 3, Tuesday, 119%); fat within 75–115% on **35**.

The one day outside ±3% is profile 3, Thursday (−3.4%, 3,300 of 3,417 kcal): the balancer could not close it within its own tolerance, and the validator still passes it (within ±5%). This is the difference between the two thresholds in practice.

Sixth case — the insufficient budget: the basket is a single product, and the planner **refuses**: `IncompleteMenuError`, "לא הצלחנו לבנות תפריט שלם: אין ארוחת בוקר בכל הימים…". No partial menu is produced. **PASS** (designed behavior).

Rebuild, profile 1: alternatives 2–5 of 5 (variety, protein, balanced, "fresh"), levels 1 / 2 / 2 / 1, each 57–71% different from the previous one, then back to the first. **PASS.**

Realism, from reading the menus: profiles 1, 2 and the no-receipt case read as ordinary meals. Profile 3 (3,417 kcal) reaches its calories by stacking carbohydrates — e.g. a lunch of chicken, 300 g pasta and 245 g potatoes — and is graded level 2 for repetition. **LIMITATION**, recorded below.

**Status: PASS**, with that limitation.

---

# Budget

| Case | Profile budget | Weekly (× 7/30) | Reserve | Food budget | Basket (one pack each) | Menu cost | Final list | Status shown |
|---|---|---|---|---|---|---|---|---|
| Normal (browser run) | ₪3,200 | ₪747 | ₪123 | ₪624 | ₪374.70 | ₪485.70 | ₪485.70 | within, ₪138.30 left |
| Normal (harness, account A) | ₪3,200 | ₪747 | ₪123 | ₪624 | ₪405.40 | ₪467.00 | ₪467.00 | within, ₪157 left |
| Three receipts | ₪3,200 | ₪747 | ₪59 | ₪688 | ₪412.40 | — | — | — |
| No receipts | ₪3,200 | ₪747 | ₪0 | ₪747 | ₪198.30 | ₪277.40 | ₪277.40 | within, ₪469.60 left |
| Tight | ₪1,500 | ₪350 | ₪123 | ₪227 | ₪222.40 | ₪355.10 | ₪355.10 | **over by ₪128.10**, menu level 3 |
| Insufficient | ₪500 | ₪117 | ₪123 | ₪0 | ₪5.90 | no menu | — | no food budget left; planner refuses |

Checks:

- Weekly conversion: 3,200 × 7/30 = 746.7 → ₪747. **PASS.**
- Reserve from history: the one receipt has ₪131.50 of non-food; × 4 trips ÷ (30/7) = ₪122.7 → ₪123. With three receipts the average is ₪63.70 → ₪59. **PASS.**
- History confidence: "none" with 0 receipts, "low" with 1, "ok" with 3; the card says "לפי קבלה אחת בלבד — תמונה חלקית". **PASS.**
- Receipts are not the budget: in every case the food budget comes from the profile budget minus the reserve. The receipt total (₪599.90) appears only under "היסטוריית הקבלות — לעיון בלבד". **PASS.**
- Menu cost = final-list cost in every case. **PASS.**
- The same five numbers on the plan page, the final-list page and the results page (browser run). **PASS.**

Findings:

- **Tight budget — LIMITATION.** The basket fits the food budget (₪222 of ₪227) but the menu built from it costs ₪355: the basket counts one pack of each product, the menu needs several. The basket is not sized against the cost of the menu it will produce. The system does not hide this: the menu is level 3 and the card says "over by ₪128.10". A "tight but feasible" budget was therefore not demonstrated; the case shows the warning path.
- **Reserve from a single receipt — LIMITATION.** One receipt with ₪131 of household goods reserves ₪123 every week. With a ₪500 monthly budget that leaves nothing for food. The card says the history is partial; the reserve is still applied in full.
- NOT TESTED: a basket with an accepted higher budget (`accepted_budget`) through the UI.

---

# Final List

Chain checked: menu → grams per product over the week → +10% → cooked → dry (÷2.7 grain, ÷3 legumes) → whole packs / weight rounded up to 100 g → price.

Account A, harness. "Eaten" was summed independently from the menu's days and equals the list's own figure on all 20 rows.

| Product | Group | Eaten in the menu (g) | +10% | Purchase (g) | Quantity shown | Sold | Pack g | Pack ₪ / ₪ per kg | Price ₪ |
|---|---|---|---|---|---|---|---|---|---|
| חלב תנובה 1 ליטר 3% × 2 | milk | 700 | 770 | 1000 | 1 ליטר | pack | 1000 | 6.2 | 6.2 |
| לחם אחיד פרוס | bread | 1800 | 1980 | 2250 | 750 גרם × 3 | pack | 750 | 8.38 | 25.1 |
| קוטג' תנובה 250 גרם 5% × 2 | dairy_protein | 555 | 610 | 750 | 250 גרם × 3 | pack | 250 | 6.9 | 20.7 |
| גבינה צהובה עמק 200 גרם | dairy_protein | 245 | 270 | 400 | 200 גרם × 2 | pack | 200 | 16.9 | 33.8 |
| ביצים L 12יח' | eggs | 290 | 319 | 720 | תבנית 12 ביצים | pack | 720 | 34.9 | 34.9 |
| שמן זית 750 מיליליטר | oil | 208 | 229 | 750 | 750 מ"ל | pack | 750 | 34.9 | 34.9 |
| אורז בסמטי | grain | 1500 | 1650 | 5000 | 5 ק"ג | pack | 5000 | 49.9 | 49.9 |
| חזה עוף טרי 1 קילוגרם | meat | 335 | 369 | 1000 | 1 ק"ג | pack | 1000 | 32.9 | 32.9 |
| פילה סלמון | fish | 245 | 270 | 300 | כ-300 גרם | by weight |  | 79.9 | 24 |
| קפה נמס 200ג MONRO | coffee | 70 | 77 | 200 | 200 גרם | pack | 200 | 23.9 | 23.9 |
| פסטה ברילה 500 גרם × 2 | grain | 1200 | 1320 | 500 | 500 גרם | pack | 500 | 8.9 | 8.9 |
| טונה במים מארז 4 | fish | 895 | 985 | 1350 | 450 גרם × 3 | pack | 450 | 14.9 | 44.7 |
| עגבניות 1.5 קילוגרם | vegetable | 240 | 264 | 500 | 500 גרם | pack | 500 | 9.9 | 9.9 |
| מלפפונים בחומץ צנצנת680ג | vegetable | 120 | 132 | 680 | 680 גרם | pack | 680 | 12.5 | 12.5 |
| תפוח עץ סמיט 70 | fruit | 500 | 550 | 600 | כ-600 גרם | by weight |  | 12.9 | 7.7 |
| טחינה גולמית 500 גרם | tahini | 60 | 66 | 500 | 500 גרם | pack | 500 | 14.9 | 14.9 |
| שקדים טבעיים 250 גרם | nuts | 205 | 226 | 400 | 200 גרם × 2 | pack | 200 | 19.9 | 39.8 |
| גזר 1 ק"ג | vegetable | 2400 | 2640 | 3000 | 1 ק"ג × 3 | pack | 1000 | 4.9 | 14.7 |
| חסה קטיף כהלכה | vegetable | 2280 | 2508 | 3000 | 1 ק"ג × 3 | pack | 1000 | 6.9 | 20.7 |
| קלמנטינה | fruit | 1250 | 1375 | 1400 | כ-1.4 ק"ג | by weight |  | 4.9 | 6.9 |

Sum of the price column: ₪467.0 = list total = menu cost.

Rows recomputed by hand:

| Product | Calculation | Expected | Shown |
|---|---|---|---|
| Milk | 700 × 1.1 = 770 g → 1 pack of 1 L | 1 L, ₪6.20 | 1 ליטר, ₪6.2 |
| Bread | 1,800 × 1.1 = 1,980 g → 3 × 750 g | ₪8.38 × 3 = ₪25.1 | 750 גרם × 3, ₪25.1 |
| Cottage | 555 × 1.1 = 610.5 g → 3 × 250 g | ₪6.90 × 3 = ₪20.7 | 250 גרם × 3, ₪20.7 |
| Eggs | 290 × 1.1 = 319 g → 6 eggs → 1 carton | ₪34.9 | תבנית 12 ביצים, ₪34.9 |
| Pasta (dry) | 1,200 cooked × 1.1 = 1,320 ÷ 2.7 = 489 g → 1 × 500 g | ₪8.9 | 500 גרם, ₪8.9 |
| Rice (dry) | 1,500 cooked × 1.1 = 1,650 ÷ 2.7 = 611 g → 1 pack; the product chosen is a 5 kg bag | ₪49.9 | 5 ק"ג, ₪49.9 |
| Salmon (by weight) | 245 × 1.1 = 269.5 → 300 g × ₪79.9/kg | ₪23.97 → ₪24 | כ-300 גרם, ₪24 |
| Tuna | 895 × 1.1 = 984.5 g → 3 × 450 g | ₪14.9 × 3 = ₪44.7 | 450 גרם × 3, ₪44.7 |
| Clementines (by weight) | 1,250 × 1.1 = 1,375 → 1,400 g × ₪4.9/kg | ₪6.86 → ₪6.9 | כ-1.4 ק"ג, ₪6.9 |

All nine agree. In the browser run the same check was made on all 20 rows of the list shown in `07-final-shopping-list.jpg`; they agree and sum to ₪485.70.

**Status: PASS.** Observation: a product chosen in a large pack (the 5 kg rice) is charged in full although the week uses 611 g — correct for "what to buy", and a reason the weekly cost can look high.

---

# Persistence

| Check | Result | Status |
|---|---|---|
| Refresh on the receipt page | 19 products, total ₪599.90, nothing left for review | PASS |
| Refresh on the basket | 21 products | PASS |
| Refresh on the meal plan | level 1, ₪485.70 | PASS |
| Refresh on the final list | ₪485.70, 20 products | PASS |
| Logout → login | same data; API 401 in between | PASS |
| Server restart (both processes stopped and started) | login works; 1 profile, 1 receipt, 24 receipt items, 10 lists, 11 plans; final list ₪485.70 | PASS |
| Data scoped to the user after all of this | see User Isolation | PASS |

Note: every "בחירה מחדש" / "בנייה מחדש" saves a new list or plan (10 lists and 11 plans after this run for one user); the page uses the latest. Old ones are not cleaned up. LIMITATION, harmless at this scale.

---

# Performance

Simple timings on the QA machine (Apple M1 Pro, 16 GB), local servers, one user. Not a benchmark.

| Operation | Samples | Median | Range | Where measured |
|---|---|---|---|---|
| Smart basket, including its alternatives (catalog lookups cached) | 5 | 737 ms | 734–751 ms | harness (Node), includes HTTP catalog searches |
| Smart basket, first build (cold lookup cache) | 1 | 1,600 ms | — | harness |
| Weekly plan (4 planner variants + balancing + validation) | 5 | 532 ms | 531–552 ms | harness (Node) |
| Weekly plan, first build | 1 | 644 ms | — | harness |
| Rebuild of the weekly plan (adds a fifth variant) | 5 | about 730 ms | 705–788 ms | harness |
| `POST /api/products/match-items`, 19 items | 5 | 1,609 ms | 1,586–1,651 ms | HTTP, localhost |
| `GET /api/products/search` (substring) | 10 | 33 ms | 31–35 ms | HTTP |
| `GET /api/products/search?match=prefix` | 10 | 24 ms | 23–24 ms | HTTP |
| `GET /api/purchase-history` (3 receipts) | 10 | 2 ms | 2 ms | HTTP |
| `GET /api/receiptItems` (48 rows) | 10 | 1 ms | 1–2 ms | HTTP |
| Receipt AI: file transcription | 3 runs | about 7.4 s | 7.3–7.6 s | server → provider |
| Receipt AI: line extraction (24 lines) | 3 runs | about 11.6 s | 10.4–12.7 s | server → provider |
| Full unit-test suite | 1 | 14.9 s | — | 402 tests |

Notes: the basket and planner times were measured in Node, not in a browser; in the browser run a basket or a menu appeared within a few seconds of the click, which was not timed precisely. Matching is the slowest local step (about 85 ms per item: several `LIKE '%…%'` scans over the catalog). Receipt reading is dominated by the external service.

---

# Secret Scan

- Tracked files, patterns for Anthropic keys, Resend keys, AWS keys and private-key blocks (`package-lock.json` excluded): **no match**.
- Git history, all branches, same key patterns: **no commit** adds or removes a matching string.
- Env files ever tracked: only `.env.example` (placeholders).
- `.env.local` (git-ignored) holds two real secrets: `ANTHROPIC_API_KEY` and `RESEND_API_KEY`. Their values were not read or printed; the Anthropic variable was renamed.
- `server/bettercart.db` (git-ignored, never tracked) holds user data, password hashes and session hashes. It must not go into a submission package.
- The built client bundle contains neither secret value.

**Result: no secret in tracked files or history.** Remediation recommended anyway: rotate the Anthropic key if any earlier build was ever opened by someone else (see fix C).

---

# Documentation

- `README.md` created (purpose, architecture, requirements, install, settings with placeholders, run, test, structure, limitations).
- `docs/PROJECT_STATUS.md`, `docs/FINAL_QA_REPORT.md`, `docs/ACADEMIC_FLOW.md`, `docs/SHARE_LOCAL_DEMO.md`: an "Outdated — kept for history only" notice was added at the top of each. Their content was not rewritten.
- `docs/LOCAL_RUN.md`: the AI-key section, the Node version (20.12+, since the server uses `process.loadEnvFile`) and the script table were corrected.
- `.env.example`: `ANTHROPIC_API_KEY` instead of the `VITE_` variable.

---

# Files Changed

Application code and data (all uncommitted):

| File | Change | Class |
|---|---|---|
| `src/lib/mealPlanRules.js` | "דג" as a word; two fish terms | A — verified bug |
| `src/lib/nonFood.js` | `PET_FOOD` rule | A — verified bug |
| `server/scripts/repair-fish-and-pet.js` (new) | catalog repair, dry run by default | A — verified bug |
| `server/products.db` | 508 rows re-filed, 233 rows → non-food | A — verified bug (data) |
| `server/ai.js` (new) | receipt AI on the server; PDF; strict answers | B — security · A |
| `server/index.js` | registers the AI routes (4 lines) | B — security |
| `src/lib/ai.js` | client calls the server; no key, no provider URL | B — security |
| `src/lib/receiptPrompt.js` (new), `src/lib/receiptPipeline.js` | prompt and schema shared with the server | B — security |
| `src/pages/ReceiptUpload.jsx` | demo mode from the server status; accepted types; texts | B / A |
| `.env.example` | server-side key name | B — security |
| `src/lib/basketBuilder.js` | history regular not added twice | A — verified bug (found in QA) |
| `src/lib/receiptReview.js` | two words in the "different product" list | A — verified bug (found in QA) |
| `src/lib/mealPlanCalories.js` | capital X in multipacks | A — verified bug (found in QA) |
| `src/lib/shoppingOptimizer.js` | egg carton priced by its own pack | A — verified bug (found in QA) |
| `tests/preFinalFixes.test.js` (new) | 85 regression tests | tests |
| `README.md` (new), `docs/*.md` | documentation | docs |

Local, outside git: `.env.local` (variable renamed), `server/bettercart.db` (QA accounts), `dist/` (rebuilt).

Not touched: health score, purchase-history scoring, basket ranking, the weekly planner, the validator, the budget model, the authentication model.

Also present in the worktree and **not created by this QA run**: `docs/algorithm-audit/` (five files, written 18:51–18:55 on the same day by another process). Left untouched.

---

# Known Remaining Limitations

Fixed issues are not repeated here.

1. **Receipt reading was verified on one photographed sample receipt only.** No genuine receipts; no accuracy figure. Wording varies between runs; one brand name was misread in a PDF run.
2. **Catalog matching recall.** In the samples, a third to a quarter of ordinary food lines needed the user (quantity in the name, brand wording, abbreviations). Automatic matches may be a variant of the product (cherry tomatoes for tomatoes). The match dialog opens with the full receipt name, which usually finds nothing until shortened.
3. **Keyword classification.** Food group, health score, non-food, pet food and allergens are decided from the product name. Examples left as they are: "דג הרינג בשמן" is read as oil by the general classifier; a sweetened cereal named "דגנים … טעם פירות" is read as fruit; non-food rows such as "מטאטא דגם 6" are still `is_food = 1` in the catalog (now category "other", no longer protein).
4. **Catalog data.** One chain, prices of May 2026, nutrition missing or generic; the 508 re-filed rows now have no nutrition values (the app uses typical values for the food group). The importer's scores for those rows were reset to the catalog's "no data" convention.
5. **Tight budgets.** The basket is checked against the food budget by one pack per product; the menu built from it can cost considerably more. The menu is then marked level 3 with the overrun; it is not prevented.
6. **Household reserve from one or two receipts** can be unrepresentative and is applied in full.
7. **High calorie targets** are met by stacking carbohydrate sides; menus are graded level 2 for repetition.
8. **Two calorie thresholds.** The balancer aims at ±3%; 1 of 35 days ended at −3.4% and passes the validator's ±5%.
9. **Labels of menu alternatives** name the planner variant ("עם דגש על חיסכון"), not the result; that alternative was more expensive than the recommended menu in the browser run.
10. **Every rebuild saves a new list / plan**; old ones accumulate.
11. **Stale interface text.** The landing page and the upload page's "what happens behind the scenes" box still say the AI classifies food and nutrition. Not changed (wording only, no functional effect); they were kept out of the screenshots.
12. **No automated tests** for routes, authentication, isolation or pages. Isolation was verified by the harness, which can be re-run.
13. **Security scope.** Login throttling is in memory; catalog routes are public; no email verification; the server stores baskets and menus as sent by the client without validating their content. Local deployment only.
14. **Not tested:** password reset by email, printed output, accepted-budget flow in the UI, a removal that triggers a warning in the UI, browsers other than Chrome, mobile widths, concurrent users.

---

# Acceptance Gate

| Criterion | Result |
|---|---|
| Fish / grains bug resolved | PASS |
| Pet food cannot enter the human-food pipeline | PASS (for the names and brands in the catalog; keyword rule) |
| Private Anthropic key not exposed client-side | PASS |
| Advertised upload formats work | PASS (JPEG, PNG, WEBP, GIF, PDF; PNG and PDF tested live) |
| Automated tests pass, skips reported | PASS — 402 passed, 6 skipped (the integration file), 0 failed |
| Build passes | PASS |
| Lint passes | PASS |
| Integration tests pass | PASS — 6 of 6 |
| E2E core flow passes | PASS |
| Two-user isolation passes | PASS |
| Smart basket regression | PASS |
| Weekly planner produces valid 7-day plans | PASS (5 of 5 feasible cases; refusal in the infeasible one) |
| Budget and final list consistent | PASS |
| Persistence | PASS |
| No high-severity secret in tracked files | PASS |

**The gate passes for feature freeze**, with three conditions that are the owner's to close and that this run could not close:

1. Real store receipts were not available — receipt-reading accuracy stays "not tested".
2. Rotate the Anthropic key if earlier builds were ever shared.
3. The changes are uncommitted; the submission commit does not exist yet.

---

# Additional Receipt Run — receipt_example2 (real store receipt)

Added 2026-10-11, after the QA stage, for the Project Book. Code unchanged (`3471663`; production code identical to `c7247a3`). One run, one receipt: **qualitative evidence, not an accuracy benchmark.**

- File: `receipt_example2.jpeg` — a phone photo (963×3898 px, 1.0 MB) of a real Shufersal receipt dated 2026-10-04, crumpled, total ₪319.94. The image contains personal payment details and is not reproduced anywhere.
- Tool: `docs/project-book/qa/scripts/receipt2-qa.mjs` (same calls as the app: `/api/ai/receipt-file` → `/api/ai/receipt-text` → rule classification → `/api/products/match-items` + client acceptance rule). Raw result: `docs/project-book/qa/evidence/receipt-example2-results.json`.
- Ground truth: typed by reading the image — 20 product lines, 5 discount lines.

**AI extraction**

| Check | Result |
|---|---|
| File accepted | yes (200) |
| Transcription / extraction time | 18.0 s / 13.6 s |
| Store, date, total | all correct (שופרסל, 2026-10-04, 319.94) |
| Product lines | 19 of 20 |
| Discount lines | 5 of 5 detected, each merged into the product above it by the rules |
| Lost line | lemon (1.005 kg, ₪10.95) was merged into the milk line; the milk kept lemon's quantity and price, and its own price (₪11.02) was lost |
| Prices | 18 of the 19 extracted lines correct |
| Names | 2 unusable (פיתות כוסמין → "פומיפוח כוסמי"; מרידול לחניכיים → "מרידרוד לחנייכיחם"), 2 slightly wrong (ריצפז → ריצפד; גזר ארוז → גזר ארוך), 1 qualifier dropped (עגבניות חתוכות → "עגבניות") |
| Sum of lines vs printed total | 308.92 vs 319.94 — the difference is exactly the lost milk price |

**Rule classification** — 4 of the 20 printed lines are not food (floor cleaner, fabric softener, toothpaste, carrier bag). Only the softener was classified non-food. The floor cleaner was classified as fruit (its name contains "מלון"), the toothpaste name was unreadable, and "שקית קופה" matches no non-food rule. None of the three reached a basket-ready state (all `not_found`).

**Catalog matching** (18 lines treated as food)

| Outcome | Lines | Notes |
|---|---|---|
| matched automatically | 8 | 6 the product itself; 2 another variant: "עגבניות" → cherry tomatoes (the receipt line was chopped tomatoes), "קוטג" → cottage with garlic and dill |
| needs review | 2 | avocado, eggs (the suggested egg product is the right one) |
| not found | 8 | 3 real non-food lines, water, the 2 unreadable names, milk, carrot / yogurt wording |
| basket-ready | 7 | the 8 matched minus sugar (not a menu food) |

**Reading.** On a real, crumpled receipt the pipeline completed and got the header, the discounts and most lines right, but it lost one line, misread several names, and one automatic match was a different product. This is weaker than the result on the printed sample receipt, and is consistent with the stated limitation: receipt accuracy is not established, and the user review step is required. No accuracy rate is derived from these two receipts.
