# BetterCart v2 — Project Status

**Last updated:** 2026-06-28
**Version:** 2.0.0
**Status:** ✅ MVP Stable — Final QA Passed
**Stack:** React 18 + Vite 6, Express + SQLite (better-sqlite3), Claude AI (direct browser API call)

---

## A. What Currently Works

### Core Flow
- **Full React SPA** — React Router v6, Hebrew RTL layout, Tailwind CSS
- **5-step Onboarding** — personal info → goals → preferences → budget → review summary
  - Computes: BMI, BMR, daily calories, macro targets (protein/carbs/fat), health score, budget per purchase
  - Saved to SQLite via Express REST API (port 3001)
- **Dashboard** — shows all profile metrics; links to receipts, shopping list, nutrition plan; live fitness score recalculation; weight tracking card with BMI delta alert (Hebrew)
- **Receipt upload** — text paste and image/PDF via Claude Vision (claude-haiku-4-5-20251001)
  - Text mode: Hebrew receipt text → Claude AI → structured food items
  - File mode: Claude Vision extracts text from image/PDF
  - Demo mode: falls back to Hebrew Rami Levy demo data when no API key
- **Receipt results** — food/non-food split, inline item editing (price/category/quantity/approval), approve/reject items for meal planning
- **Product Catalog Integration** (Steps 1–4 complete):
  - Step 1: `server/products.db` — 82,564 products from Rami Levy and Shufersal (read-only)
  - **Active catalog provider (MVP): Shufersal only.** `server/index.js` defines `ACTIVE_CATALOG_CHAIN = "shufersal"` and a `CATALOG_PROVIDERS` config; `/api/products/search` and `/api/products/match-items` always filter/match against `source_chain = "shufersal"`, regardless of any `chain` value passed in. Rami Levy rows remain in `products.db` but are not used by current matching. This narrowed scope was chosen to reduce complexity and improve reliability for academic submission; the code is structured so another chain can be enabled later by flipping `enabled: true` in `CATALOG_PROVIDERS` — no matching-logic changes required.
  - Step 2: `POST /api/products/match-items` — 3-tier matching (exact → partial LIKE → token scoring) with stop tokens, confidence thresholds, `needs_review` flag
  - Step 3: ReceiptResults "התאם מוצרים לקטלוג" button — catalog badges per item, catalog fields stored separately from AI/user data, no overwrite of user-edited values
  - Step 4: ShoppingListPage `getEffectiveItemData()` — uses catalog nutrition/price only for `status=matched AND !needs_review`; falls back to AI/user values otherwise
- **Shopping list generation** — AI-powered, budget-enforced, dietary restrictions hard-constrained, catalog-enriched prompts when strong match exists
- **Shopping list quantity optimizer** — back-calculates grams from 7-day nutrition plan, converts to purchase units
- **Nutrition plan generation** — 7-day weekly meal plan with macros per meal, linked to shopping list
- **Final results page** — before/after comparison (spending + health score), shopping list and nutrition plan tabs, empty state guards
- **Hebrew print** — `/print` page renders full RTL report (profile, shopping list, nutrition plan, insights); browser Cmd+P → Save as PDF
- **Data isolation** — every entity has `created_by` (per-browser guest ID from localStorage); all queries filter by `created_by`; no cross-user data leakage

### Technical
- **Express + SQLite backend** — generic CRUD for 5 entities, JSON column serialization, boolean 0/1 encoding
- **Safe schema migrations** — `ALTER TABLE … ADD COLUMN` in try/catch; idempotent on restart
- **Demo mode** — full app works without any API key using hardcoded Hebrew demo data

---

## B. What Is Intentionally Mock / Demo-Only

| Item | Details |
|---|---|
| Authentication | Per-browser guest ID (localStorage); no email/password login |
| Demo receipt | Uses Hebrew Rami Levy demo data when no API key; real OCR requires `VITE_ANTHROPIC_API_KEY` |
| Nutritional values | AI-estimated per 100g; verified by catalog match only for `status=matched` items |
| jsPDF Hebrew | Disabled — Hebrew RTL in jsPDF requires embedded font; browser print (`/print`) is used instead |

---

## C. What Is Complete and Independent from Base44

- Zero `@base44/sdk` imports anywhere in the codebase
- Zero references to Base44 app IDs, API URLs, or auth flows
- Data: SQLite (`server/bettercart.db`) + Express REST API
- AI: direct Anthropic API from browser (`src/lib/ai.js`) + demo fallback
- All entity CRUD via `src/lib/serverDB.js` → HTTP fetch to `localhost:3001`
- `npm run build` and `npm run dev:full` work without any external service

---

## D. Known Limitations (Non-Blocking)

| Limitation | Impact | Status |
|---|---|---|
| No real login | All users are guest-only; guest ID lost on localStorage clear | Acceptable for academic demo |
| File OCR requires API key | Image/PDF upload shows Hebrew block message in demo mode | By design |
| jsPDF Hebrew disabled | Only browser print (`/print`) works for Hebrew output | By design |
| 3 orphan DB rows | `demo@bettercart.app` items with invalid `receipt_id` from early dev; invisible to users | Harmless |
| Nutrition in demo mode | Shopping list and nutrition plan use demo responses; values are realistic but not personalized | By design |
| Catalog `needs_review` items | Token matches (confidence 0.80–0.89) flagged for manual review; not auto-applied | By design — safe default |
| Chunk size warning | Production JS bundle ~647 kB (advisory, not error); typical for React SPA with Hebrew libraries | Pre-existing |

---

## E. Post-MVP Optional Improvements

These are deliberately deferred. Do not implement for academic submission.

| # | Improvement | Reason for deferral |
|---|---|---|
| 1 | Hebrew PDF via jsPDF | Requires embedding RTL font; browser print is sufficient for demo |
| 2 | Real email+password auth | No requirement for academic demo |
| 3 | Multi-receipt aggregation | Current single-receipt flow is clear and complete |
| 4 | Additional supermarket chains | Catalog already covers Rami Levy + Shufersal (82,564 products) |
| 5 | Official Israeli nutritional DB (Malam) | AI estimates + catalog data are sufficient |
| 6 | Code splitting / lazy loading | Bundle size is advisory; not a functional issue |
| 7 | Mobile native app (PWA/React Native) | Out of scope for web academic submission |
| 8 | User-initiated catalog `needs_review` resolution | Users can manually edit items as a workaround |
