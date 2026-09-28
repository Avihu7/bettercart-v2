/**
 * Receipt Intelligence Pipeline
 * Transforms unstructured receipt text into structured food data using AI.
 */

import { invokeLLM } from '@/lib/ai';

const RECEIPT_ANALYSIS_PROMPT = `אתה AI לניתוח תזונה וקבלות סופרמרקט. נתח את טקסט הקבלה הבא וחלץ נתונים מובנים.

הוראות:
1. זהה את שם הסופרמרקט (לדוגמה: רמי לוי, שופרסל, מגה, ויקטורי וכו׳). אם לא מופיע שם - כתוב "לא זוהה".
2. זהה את תאריך הרכישה מהקבלה בפורמט YYYY-MM-DD. אם לא מופיע - השאר ריק.
3. זהה את סכום הסה"כ של הקבלה (שורת "סה"כ" או "TOTAL"). אם לא ברור - חשב לפי סכום כל המוצרים.
4. זהה את כל פריטי המזון מהקבלה.
5. הוצא פריטים שאינם מזון (חומרי ניקוי, קוסמטיקה, כלי בית וכו׳) ושמור אותם ב-non_food_items.
6. שמות המוצרים (normalized_name) חייבים להיות בעברית ברורה ותקינה.
7. סווג כל פריט מזון לאחת מהקטגוריות: protein, carb, fat, vegetable, fruit, dairy, snack, drink, other.
8. העריך ערכים תזונתיים לכל 100 גרם אם לא זמינים.
9. תן ציון בריאות מ-0 עד 10 (10 = בריא מאוד).
10. סמן האם הפריט מתאים לתפריט תזונה בריא (is_approved_for_menu). פריטים לא בריאים כמו משקאות ממותקים, עוגיות, צ׳יפס - is_approved_for_menu = false.
11. זהה דפוסי תזונה והמלץ על שיפורים.
12. כל הטקסט ב-insights חייב להיות בעברית תקנית בלבד, ללא מילים באנגלית. לקטגוריית החלב כתוב "מוצרי חלב" (לא "דייה", "דיירי" או "Dairy").

טקסט הקבלה:
`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    store_name: { type: "string" },
    purchase_date: { type: "string" },
    total_amount: { type: "number" },
    food_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          original_name: { type: "string" },
          normalized_name: { type: "string" },
          category: { type: "string" },
          is_food: { type: "boolean" },
          is_approved_for_menu: { type: "boolean" },
          estimated_quantity: { type: "string" },
          price: { type: "number" },
          calories_per_100g: { type: "number" },
          protein_per_100g: { type: "number" },
          carbs_per_100g: { type: "number" },
          fat_per_100g: { type: "number" },
          health_score: { type: "number" },
          reasoning: { type: "string" },
        },
      },
    },
    non_food_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          price: { type: "number" },
          reason: { type: "string" },
        },
      },
    },
    insights: {
      type: "object",
      properties: {
        main_food_preferences: { type: "array", items: { type: "string" } },
        frequent_categories: { type: "array", items: { type: "string" } },
        high_spending_categories: { type: "array", items: { type: "string" } },
        less_healthy_patterns: { type: "array", items: { type: "string" } },
        recommended_improvements: { type: "array", items: { type: "string" } },
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

export async function analyzeReceipt(receiptText) {
  const result = await invokeLLM({
    prompt: RECEIPT_ANALYSIS_PROMPT + receiptText,
    response_json_schema: RESPONSE_SCHEMA,
  });

  result.purchase_date = normalizeDateString(result.purchase_date) || extractDateFromText(receiptText);
  return result;
}
