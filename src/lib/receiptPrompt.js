/**
 * What the receipt AI is asked for — extraction only, no judgments (see
 * src/lib/receiptPipeline.js). The request itself is sent by the server
 * (server/ai.js), which holds the API key.
 *
 * No "@/" imports: the server uses it too.
 */

export const RECEIPT_READING_PROMPT = `קרא את טקסט הקבלה הבא מסופרמרקט והחזר רק את מה שכתוב בה. אל תסווג, אל תעריך ואל תמליץ.

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

// (required / additionalProperties: the server asks for an answer that matches the schema exactly)
export const RECEIPT_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["store_name", "purchase_date", "total_amount", "items"],
  properties: {
    store_name: { type: "string" },
    purchase_date: { type: "string" },
    total_amount: { type: "number" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["original_name", "normalized_name", "quantity", "price"],
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
