# BetterCart v2 — Academic Workflow & CS Value

## Project Overview

BetterCart v2 is a full-stack web application that helps Israeli supermarket shoppers save money and improve nutrition by analyzing real purchase data, building a personalized user profile, and generating an optimized shopping list and weekly nutrition plan.

Supported supermarkets: **Rami Levy (רמי לוי)** and **Shufersal (שופרסל)**.

---

## End-to-End Algorithm Flow (8 Stages)

### Stage 1 — User Profile & Onboarding

The user fills a 5-step form:
- Personal data: age, gender, height (cm), weight (kg), activity level, strength training
- Goal: lose weight / maintain / gain weight
- Dietary restrictions: vegetarian, vegan, kosher, lactose-free, gluten-free
- Allergies: peanuts, nuts, dairy, eggs, wheat, soy, fish, shellfish
- Food preferences: favourite foods, disliked foods
- Budget: monthly grocery budget (₪), number of purchases per month

**Computed metrics (src/lib/calculations.js):**

| Metric | Formula |
|--------|---------|
| BMI | `weight (kg) / height (m)²` |
| BMR | Mifflin-St Jeor: `10×W + 6.25×H - 5×A + C` (C=5 male, -161 female) |
| Daily Calories | `BMR × activity_factor ± goal_offset` (−400 / 0 / +400 kcal) |
| Protein target | `daily_calories × ratio / 4` (varies by goal) |
| Carbs target | `daily_calories × ratio / 4` |
| Fat target | `daily_calories × ratio / 9` |
| Budget per purchase | `monthly_budget / purchases_per_month` |
| Health score | BMI normality (0–30 pts) + activity level (5–20 pts) + base 50 |

All computed values are persisted in SQLite via the Express REST API.

---

### Stage 2 — Receipt Analysis

The user uploads a receipt from Rami Levy or Shufersal (image, PDF, or text paste).

**Pipeline (src/lib/receiptPipeline.js):**

1. **File upload** — converts to base64 blob URL
2. **OCR extraction** — Claude Vision (claude-haiku-4-5) reads the image and extracts raw text
3. **AI analysis** — Claude receives the Hebrew receipt text and a JSON schema, then returns:
   - Store name detection (rami levy / shufersal)
   - Purchase date parsing (DD.MM.YYYY → YYYY-MM-DD normalization)
   - Total amount extraction
   - Per-item extraction: original Hebrew name, normalized name, category
4. **Food vs. non-food classification** — cleaning supplies, cosmetics, and household items are separated
5. **Nutritional estimation** — calories/100g, protein, carbs, fat per item (AI estimates)
6. **Health scoring** — per-item 0–10 health score
7. **Menu approval flag** (`is_approved_for_menu`) — unhealthy items default to unapproved

Results stored in two SQLite tables: `receipts` and `receiptItems`.

**Hebrew processing challenge:** Receipt text is in Hebrew (RTL), often abbreviated, with mixed Hebrew/English product names. The AI prompt is written in Hebrew and uses supermarket-specific heuristics.

---

### Stage 3 — Receipt Item Approval

After AI analysis, the user reviews items in ReceiptResults:
- Edit price, quantity, category inline
- Toggle `is_approved_for_menu` per item to control what goes into planning
- Non-food items are shown separately and excluded from the meal planning flow

All edits are PATCH'd to SQLite individually. Changes persist across page refreshes.

---

### Stage 3.5 — Product Catalog Matching

This stage enriches AI-extracted receipt items with verified catalog data.

**Data source:** `server/products.db` — 82,564 products from Rami Levy and Shufersal (read-only SQLite, sourced from Israeli price-transparency regulation).

**Trigger:** Manual — user clicks "התאם מוצרים לקטלוג" in ReceiptResults. Never runs automatically.

**Three-tier matching algorithm (`POST /api/products/match-items`):**

| Tier | Method | Threshold |
|---|---|---|
| 1 | Exact match on `normalized_product_name` | confidence = 1.0 → always `matched` |
| 2 | Partial LIKE (`%query%`) | conf ≥ 0.75 → `matched`; conf < 0.75 → `needs_review` |
| 3 | Token scoring — meaningful tokens only (excludes chain names, units, filler words) | conf ≥ 0.70 AND ≥1 meaningful token hit → `matched`; otherwise `needs_review` or `not_found` |

**Hebrew normalization:** `normalizeHebrewQuery()` expands abbreviations (ק"ג → קילוגרם, מ"ל → מיליליטר), collapses whitespace before matching.

**Stop tokens:** Chain names (שופרסל, רמי לוי…), units (גרם, קילוגרם…), and filler words (מארז, יחידה…) are excluded from meaningful token scoring to prevent false positives.

**Chain preference:** Products from the same detected chain get a small tiebreaker bonus (+0.02), but chain name alone can never cause acceptance.

**Result stored per item:**
- `catalog_match_status`: `"matched"` / `"needs_review"` / `"not_found"` / `"not_checked"`
- `catalog_match_confidence`: 0.0–1.0
- `catalog_needs_review`: boolean
- `catalog_*` fields: price, price_per_100g, category, calories/protein/carbs/fat per 100g, matched product name and ID

**Data separation guarantee:** All catalog fields are stored in separate columns (`catalog_*`). The original `price`, `calories_per_100g`, `protein_per_100g`, `carbs_per_100g`, `fat_per_100g` columns — set by the user or AI — are never overwritten by catalog matching.

---

### Stage 4 — Effective Item Value Resolution

Before sending items to the AI for shopping list generation, each item goes through `getEffectiveItemData()` (ShoppingListPage.jsx):

```
hasStrongCatalogMatch = (catalog_match_status === "matched") AND (!catalog_needs_review)

effective_price             = catalog_price             if hasStrongCatalogMatch, else price
effective_calories_per_100g = catalog_calories_per_100g if hasStrongCatalogMatch, else calories_per_100g
effective_protein_per_100g  = catalog_protein_per_100g  if hasStrongCatalogMatch, else protein_per_100g
effective_carbs_per_100g    = catalog_carbs_per_100g    if hasStrongCatalogMatch, else carbs_per_100g
effective_fat_per_100g      = catalog_fat_per_100g      if hasStrongCatalogMatch, else fat_per_100g
data_source                 = "catalog" | "receipt_ai"
```

**Data layer semantics:**

| Layer | Column prefix | Source | Mutated by user? |
|---|---|---|---|
| Original (AI/receipt) | `price`, `calories_per_100g`, etc. | Claude AI analysis | Yes — user can edit inline |
| Catalog metadata | `catalog_*` | products.db via matching endpoint | No — read-only reference |
| Effective (runtime) | `effective_*` | Computed in JS at generation time | Not persisted — compute-only |

`needs_review` items always use `receipt_ai` values. The catalog metadata is saved for display (badge) but never auto-applied to nutrition planning for uncertain matches.

---

### Stage 5 — Shopping List Generation

Using effective item values + user profile, Claude generates a 12–18 item shopping list:

**Inputs:**
- Effective food items (category, effective calories/macros per 100g, effective price, `source:catalog|receipt_ai`)
- User's daily calorie target and macro ratios
- Budget per purchase
- Shopping period in days (30 / purchases_per_month)
- Dietary restrictions and allergies (hard constraint)
- Favourite / disliked foods

**Budget enforcement (post-AI):**
If Claude's total exceeds the budget cap, the app removes the most expensive items iteratively until the sum is within budget (greedy trimming).

**Output fields per item:** name, category, quantity, estimated price (₪), total calories, protein (g), carbs (g), fat (g), health score (0–10), reason (Hebrew explanation)

---

### Stage 6 — Weekly Nutrition Plan Generation

From the shopping list, Claude generates a 7-day meal plan:

**Meals per day:** Breakfast / Lunch / Dinner / Snacks (4 meals)

**Per meal item:** food name, grams, calories, protein, carbs, fat, estimated cost

**Constraints:**
- Use ONLY foods from the shopping list
- Match daily calorie target (± ~5%)
- Respect all dietary restrictions (vegan/vegetarian/kosher/allergies)

---

### Stage 7 — Shopping List Quantity Optimization

After the nutrition plan is generated, `src/lib/shoppingOptimizer.js` recalculates:

- Total grams needed per food product across all 7 days
- Converts to purchase quantities (e.g., 1,400g chicken → 2 × 750g packs)
- Verifies the optimized list still fits within the budget cap

This "second pass" ensures shopping list quantities match exactly what the nutrition plan requires.

---

### Stage 8 — Final Outputs & Weight Tracking Loop

**Final results page:**
- Before/after comparison: monthly spending, health score, savings
- Shopping list and nutrition plan tabs with full item detail
- Empty state guards for missing plan or list

**Hebrew print (`/print`):**
- Full RTL printable summary: profile, shopping list, nutrition plan, before/after insights
- User presses Cmd+P (Mac) / Ctrl+P (PC) → Save as PDF

**Dynamic weight tracking (Dashboard):**
1. User enters current weight
2. App recalculates BMI: `weight / height²`
3. If `|newBMI − oldBMI| ≥ 2` — Hebrew alert appears with delta, category change, and action to re-run onboarding
4. After re-onboarding, user can regenerate shopping list and nutrition plan with updated profile

---

## Data Layer Architecture

### Three-layer data model for receipt items

```
receiptItems table
├── Original columns (price, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g)
│     Source: Claude AI analysis of receipt text
│     User-editable: yes (inline PATCH)
│
├── Catalog columns (catalog_price, catalog_calories_per_100g, ...)
│     Source: products.db (82,564 products, point-in-time catalog)
│     User-editable: no (set only by catalog matching endpoint)
│     catalog_match_status: "matched" | "needs_review" | "not_found" | "not_checked"
│
└── Effective values (effective_price, effective_calories_per_100g, ...)
      Source: computed at runtime by getEffectiveItemData()
      Used: only in shopping list generation prompt — never persisted
      Rule: use catalog iff status=matched AND !catalog_needs_review
```

### Data isolation

Every entity row has `created_by` = per-browser guest ID (from `localStorage` key `bettercart_guest_user_id`). All API queries filter by `created_by`. No entity row is ever readable by a different guest.

---

## Computer Science Value

### Data Pipeline Architecture
- Multi-stage ETL: raw receipt image → OCR → structured JSON → relational database rows
- Graceful degradation: every AI stage has a hardcoded Hebrew fallback (demo mode)
- Schema validation: JSON schema passed to Claude ensures structured, typed output

### Hebrew NLP & Receipt Processing
- Hebrew OCR via Claude Vision multimodal API
- Hebrew prompt engineering: system prompt in Hebrew, product names normalized to Standard Hebrew
- Date normalization across DD.MM.YYYY, YYYY-MM-DD, and free-text formats
- Hebrew abbreviation expansion (ק"ג → קילוגרם, מ"ל → מיליליטר)
- Stop-token filtering to prevent Hebrew chain names and units from inflating match scores

### Product Matching (Multi-tier Fuzzy Search)
- 3-tier cascade: exact → LIKE partial → token scoring with prefix fallback
- Meaningful token concept: excludes stop words, bare numbers, chain names
- Word boundary check: `(^|\s)token(\s|$)` regex prevents substring false positives
- Positional bonus: first meaningful query token is first product word
- Confidence + `needs_review` flags: uncertain matches visible in UI but not auto-applied

### Nutrition Calculations (no library, pure formulas)
- Mifflin-St Jeor BMR formula
- TDEE with 5 activity multipliers
- Goal-based calorie adjustment (deficit/surplus)
- Goal-specific macro ratios (protein-heavy for weight loss, carb-heavy for gain)

### Budget Optimization
- Hard constraint: shopping list total ≤ budget_per_purchase
- Greedy trimming: remove highest-cost items until constraint satisfied
- Quantity back-calculation: grams needed from nutrition plan → purchase units

### Full-Stack Architecture
- **Frontend:** React 18 SPA, React Query for server state, Tailwind CSS RTL
- **Backend:** Express REST API, better-sqlite3, generic CRUD with JSON column serialization
- **Catalog DB:** Separate read-only SQLite (`products.db`), never joined to app DB in shared transactions
- **AI:** Anthropic Claude Haiku (claude-haiku-4-5-20251001), direct browser API call with demo fallback
- **Persistence:** SQLite for structured data, localStorage for guest ID

### Academic CS Concepts Demonstrated
- REST API design with parameterized filtering, sorting, pagination
- SQLite schema design with JSON column types, boolean integer encoding, safe migrations
- React component architecture with custom hooks, context, and mutation patterns
- Asynchronous pipeline with progress tracking
- Multi-tier fuzzy matching with confidence scoring
- Runtime effective-value resolution pattern (compute-only, non-persisted layer)
- Per-entity data ownership and cross-user isolation

---

## Future Work (Post-MVP)

- Hebrew PDF via embedded RTL font in jsPDF
- Real email+password authentication
- Support additional supermarket chains (Victory, Mega, Osher Ad)
- Integration with official Israeli nutritional database (Malam)
- User-initiated resolution of `needs_review` catalog matches
- Mobile-responsive native app (React Native or PWA)
