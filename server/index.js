/**
 * BetterCart Express API server.
 * Provides generic CRUD routes for all entities.
 * Runs on http://localhost:3001
 */

import express from 'express';
import cors from 'cors';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';
import db from './db.js';
import {
  requireAuth, sessionUser, createSession, destroySession, createUser, verifyCredentials,
  findUserByEmail, normalizeEmail, isValidEmail, passwordError,
  loginBlocked, recordLoginFailure, clearLoginFailures,
} from './auth.js';

const app = express();
const PORT = process.env.PORT || 3001;

const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',').map(o => o.trim()).filter(Boolean)
);

app.use(cors({ origin: [...ALLOWED_ORIGINS], credentials: true }));
app.use(express.json({ limit: '10mb' }));

// Requests that change data must come from the app itself (defense in depth on
// top of SameSite=Lax cookies): a browser Origin header outside the allow-list is refused.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) return res.status(403).json({ error: 'בקשה ממקור לא מורשה' });
  next();
});

// ─── Products catalog DB (read-only) ─────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

let productsDb = null;
const PRODUCTS_DB_PATH = join(__dirname, 'products.db');
try {
  if (existsSync(PRODUCTS_DB_PATH)) {
    productsDb = new Database(PRODUCTS_DB_PATH, { readonly: true });
    const { n } = productsDb.prepare('SELECT COUNT(*) AS n FROM products').get();
    console.log(`Products catalog  → ${PRODUCTS_DB_PATH} (${n.toLocaleString()} products)`);
  } else {
    console.warn('Products catalog DB not found:', PRODUCTS_DB_PATH);
  }
} catch (err) {
  console.error('Failed to open products catalog:', err.message);
}

// ─── Catalog provider configuration ──────────────────────────────────────────
// products.db may contain data for multiple supermarket chains, but for this
// MVP only one chain is "active" (used by search/matching). To add another
// chain later: add an entry here and flip enabled: true — no other changes
// should be needed in the search/matching logic below.
const CATALOG_PROVIDERS = {
  shufersal: { label: 'שופרסל',  sourceChain: 'shufersal', enabled: true },
  rami_levy: { label: 'רמי לוי', sourceChain: 'rami_levy', enabled: false },
};
const ACTIVE_CATALOG_CHAIN = 'shufersal';
const SUPPORTED_CATALOG_CHAINS = Object.entries(CATALOG_PROVIDERS)
  .filter(([, cfg]) => cfg.enabled)
  .map(([key]) => key);

// Lightweight Hebrew query normalizer (mirrors Python text_normalization.py)
function normalizeHebrewQuery(text) {
  if (!text) return '';
  // Normalize Hebrew quotation marks
  text = text.replace(/[״"]/g, '"').replace(/[׳']/g, "'");
  // Expand unit abbreviations
  text = text.replace(/ק["״]ג|ק"ג/g, 'קילוגרם');
  text = text.replace(/\bקג\b/g, 'קילוגרם');
  text = text.replace(/\bקילו\b/g, 'קילוגרם');
  text = text.replace(/מ["״]ל|מ"ל/g, 'מיליליטר');
  text = text.replace(/\bמל\b/g, 'מיליליטר');
  // Grams: ג / ג' / גר / גר' are only a unit right after a number ("250 ג'",
  // "500ג"). Elsewhere ג' is part of a word (e.g. "קוטג'") and must be kept.
  text = text.replace(/(\d)\s*(?:גר'?|ג')(?![א-ת])/g, '$1 גרם');
  text = text.replace(/(\d)\s*ג(?![א-ת'])/g, '$1 גרם');
  // Catalog stores "קוטג'" / "חלב'" without the geresh (see Python normalizer)
  text = text.replace(/(חלב|קוטג)'/g, '$1');
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

// ─── Entity configuration ────────────────────────────────────────────────────

const VALID_ENTITIES = new Set([
  'userProfile',
  'receipts',
  'receiptItems',
  'shoppingLists',
  'nutritionPlans',
]);

// Fields serialized as JSON strings in SQLite
const JSON_FIELDS = {
  userProfile:   ['allergies', 'dietary_preferences', 'favorite_foods', 'disliked_foods'],
  receipts:      ['insights'],
  receiptItems:  [],
  shoppingLists: ['items'],
  nutritionPlans: ['days', 'before_after'],
};

// Fields stored as 0/1 integers (booleans) in SQLite
const BOOL_FIELDS = {
  userProfile:   ['onboarding_complete'],
  receipts:      [],
  receiptItems:  ['is_food', 'is_approved_for_menu', 'catalog_needs_review'],
  shoppingLists: ['complementary_added'],
  nutritionPlans: [],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

// Only allow simple identifier characters in dynamic column names to prevent injection
function isSafeFieldName(name) {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

// Convert SQLite row → JS record (parse JSON strings, convert 0/1 or true/false → boolean)
function rowToRecord(entity, row) {
  if (!row) return null;
  const record = { ...row };
  for (const field of JSON_FIELDS[entity] || []) {
    if (record[field] != null && typeof record[field] === 'string') {
      try { record[field] = JSON.parse(record[field]); } catch { record[field] = null; }
    }
  }
  for (const field of BOOL_FIELDS[entity] || []) {
    if (record[field] != null) record[field] = record[field] === 1 || record[field] === true;
  }
  return record;
}

// Convert JS record → SQLite row (stringify JSON, convert boolean → 0/1)
function recordToRow(entity, data) {
  const row = { ...data };
  for (const field of JSON_FIELDS[entity] || []) {
    if (row[field] !== undefined) row[field] = JSON.stringify(row[field]);
  }
  for (const field of BOOL_FIELDS[entity] || []) {
    if (row[field] !== undefined) row[field] = row[field] ? 1 : 0;
  }
  return row;
}

function insertRow(entity, data) {
  const row = recordToRow(entity, data);
  const cols = Object.keys(row).map(k => `"${k}"`).join(', ');
  const placeholders = Object.keys(row).map(() => '?').join(', ');
  db.prepare(`INSERT INTO "${entity}" (${cols}) VALUES (${placeholders})`).run(Object.values(row));
}

// ─── Middleware ───────────────────────────────────────────────────────────────

// Validate entity name on every route that uses :entity
app.param('entity', (req, res, next, entity) => {
  if (!VALID_ENTITIES.has(entity)) {
    return res.status(404).json({ error: `Unknown entity: ${entity}` });
  }
  next();
});

// ─── Routes ──────────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'BetterCart API is running',
    timestamp: new Date().toISOString(),
  });
});

// ─── Product catalog routes ───────────────────────────────────────────────────
// These MUST be declared before GET /api/:entity to avoid param capture.

// Stats / debug
app.get('/api/products/stats', (_req, res) => {
  if (!productsDb) {
    return res.json({ connected: false, message: 'Products catalog DB not loaded' });
  }
  try {
    const total     = productsDb.prepare('SELECT COUNT(*) AS n FROM products').get().n;
    const food      = productsDb.prepare("SELECT COUNT(*) AS n FROM products WHERE is_food = 1").get().n;
    const official  = productsDb.prepare("SELECT COUNT(*) AS n FROM products WHERE is_food = 1 AND data_confidence = 'official'").get().n;
    const byChain   = productsDb.prepare("SELECT source_chain AS chain, COUNT(*) AS n FROM products WHERE is_food = 1 GROUP BY source_chain").all();
    const topCats   = productsDb.prepare("SELECT category, COUNT(*) AS n FROM products WHERE is_food = 1 AND data_confidence = 'official' GROUP BY category ORDER BY n DESC LIMIT 10").all();
    const sample    = productsDb.prepare("SELECT original_product_name, price, category, source_chain FROM products WHERE is_food = 1 AND data_confidence = 'official' AND price > 0 ORDER BY RANDOM() LIMIT 5").all();
    const activeTotal = productsDb.prepare('SELECT COUNT(*) AS n FROM products WHERE source_chain = ?').get(ACTIVE_CATALOG_CHAIN).n;
    const activeFood   = productsDb.prepare('SELECT COUNT(*) AS n FROM products WHERE source_chain = ? AND is_food = 1').get(ACTIVE_CATALOG_CHAIN).n;
    res.json({
      connected: true,
      total_products: total,
      food_products: food,
      official_food_products: official,
      by_chain: byChain,
      top_categories: topCats,
      sample_products: sample,
      active_chain: ACTIVE_CATALOG_CHAIN,
      active_chain_total_products: activeTotal,
      active_chain_food_products: activeFood,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search
app.get('/api/products/search', (req, res) => {
  if (!productsDb) {
    return res.status(503).json({ error: 'Products catalog DB not loaded', results: [] });
  }

  const { q, chain, limit: limitParam } = req.query;
  if (!q || q.trim().length < 2) {
    return res.status(400).json({ error: 'Query must be at least 2 characters', results: [] });
  }

  const query      = normalizeHebrewQuery(q.trim());
  const limitN     = Math.min(parseInt(limitParam, 10) || 5, 20);

  // MVP: catalog search is fixed to ACTIVE_CATALOG_CHAIN regardless of the
  // requested `chain` param — see CATALOG_PROVIDERS config above.
  const requestedChain = chain || null;
  const chainFilter = ACTIVE_CATALOG_CHAIN;
  const chainClause = ' AND source_chain = ?';
  const chainForced = requestedChain != null && requestedChain !== ACTIVE_CATALOG_CHAIN;

  const SELECT_COLS = `
    SELECT
      id                     AS product_id,
      source_chain           AS chain,
      original_product_name,
      normalized_product_name,
      category,
      price,
      price_per_100g,
      quantity_in_grams,
      calories_per_100g,
      protein_per_100g,
      carbs_per_100g,
      fat_per_100g,
      is_food,
      overall_score,
      data_confidence
    FROM products
    WHERE is_food = 1
  `;

  try {
    // 1 — Exact match on normalized_product_name
    const exactParams = chainFilter ? [query, chainFilter] : [query];
    const exactRows = productsDb.prepare(`
      ${SELECT_COLS}
        AND normalized_product_name = ?
        ${chainClause}
      ORDER BY overall_score DESC NULLS LAST
      LIMIT ${limitN}
    `).all(...exactParams);

    const seen    = new Set(exactRows.map(r => r.product_id));
    const results = exactRows.map(r => ({ ...r, match_type: 'exact', match_confidence: 'high' }));

    // 2 — LIKE partial match for remaining slots
    if (results.length < limitN) {
      const remaining   = limitN - results.length;
      const likeParam   = `%${query}%`;
      const partialArgs = chainFilter
        ? [likeParam, likeParam, chainFilter]
        : [likeParam, likeParam];

      const partialRows = productsDb.prepare(`
        ${SELECT_COLS}
          AND (normalized_product_name LIKE ? OR original_product_name LIKE ?)
          ${chainClause}
        ORDER BY overall_score DESC NULLS LAST
        LIMIT ${remaining * 4}
      `).all(...partialArgs);

      for (const row of partialRows) {
        if (!seen.has(row.product_id) && results.length < limitN) {
          seen.add(row.product_id);
          results.push({ ...row, match_type: 'partial', match_confidence: 'medium' });
        }
      }
    }

    res.json({
      query,
      normalized_query: query,
      chain_filter: chainFilter,
      active_catalog_chain: ACTIVE_CATALOG_CHAIN,
      requested_chain: requestedChain,
      chain_forced: chainForced,
      message: chainForced
        ? `הצ'אין המבוקש (${requestedChain}) אינו נתמך ב-MVP הנוכחי — הקטלוג הפעיל קבוע ל-${ACTIVE_CATALOG_CHAIN}`
        : undefined,
      total: results.length,
      results,
    });
  } catch (err) {
    res.status(500).json({ error: err.message, results: [] });
  }
});

// Batch match receipt item names against the product catalog
app.post('/api/products/match-items', (req, res) => {
  if (!productsDb) {
    return res.status(503).json({ error: 'Products catalog DB not loaded' });
  }
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items must be a non-empty array' });
  }
  if (items.length > 50) {
    return res.status(400).json({ error: 'Maximum 50 items per request' });
  }

  // MVP: matching is fixed to ACTIVE_CATALOG_CHAIN regardless of item.chain —
  // see CATALOG_PROVIDERS config near the top of this file.

  // Tokens that don't identify a product on their own — matching only these should never
  // produce a matched:true result (chain names, units, generic filler words, bare numbers)
  const STOP_TOKENS = new Set([
    'שופרסל', 'רמי', 'לוי', 'קארפור', 'ויקטורי', 'מגה', 'ביתן',
    'גרם', 'קילוגרם', 'מיליליטר', 'ליטר',
    'מותג', 'מוצר', 'יחידה', 'מארז', 'אחוז',
  ]);

  // A token is "meaningful" if it is not a stop word and not a bare number/percentage
  function isMeaningful(t) {
    if (STOP_TOKENS.has(t)) return false;
    if (/^\d+([.%]\d*)?$/.test(t)) return false;
    return true;
  }

  // Check that token appears as a whole word in the product name, not as a substring of another word
  // e.g. "חלב" should NOT match inside "מחלב" or "חלבי"
  function matchesAsWord(prodNorm, token) {
    const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\s)${esc}(\\s|$)`).test(prodNorm);
  }

  const COLS = `
    SELECT
      id AS product_id,
      source_chain AS chain,
      original_product_name,
      normalized_product_name,
      category,
      price,
      price_per_100g,
      calories_per_100g,
      protein_per_100g,
      carbs_per_100g,
      fat_per_100g,
      overall_score
    FROM products
    WHERE is_food = 1
  `;

  function buildMatch(base, row, matchType, confidence, extra = {}) {
    return {
      ...base,
      matched: true,
      matched_product_id: String(row.product_id),
      matched_name: row.original_product_name,
      normalized_product_name: row.normalized_product_name,
      chain: row.chain,
      price: row.price ?? null,
      price_per_100g: row.price_per_100g ?? null,
      category: row.category ?? null,
      calories_per_100g: row.calories_per_100g ?? null,
      protein_per_100g: row.protein_per_100g ?? null,
      carbs_per_100g: row.carbs_per_100g ?? null,
      fat_per_100g: row.fat_per_100g ?? null,
      match_type: matchType,
      match_confidence: parseFloat(confidence.toFixed(2)),
      catalog_chain: ACTIVE_CATALOG_CHAIN,
      active_catalog_chain: ACTIVE_CATALOG_CHAIN,
      ...extra,
    };
  }

  function buildBestCandidate(row, confidence, matchType) {
    return {
      matched_product_id: String(row.product_id),
      matched_name: row.original_product_name,
      chain: row.chain,
      catalog_chain: ACTIVE_CATALOG_CHAIN,
      price: row.price ?? null,
      category: row.category ?? null,
      match_type: matchType,
      match_confidence: parseFloat(confidence.toFixed(2)),
    };
  }

  function matchOne(item) {
    const inputName = item.normalized_name || item.name || '';
    const normalized = normalizeHebrewQuery(inputName);
    // MVP: always match within ACTIVE_CATALOG_CHAIN — item.chain (e.g. from
    // detected receipt store) is intentionally ignored for filtering.
    const chainClause = ' AND source_chain = ?';
    const chainParams = [ACTIVE_CATALOG_CHAIN];

    const base = { input_name: inputName, matched: false, match_confidence: 0 };
    if (!normalized || normalized.length < 2) return base;

    // Tier 1: exact on normalized_product_name
    const exactRows = productsDb.prepare(
      `${COLS} AND normalized_product_name = ? ${chainClause} ORDER BY overall_score DESC NULLS LAST LIMIT 3`
    ).all(normalized, ...chainParams);
    if (exactRows.length > 0) return buildMatch(base, exactRows[0], 'exact', 1.0);

    // Tier 2: partial LIKE (full normalized query is substring of product name)
    const likeParam = `%${normalized}%`;
    const partialRows = productsDb.prepare(
      `${COLS} AND normalized_product_name LIKE ? ${chainClause} ORDER BY overall_score DESC NULLS LAST LIMIT 15`
    ).all(likeParam, ...chainParams);

    // Tier 3: token LIKE — query only on meaningful (non-stop) tokens.
    // Restricted to ACTIVE_CATALOG_CHAIN like every other tier.
    const allTokens = normalized.split(/\s+/).filter(t => t.length >= 2);
    const sigTokens = allTokens.filter(t => t.length >= 3);
    const meaningfulTokens = sigTokens.filter(isMeaningful);

    let tokenRows = [];
    let prefixRows = [];
    if (meaningfulTokens.length > 0) {
      // Broad token search (any-position LIKE, capped at 60)
      const orClauses = meaningfulTokens.map(() => 'normalized_product_name LIKE ?').join(' OR ');
      const tokenLikeParams = meaningfulTokens.map(t => `%${t}%`);
      tokenRows = productsDb.prepare(
        `${COLS} AND (${orClauses}) ${chainClause} ORDER BY overall_score DESC NULLS LAST LIMIT 60`
      ).all(...tokenLikeParams, ...chainParams);

      // Prefix search: products that START WITH one of the meaningful tokens.
      // These can rank below LIMIT 60 in overall_score yet be the correct match
      // (e.g. "חלב תנובה 3%" scores 61.9 but "חלב" as first word is precisely correct).
      const prefClauses = meaningfulTokens.flatMap(t => [
        `normalized_product_name LIKE ?`,
        `normalized_product_name = ?`,
      ]).join(' OR ');
      const prefParams = meaningfulTokens.flatMap(t => [`${t} %`, t]);
      prefixRows = productsDb.prepare(
        `${COLS} AND (${prefClauses}) ${chainClause} ORDER BY overall_score DESC NULLS LAST LIMIT 20`
      ).all(...prefParams, ...chainParams);
    }

    // Merge, deduplicate, and score all candidates
    const seen = new Set();
    const candidates = [];
    for (const row of [...partialRows, ...tokenRows, ...prefixRows]) {
      if (!seen.has(row.product_id)) {
        seen.add(row.product_id);
        candidates.push(row);
      }
    }
    if (candidates.length === 0) return base;

    const scored = candidates.map(c => {
      const prodNorm = (c.normalized_product_name || '').toLowerCase();
      const qLow = normalized.toLowerCase();
      const isContains = prodNorm.includes(qLow);
      const isReverse = !isContains && qLow.includes(prodNorm) && prodNorm.length >= 4;

      // Count only meaningful tokens that appear as whole words in the product name.
      // Substring-only hits (e.g. "חלב" inside "מחלב") do not count.
      const meaningfulHits = meaningfulTokens.filter(t => matchesAsWord(prodNorm, t)).length;
      const meaningfulRatio = meaningfulTokens.length > 0 ? meaningfulHits / meaningfulTokens.length : 0;

      let conf, type;
      if (isContains) {
        const coverage = qLow.length / Math.max(prodNorm.length, qLow.length);
        conf = 0.65 + coverage * 0.25;
        type = 'partial';
      } else if (isReverse) {
        conf = 0.55 + (prodNorm.length / qLow.length) * 0.2;
        type = 'partial';
      } else {
        conf = 0.35 + meaningfulRatio * 0.4;
        type = 'token';
      }
      // Positional bonus: first meaningful query token is the first word of the product
      // (e.g. "חלב" in "חלב תנובה" vs "חלב" buried in "קרם רחצה חלב שקדים")
      if (meaningfulTokens.length > 0) {
        const firstProdWord = prodNorm.split(/\s+/)[0];
        if (firstProdWord === meaningfulTokens[0]) conf += 0.05;
      }
      // No chain-preference bonus needed: all candidates are already
      // restricted to ACTIVE_CATALOG_CHAIN.
      if (c.calories_per_100g != null) conf += 0.01;
      if (c.overall_score) conf += c.overall_score / 5000;
      return { row: c, conf: Math.min(0.95, conf), type, meaningfulHits };
    });

    scored.sort((a, b) => b.conf - a.conf);
    const best = scored[0];

    // ── Confidence thresholds ────────────────────────────────────────────────
    if (best.type === 'exact') {
      return buildMatch(base, best.row, 'exact', 1.0);
    }

    if (best.type === 'partial') {
      if (best.conf >= 0.75) {
        const extra = best.conf < 0.85 ? { needs_review: true } : {};
        return buildMatch(base, best.row, 'partial', best.conf, extra);
      }
      // Partial match too weak — return rejected with best_candidate
      return {
        ...base,
        match_confidence: parseFloat(best.conf.toFixed(2)),
        reason: 'low_confidence_partial_match',
        best_candidate: buildBestCandidate(best.row, best.conf, 'partial'),
      };
    }

    // Token match: require conf >= 0.7 AND at least one meaningful token matched
    if (best.type === 'token') {
      if (best.conf >= 0.7 && best.meaningfulHits >= 1) {
        return buildMatch(base, best.row, 'token', best.conf, { needs_review: true });
      }
      return {
        ...base,
        match_confidence: parseFloat(best.conf.toFixed(2)),
        reason: best.meaningfulHits < 1
          ? 'no_meaningful_token_match'
          : 'low_confidence_token_match',
        best_candidate: buildBestCandidate(best.row, best.conf, 'token'),
      };
    }

    return base;
  }

  try {
    const matches = items.map(item => {
      try { return matchOne(item); }
      catch (err) {
        return { input_name: item.normalized_name || item.name || '', matched: false, match_confidence: 0, error: err.message };
      }
    });
    res.json({
      total: items.length,
      matched: matches.filter(m => m.matched).length,
      active_catalog_chain: ACTIVE_CATALOG_CHAIN,
      matches,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Accounts ────────────────────────────────────────────────────────────────

// Register: creates the account and signs the user in
app.post('/api/auth/register', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = req.body?.password;
  if (!isValidEmail(email)) return res.status(400).json({ error: 'כתובת האימייל אינה תקינה' });
  const pwError = passwordError(password);
  if (pwError) return res.status(400).json({ error: pwError });
  if (findUserByEmail(email)) return res.status(409).json({ error: 'האימייל כבר רשום במערכת' });
  try {
    const user = await createUser(email, password);
    createSession(res, user.id);
    res.status(201).json({ user });
  } catch (err) {
    if (/UNIQUE/.test(err.message)) return res.status(409).json({ error: 'האימייל כבר רשום במערכת' });
    console.error('[auth] register failed');
    res.status(500).json({ error: 'יצירת החשבון נכשלה. נסו שוב.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const limitKey = `${req.ip}|${email}`;
  if (loginBlocked(limitKey)) {
    return res.status(429).json({ error: 'יותר מדי ניסיונות התחברות. נסו שוב בעוד כמה דקות.' });
  }
  const user = await verifyCredentials(email, req.body?.password);
  if (!user) {
    recordLoginFailure(limitKey);
    return res.status(401).json({ error: 'פרטי ההתחברות שגויים' });
  }
  clearLoginFailures(limitKey);
  createSession(res, user.id);
  res.json({ user });
});

app.post('/api/auth/logout', (req, res) => {
  destroySession(req, res);
  res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
  const user = sessionUser(req);
  if (!user) return res.status(401).json({ error: 'לא מחובר' });
  res.json({ user });
});

// ─── Legacy guest data ───────────────────────────────────────────────────────
// Rows created before accounts existed are owned by browser-generated guest ids.
// A guest id is not proof of ownership (it lived in localStorage, unsigned), so
// there is deliberately no API to claim guest data. Moving it into an account
// is a manual, server-side operator task: see server/scripts/migrate-legacy-guest.js.

// ─── Personal data CRUD ──────────────────────────────────────────────────────
// Every route below requires a session. The owner is always the signed-in user:
// created_by from the client is ignored, and reads/updates/deletes are scoped
// to rows where created_by = req.userId (another user's id behaves like a missing row).

// Fields the client may never set
const PROTECTED_FIELDS = ['id', 'created_by', 'created_date'];
function withoutProtected(data) {
  const clean = { ...(data && typeof data === 'object' ? data : {}) };
  for (const f of PROTECTED_FIELDS) delete clean[f];
  return clean;
}

// LIST / FILTER  GET /api/:entity?sort=-created_date&limit=5&receipt_id=abc
app.get('/api/:entity', requireAuth, (req, res) => {
  const { entity } = req.params;
  const { sort, limit, ...filters } = req.query;

  const filterKeys = Object.keys(filters).filter(k => isSafeFieldName(k) && k !== 'created_by');
  const boolFields = new Set(BOOL_FIELDS[entity] || []);

  let query = `SELECT * FROM "${entity}" WHERE created_by = ?`;
  const params = [req.userId];

  for (const k of filterKeys) {
    let v = filters[k];
    // URLSearchParams sends booleans as strings; coerce back to 0/1 for SQLite
    if (boolFields.has(k)) v = (v === 'true' || v === '1') ? 1 : 0;
    params.push(v);
    query += ` AND "${k}" = ?`;
  }

  if (sort) {
    const desc = sort.startsWith('-');
    const field = desc ? sort.slice(1) : sort;
    if (isSafeFieldName(field)) {
      query += ` ORDER BY "${field}" ${desc ? 'DESC' : 'ASC'}`;
    }
  }

  if (limit) {
    const n = parseInt(limit, 10);
    if (!isNaN(n)) query += ` LIMIT ${n}`;
  }

  try {
    const rows = db.prepare(query).all(...params);
    res.json(rows.map(row => rowToRecord(entity, row)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CREATE  POST /api/:entity
app.post('/api/:entity', requireAuth, (req, res) => {
  const { entity } = req.params;

  // One profile per user: creating again (e.g. a double-submitted onboarding)
  // updates the existing profile instead of adding a duplicate
  if (entity === 'userProfile') {
    const existing = db.prepare('SELECT id FROM "userProfile" WHERE created_by = ? ORDER BY created_date LIMIT 1').get(req.userId);
    if (existing) {
      const row = recordToRow(entity, withoutProtected(req.body));
      const keys = Object.keys(row).filter(isSafeFieldName);
      try {
        if (keys.length) {
          db.prepare(`UPDATE "userProfile" SET ${keys.map(k => `"${k}" = ?`).join(', ')} WHERE id = ? AND created_by = ?`)
            .run(...keys.map(k => row[k]), existing.id, req.userId);
        }
        return res.json(rowToRecord(entity, db.prepare('SELECT * FROM "userProfile" WHERE id = ?').get(existing.id)));
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  }

  const data = {
    ...withoutProtected(req.body),
    id: generateId(),
    created_date: new Date().toISOString(),
    created_by: req.userId,
  };
  try {
    insertRow(entity, data);
    res.status(201).json(rowToRecord(entity, data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// BULK CREATE  POST /api/:entity/bulk
app.post('/api/:entity/bulk', requireAuth, (req, res) => {
  const { entity } = req.params;
  if (!Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Request body must be an array' });
  }
  const now = new Date().toISOString();
  const created = req.body.map(item => ({
    ...withoutProtected(item),
    id: generateId(),
    created_date: now,
    created_by: req.userId,
  }));
  try {
    const insertAll = db.transaction(() => created.forEach(d => insertRow(entity, d)));
    insertAll();
    res.status(201).json(created.map(d => rowToRecord(entity, d)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE  PATCH /api/:entity/:id
app.patch('/api/:entity/:id', requireAuth, (req, res) => {
  const { entity, id } = req.params;
  const existing = db.prepare(`SELECT id FROM "${entity}" WHERE id = ? AND created_by = ?`).get(id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Record not found' });

  const row = recordToRow(entity, withoutProtected(req.body));
  const safeKeys = Object.keys(row).filter(isSafeFieldName);
  if (safeKeys.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  const setClauses = safeKeys.map(k => `"${k}" = ?`).join(', ');
  const values = safeKeys.map(k => row[k]);

  try {
    db.prepare(`UPDATE "${entity}" SET ${setClauses} WHERE id = ? AND created_by = ?`).run(...values, id, req.userId);
    const updated = db.prepare(`SELECT * FROM "${entity}" WHERE id = ? AND created_by = ?`).get(id, req.userId);
    res.json(rowToRecord(entity, updated));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE  DELETE /api/:entity/:id
app.delete('/api/:entity/:id', requireAuth, (req, res) => {
  const { entity, id } = req.params;
  try {
    const { changes } = db.prepare(`DELETE FROM "${entity}" WHERE id = ? AND created_by = ?`).run(id, req.userId);
    if (changes === 0) return res.status(404).json({ error: 'Record not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`BetterCart server → http://localhost:${PORT}`);
  console.log(`Health check     → http://localhost:${PORT}/api/health`);
});
