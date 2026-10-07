/**
 * Purchase history across a user's receipts — a soft preference signal for
 * the smart basket. Computed on demand from receipts + receiptItems (the only
 * source of truth; nothing is stored), so corrections and deletions of
 * receipt data are reflected automatically.
 *
 * Only reliable items count: food, fit for the menu, and matched or approved
 * by the user (never items awaiting review, not found, non-food or ignored).
 * The window is the user's 12 most recent receipts that have such an item.
 *
 * Per product:
 *   frequency  = receipts containing it / receipts in the window  (distinct receipts)
 *   recency    = exp(-ln 2 · daysSinceLastSeen / 30)               (half-life 30 days)
 *   quality    = health score / 10 (deterministic, from the product name — src/lib/healthScore.js;
 *                0.5 when unknown — neutral, not a penalty)
 *   raw        = 0.55·frequency + 0.20·recency + 0.25·quality
 *   confidence = min(receiptsInWindow / 5, 1)                      (how much we know)
 *   score      = 0.5 + confidence · (raw − 0.5)                    (few receipts → stays near neutral)
 */

import { productHealthScore, healthScoreName } from '../src/lib/healthScore.js';

const WINDOW_RECEIPTS = 12;
const HALF_LIFE_DAYS = 30;
const FULL_CONFIDENCE_RECEIPTS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
const clamp01 = n => Math.min(1, Math.max(0, n));

/** The date a receipt's purchase happened: purchase_date when plausible, else upload date. */
export function receiptDate(receipt, now = new Date()) {
  const p = String(receipt.purchase_date || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(p)) {
    const d = new Date(p.slice(0, 10) + 'T12:00:00Z');
    if (!isNaN(d) && d.getUTCFullYear() >= 2015 && d.getTime() <= now.getTime() + 2 * DAY_MS) return d;
  }
  const c = new Date(receipt.created_date);
  return isNaN(c) ? now : c;
}

// Name key for products without a catalog code: no quotes/punctuation, final
// letters unified, pack sizes dropped ("קוטג' תנובה 5% 250 גרם" → "קוטג תנובה 5%")
const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
export function nameKey(name) {
  return String(name || '')
    .replace(/[׳'`´"״]/g, '')
    .replace(/[ךםןףץ]/g, c => FINALS[c])
    .replace(/\d+(?:[.,]\d+)?\s*(?:גרמ|גר|ג|קג|קילו|ליטר|ל|מל|יחידות|יח)(?![א-ת])/g, ' ')
    .replace(/[-–—,().*+×/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Pure aggregation (no DB access). rows: reliable receipt items joined with
 * their receipt's dates; itemCodeById: catalog row id → chain item_code.
 */
export function computePurchaseHistory(rows, itemCodeById = new Map(), now = new Date()) {
  // Window: the most recent receipts that have at least one reliable item
  const receipts = new Map();
  for (const r of rows) {
    if (!receipts.has(r.receipt_id)) receipts.set(r.receipt_id, receiptDate(r, now));
  }
  const window = [...receipts.entries()].sort((a, b) => b[1] - a[1]).slice(0, WINDOW_RECEIPTS);
  const inWindow = new Map(window);
  const totalReceipts = inWindow.size;
  const confidence = Math.min(totalReceipts / FULL_CONFIDENCE_RECEIPTS, 1);

  // Product identity: catalog item_code first, then the matched catalog name, then the receipt name.
  // A name seen with a catalog code anywhere is attached to that code.
  const codeOf = r => (r.matched_product_id != null ? itemCodeById.get(String(r.matched_product_id)) : null) || null;
  const displayName = r => (r.catalog_match_type === 'manual' && r.matched_product_name) || r.normalized_name || r.original_name || r.matched_product_name;
  const codeByName = new Map();
  for (const r of rows) {
    const code = codeOf(r);
    if (!code) continue;
    for (const n of [r.matched_product_name, r.normalized_name]) if (n) codeByName.set(nameKey(n), code);
  }
  const keyOf = r => {
    const code = codeOf(r) || codeByName.get(nameKey(r.matched_product_name)) || codeByName.get(nameKey(r.normalized_name));
    if (code) return { key: `code:${code}`, code };
    return { key: `name:${nameKey(r.matched_product_name || r.normalized_name || r.original_name)}`, code: null };
  };

  const products = new Map();
  for (const r of rows) {
    const date = inWindow.get(r.receipt_id);
    if (!date) continue;
    const { key, code } = keyOf(r);
    if (key === 'name:') continue;
    let p = products.get(key);
    if (!p) {
      p = { product_key: key, item_code: code, receipts: new Set(), scores: [], last: null, sample: null };
      products.set(key, p);
    }
    p.receipts.add(r.receipt_id);
    // Recomputed (not the stored value) so receipts saved before scores were deterministic agree too
    const hs = productHealthScore(healthScoreName({ ...r, catalog_match_status: r.catalog_match_status ?? 'matched' }));
    if (hs != null) p.scores.push(hs);
    if (!p.last || date > p.last) {
      p.last = date;
      p.sample = r; // most recent appearance represents the product
    }
  }

  return [...products.values()].map(p => {
    const days = Math.max(0, Math.floor((now - p.last) / DAY_MS));
    const frequency = totalReceipts ? p.receipts.size / totalReceipts : 0;
    const recency = Math.exp(-Math.LN2 * days / HALF_LIFE_DAYS);
    const avgHealth = p.scores.length ? p.scores.reduce((a, b) => a + b, 0) / p.scores.length : null;
    const quality = avgHealth == null ? 0.5 : clamp01(avgHealth / 10);
    const raw = 0.55 * frequency + 0.20 * recency + 0.25 * quality;
    const score = 0.5 + confidence * (raw - 0.5);
    const s = p.sample;
    return {
      product_key: p.product_key,
      item_code: p.item_code,
      name: displayName(s),
      receipt_count: p.receipts.size,
      total_receipts: totalReceipts,
      frequency_score: round(frequency),
      last_seen: p.last.toISOString().slice(0, 10),
      days_since_last_seen: days,
      recency_score: round(recency),
      avg_health_score: avgHealth == null ? null : round(avgHealth, 1),
      quality_score: round(quality),
      confidence: round(confidence),
      raw_history_score: round(raw),
      history_score: round(score),
      // The latest appearance, to build a basket item from (no receipt text)
      latest_item: {
        id: s.id, receipt_id: s.receipt_id,
        original_name: s.original_name, normalized_name: s.normalized_name,
        category: s.category, quantity: s.quantity, price: s.price,
        is_food: true, is_approved_for_menu: !!s.is_approved_for_menu, user_edited: !!s.user_edited, health_score: productHealthScore(healthScoreName(s)),
        calories_per_100g: s.calories_per_100g, protein_per_100g: s.protein_per_100g,
        carbs_per_100g: s.carbs_per_100g, fat_per_100g: s.fat_per_100g,
        matched_product_id: s.matched_product_id, matched_product_name: s.matched_product_name,
        catalog_chain: s.catalog_chain, catalog_price: s.catalog_price, catalog_price_per_100g: s.catalog_price_per_100g,
        catalog_pack_grams: s.catalog_pack_grams, catalog_sold_by_weight: !!s.catalog_sold_by_weight,
        catalog_calories_per_100g: s.catalog_calories_per_100g, catalog_protein_per_100g: s.catalog_protein_per_100g,
        catalog_carbs_per_100g: s.catalog_carbs_per_100g, catalog_fat_per_100g: s.catalog_fat_per_100g,
        catalog_match_type: s.catalog_match_type, catalog_match_status: s.catalog_match_status, catalog_needs_review: false,
      },
    };
  }).sort((a, b) => b.history_score - a.history_score || b.receipt_count - a.receipt_count);
}

/** History for one user: 1 query on receipts+items, 1 batched catalog lookup. */
export function purchaseHistoryForUser(db, productsDb, userId, now = new Date()) {
  const rows = db.prepare(`
    SELECT i.id, i.receipt_id, i.original_name, i.normalized_name, i.category, i.quantity, i.price,
           i.health_score, i.calories_per_100g, i.protein_per_100g, i.carbs_per_100g, i.fat_per_100g,
           i.matched_product_id, i.matched_product_name, i.catalog_chain, i.catalog_price, i.catalog_price_per_100g,
           i.catalog_calories_per_100g, i.catalog_protein_per_100g, i.catalog_carbs_per_100g, i.catalog_fat_per_100g,
           i.catalog_match_type, i.catalog_match_status, i.is_approved_for_menu, i.user_edited, i.catalog_pack_grams, i.catalog_sold_by_weight,
           r.purchase_date, r.created_date
    FROM receiptItems i
    JOIN receipts r ON r.id = i.receipt_id AND r.created_by = i.created_by
    WHERE i.created_by = ?
      AND i.is_food = 1
      AND i.catalog_match_status IN ('matched', 'approved')
      AND COALESCE(i.catalog_needs_review, 0) = 0
  `).all(userId);

  const itemCodeById = new Map();
  const ids = [...new Set(rows.map(r => r.matched_product_id).filter(v => v != null && v !== ''))];
  if (productsDb && ids.length) {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const found = productsDb.prepare(`SELECT id, item_code FROM products WHERE id IN (${chunk.map(() => '?').join(',')})`).all(...chunk);
      for (const f of found) if (f.item_code) itemCodeById.set(String(f.id), String(f.item_code));
    }
  }
  return computePurchaseHistory(rows, itemCodeById, now);
}
