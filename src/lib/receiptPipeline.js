/**
 * Receipt reading — the only place BetterCart uses AI.
 *
 * The AI reads unstructured receipt text and returns what is printed on it:
 * store, date, total, and every product line (name as printed, the same name
 * in clean Hebrew, quantity, price). It makes no judgments: food or not,
 * category, nutrition, health, menu suitability and insights are all decided
 * by deterministic code (src/lib/receiptClassifier.js, the catalog match,
 * src/lib/healthScore.js).
 */

import { readReceiptText } from '@/lib/ai';
import { receiptLines } from '@/lib/receiptClassifier';

function normalizeDateString(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return null;
}

function extractDateFromText(text) {
  if (!text) return null;
  const patterns = [
    /(\d{1,2})[\.\/](\d{1,2})[\.\/ ](\d{4})/,
    /(\d{4})-(\d{2})-(\d{2})/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      if (m[1].length === 4) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
      return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    }
  }
  return null;
}

/**
 * Reads a receipt: { store_name, purchase_date, total_amount, lines, raw }.
 * lines: [{ original_name, normalized_name, quantity, price }] — extraction only.
 */
export async function analyzeReceipt(receiptText) {
  // the prompt and schema (src/lib/receiptPrompt.js) are applied by the server
  const result = await readReceiptText(receiptText);
  return {
    store_name: result?.store_name || "לא זוהה",
    purchase_date: normalizeDateString(result?.purchase_date) || extractDateFromText(receiptText),
    total_amount: Number(result?.total_amount) || null,
    lines: receiptLines(result),
    raw: result,
  };
}
