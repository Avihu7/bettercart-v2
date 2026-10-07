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

import { invokeLLM } from '@/lib/ai';
import { receiptLines } from '@/lib/receiptClassifier';

const RECEIPT_READING_PROMPT = `קרא את טקסט הקבלה הבא מסופרמרקט והחזר רק את מה שכתוב בה. אל תסווג, אל תעריך ואל תמליץ.

הוראות:
1. שם הסופרמרקט (לדוגמה: רמי לוי, שופרסל, מגה, ויקטורי). אם לא מופיע — "לא זוהה".
2. תאריך הרכישה בפורמט YYYY-MM-DD. אם לא מופיע — השאר ריק.
3. סכום הסה"כ (שורת "סה"כ" או "TOTAL"). אם לא ברור — סכום כל השורות.
4. כל שורת מוצר בקבלה — כל המוצרים, גם כאלה שאינם מזון:
   - original_name: השם כפי שמודפס בקבלה
   - normalized_name: אותו מוצר בעברית ברורה ומלאה (פענוח קיצורים, למשל "ח.עוף" → "חזה עוף"), בלי להוסיף מידע שלא בקבלה
   - quantity: הכמות כפי שמופיעה (למשל "0.744 ק\\"ג", "2 יח'", "500 גרם"), או ריק
   - price: המחיר ששולם על השורה
5. אל תוסיף שדות אחרים.

טקסט הקבלה:
`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    store_name: { type: "string" },
    purchase_date: { type: "string" },
    total_amount: { type: "number" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          original_name: { type: "string" },
          normalized_name: { type: "string" },
          quantity: { type: "string" },
          price: { type: "number" },
        },
      },
    },
  },
};

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
  const result = await invokeLLM({
    prompt: RECEIPT_READING_PROMPT + receiptText,
    response_json_schema: RESPONSE_SCHEMA,
  });
  return {
    store_name: result?.store_name || "לא זוהה",
    purchase_date: normalizeDateString(result?.purchase_date) || extractDateFromText(receiptText),
    total_amount: Number(result?.total_amount) || null,
    lines: receiptLines(result),
    raw: result,
  };
}
