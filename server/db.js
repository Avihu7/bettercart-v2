/**
 * SQLite database setup for BetterCart.
 * Creates all tables if they don't exist.
 * JSON columns store arrays/objects as serialized strings.
 * Boolean columns store true/false as 1/0 integers.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, 'bettercart.db'));

// WAL mode is faster for concurrent reads
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS userProfile (
    id                   TEXT PRIMARY KEY,
    created_date         TEXT NOT NULL,
    created_by           TEXT DEFAULT 'demo@bettercart.app',
    age                  INTEGER,
    gender               TEXT,
    height               REAL,
    weight               REAL,
    activity_level       TEXT,
    goal                 TEXT,
    allergies            TEXT DEFAULT '[]',
    dietary_preferences  TEXT DEFAULT '[]',
    favorite_foods       TEXT DEFAULT '[]',
    disliked_foods       TEXT DEFAULT '[]',
    monthly_budget       REAL,
    purchases_per_month  INTEGER,
    budget_per_purchase  REAL,
    bmi                  REAL,
    bmr                  REAL,
    daily_calories       INTEGER,
    protein_target       INTEGER,
    carbs_target         INTEGER,
    fat_target           INTEGER,
    health_score         INTEGER,
    onboarding_complete  INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS receipts (
    id                   TEXT PRIMARY KEY,
    created_date         TEXT NOT NULL,
    created_by           TEXT DEFAULT 'demo@bettercart.app',
    store_name           TEXT,
    purchase_date        TEXT,
    total_amount         REAL,
    raw_text             TEXT,
    file_url             TEXT,
    status               TEXT DEFAULT 'uploaded',
    ai_raw_output        TEXT,
    insights             TEXT DEFAULT '{}',
    food_item_count      INTEGER DEFAULT 0,
    non_food_item_count  INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS receiptItems (
    id                   TEXT PRIMARY KEY,
    created_date         TEXT NOT NULL,
    created_by           TEXT DEFAULT 'demo@bettercart.app',
    receipt_id           TEXT,
    original_name        TEXT,
    normalized_name      TEXT,
    category             TEXT,
    is_food              INTEGER DEFAULT 1,
    is_approved_for_menu INTEGER DEFAULT 1,
    quantity             TEXT,
    price                REAL,
    calories_per_100g    REAL,
    protein_per_100g     REAL,
    carbs_per_100g       REAL,
    fat_per_100g         REAL,
    health_score         INTEGER,
    reasoning            TEXT
  );

  CREATE TABLE IF NOT EXISTS shoppingLists (
    id                   TEXT PRIMARY KEY,
    created_date         TEXT NOT NULL,
    created_by           TEXT DEFAULT 'demo@bettercart.app',
    receipt_id           TEXT,
    title                TEXT,
    shopping_period_days INTEGER,
    total_estimated_cost REAL,
    total_calories       INTEGER,
    status               TEXT DEFAULT 'draft',
    items                TEXT DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS nutritionPlans (
    id                   TEXT PRIMARY KEY,
    created_date         TEXT NOT NULL,
    created_by           TEXT DEFAULT 'demo@bettercart.app',
    shopping_list_id     TEXT,
    title                TEXT,
    daily_calories       INTEGER,
    weekly_calories      INTEGER,
    estimated_weekly_cost REAL,
    status               TEXT DEFAULT 'draft',
    days                 TEXT DEFAULT '[]',
    before_after         TEXT DEFAULT '{}'
  );
`);

// Add strength_training column if not yet present (safe migration)
try {
  db.exec("ALTER TABLE userProfile ADD COLUMN strength_training TEXT DEFAULT 'none'");
} catch { /* column already exists — skip */ }

// Catalog matching fields for receiptItems (safe migrations — skip if already present)
const catalogCols = [
  "ALTER TABLE receiptItems ADD COLUMN matched_product_id      TEXT",
  "ALTER TABLE receiptItems ADD COLUMN matched_product_name    TEXT",
  "ALTER TABLE receiptItems ADD COLUMN catalog_chain           TEXT",
  "ALTER TABLE receiptItems ADD COLUMN catalog_price           REAL",
  "ALTER TABLE receiptItems ADD COLUMN catalog_price_per_100g  REAL",
  "ALTER TABLE receiptItems ADD COLUMN catalog_category        TEXT",
  "ALTER TABLE receiptItems ADD COLUMN catalog_calories_per_100g REAL",
  "ALTER TABLE receiptItems ADD COLUMN catalog_protein_per_100g  REAL",
  "ALTER TABLE receiptItems ADD COLUMN catalog_carbs_per_100g    REAL",
  "ALTER TABLE receiptItems ADD COLUMN catalog_fat_per_100g      REAL",
  "ALTER TABLE receiptItems ADD COLUMN catalog_match_type        TEXT",
  "ALTER TABLE receiptItems ADD COLUMN catalog_match_confidence  REAL",
  "ALTER TABLE receiptItems ADD COLUMN catalog_needs_review      INTEGER DEFAULT 0",
  "ALTER TABLE receiptItems ADD COLUMN catalog_match_status      TEXT DEFAULT 'not_checked'",
];
for (const sql of catalogCols) {
  try { db.exec(sql); } catch { /* column already exists — skip */ }
}

// Marks whether shopping list generation added catalog items to diversify
// beyond the receipt (safe migration)
try {
  db.exec("ALTER TABLE shoppingLists ADD COLUMN complementary_added INTEGER DEFAULT 0");
} catch { /* column already exists — skip */ }

// Final shopping lists (status 'final') point at the nutrition plan whose
// weekly usage their quantities were calculated from (safe migration)
try {
  db.exec("ALTER TABLE shoppingLists ADD COLUMN nutrition_plan_id TEXT");
} catch { /* column already exists — skip */ }

// ─── User accounts & sessions ────────────────────────────────────────────────
// Personal rows (profile, receipts, lists, plans) belong to a user through
// created_by = users.id. Sessions store only a SHA-256 hash of the cookie token.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash   TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    last_used_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  -- One-time password-reset links: only a SHA-256 hash of the emailed token is stored
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at    TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

  CREATE INDEX IF NOT EXISTS idx_userProfile_owner    ON userProfile(created_by);
  CREATE INDEX IF NOT EXISTS idx_receipts_owner       ON receipts(created_by);
  CREATE INDEX IF NOT EXISTS idx_receiptItems_owner   ON receiptItems(created_by);
  CREATE INDEX IF NOT EXISTS idx_shoppingLists_owner  ON shoppingLists(created_by);
  CREATE INDEX IF NOT EXISTS idx_nutritionPlans_owner ON nutritionPlans(created_by);
`);

export default db;
