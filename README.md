# BetterCart v2

A Hebrew (RTL) web application that turns a supermarket receipt into a weekly
product basket, a 7-day meal plan and a final shopping list, fitted to the
user's nutrition targets, dietary restrictions and budget.

Final project, Computer Science, Tel-Hai Academic College.

## How it works

```
receipt image / PDF / text
  → receipt reading (AI — the only place AI is used)
  → rule-based line classification (food / non-food, category, menu fit)
  → catalog matching with confidence thresholds, reviewed by the user
  → health score, purchase history across receipts
  → smart weekly basket
  → weekly meal plan (7 days, Sunday–Saturday)
  → nutrition and budget validation (quality levels 1–4)
  → final shopping list (quantities and cost derived from the plan)
  → results / print
```

Everything after the receipt reading is deterministic: the same profile,
receipts, basket and budget always give the same basket and menu.

## Architecture

| Part | What it is |
|---|---|
| Client | React 18 single-page app (Vite, React Router, TanStack Query, Tailwind). The basket, planner, validator, budget and final-list algorithms run here, as plain modules under `src/lib/`. |
| Server | One Node.js / Express process (`server/`): accounts and sessions, per-user storage, catalog search and matching, health score, purchase history, and the receipt-AI requests. |
| User database | `server/bettercart.db` (SQLite, created on first run, git-ignored). |
| Product catalog | `server/products.db` (SQLite, read-only, committed). Only the Shufersal rows are used. |
| Receipt AI | Anthropic Messages API, called **by the server only**. The browser never receives the API key. |

## Requirements

- Node.js 20.12 or newer (developed and tested on 22.21)
- npm 9 or newer

No other service is required. Without an Anthropic API key the app runs in
demo mode: receipt reading returns a fixed sample receipt, and everything else
works normally.

## Install and run

```bash
npm install
npm run dev:full        # client on http://localhost:5173, API on http://localhost:3001
```

Open http://localhost:5173, create an account and complete the profile questionnaire.

Other scripts:

| Script | What it does |
|---|---|
| `npm run dev` | client only (Vite) |
| `npm run dev:server` | API server with auto-reload |
| `npm run server` | API server |
| `npm run build` | production build of the client into `dist/` |
| `npm run lint` | ESLint |
| `npm test` | unit tests (Vitest) |
| `npm run test:integration` | integration tests against the running API (start `npm run dev:server` first) |

## Settings

Server settings are read from `.env.local` in the project root (git-ignored).
Copy the names from `.env.example` and fill in your own values:

```
ANTHROPIC_API_KEY=your_anthropic_api_key_here    # optional: real receipt reading
RESEND_API_KEY=your_resend_api_key_here          # optional: password-reset emails
EMAIL_FROM=BetterCart <onboarding@resend.dev>
APP_URL=http://localhost:5173
```

Never put a secret in a variable whose name starts with `VITE_`: Vite builds
those into the browser bundle. `VITE_API_URL` (the API address, not a secret)
is the only `VITE_` variable the app reads.

Restart the server after changing `.env.local`.

## Tests

```bash
npm test                    # unit tests
npm run dev:server          # in another terminal
npm run test:integration    # catalog / basket / menu against the real catalog
```

## Repository structure

```
src/
  pages/        one screen per step of the flow
  components/   shared UI (budget card, menu quality card, flow steps, ui/)
  lib/          the algorithms and rules (no React):
                receiptPipeline, receiptClassifier, nonFood, receiptReview,
                healthScore, basketBuilder, smartBasketEngine, basketAlternatives,
                menuCandidates, mealScoring, weeklyPlanner, mealPlanCalories,
                mealPlanBudget, validateMenu, explainMenu, budgetModel, pricing,
                shoppingOptimizer, nutritionPlanGenerator, calculations
  api/          client-side access to the API
server/
  index.js      routes: accounts, per-user CRUD, catalog search and matching
  auth.js       accounts, sessions, password reset
  ai.js         receipt reading (the only AI requests)
  purchaseHistory.js
  db.js         user database schema
  products.db   product catalog
  scripts/      one-off catalog repair scripts (dry run by default)
tests/          unit tests, fixtures, integration/
docs/
  project-book/ academic project book: drafts, QA report, screenshots
```

## Known limitations

- Products are classified from their Hebrew names (keywords), not from ingredient lists; this also applies to allergen checks. It is not a medical or dietetic tool.
- Catalog prices are a snapshot (May 2026, one chain); nutrition values are missing or generic for most catalog rows.
- The planner is a heuristic search and does not guarantee the best possible menu.
- Local deployment only; login throttling is kept in memory.

See `docs/project-book/qa/final-qa-report.md` for the latest QA results.
