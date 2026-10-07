/**
 * Demo data for running without an Anthropic API key.
 * Uses a realistic Hebrew Rami Levy receipt.
 */

export const DEMO_RECEIPT_TEXT = `רמי לוי
שיווק השקמה בע"מ
בנימין 18, ירושלים
קופה: 04  קסאר: 12
תאריך: 30/04/2026  שעה: 18:42

חזה עוף טרי 1 ק"ג          39.90
אורז פתית אורנה 1 ק"ג       10.90
פסטה ספגטי עלית 500 ג       5.90
ביצים L  גבעות 12 יח       17.90
יוגורט יווני תנובה 170 ג     7.50
עגבניות שרי 500 ג           9.90
מלפפונים 1 ק"ג              7.90
תפוחים פינק ליידי 1 ק"ג     12.90
גבינה לבנה 5% 250 ג         8.50
חלב טרי 1% תנובה 1 ל        5.90
לחם מלא 750 ג               9.90
שמן זית כתית מעולה 750 מ"ל  31.90
עדשים כתומות 500 ג          8.90
טונה בשמן 3x160 ג           18.90
בצל 1 ק"ג                   4.90
שום 250 ג                   6.90
עוגיות אוריאו 154 ג         11.90
קולה זירו 1.5 ל             8.90
נוזל כלים פיירי               14.90

סה"כ:  253.80 ₪
מזומן:  260.00 ₪
עודף:    6.20 ₪

תודה שקניתם ברמי לוי!`;

export const DEMO_AI_RESPONSE = {
  store_name: "רמי לוי",
  purchase_date: "2026-04-30",
  total_amount: 253.80,
  food_items: [
    {
      original_name: "חזה עוף טרי 1 ק\"ג",
      normalized_name: "חזה עוף",
      category: "protein",
      is_food: true,
      is_approved_for_menu: true,
      estimated_quantity: "1 ק\"ג",
      price: 39.90,
      calories_per_100g: 165,
      protein_per_100g: 31,
      carbs_per_100g: 0,
      fat_per_100g: 3.6,
      health_score: 9,
      reasoning: "מקור חלבון רזה ואיכותי, מומלץ לכל המטרות התזונתיות"
    },
    {
      original_name: "אורז פתית אורנה 1 ק\"ג",
      normalized_name: "אורז לבן",
      category: "carb",
      is_food: true,
      is_approved_for_menu: true,
      estimated_quantity: "1 ק\"ג",
      price: 10.90,
      calories_per_100g: 130,
      protein_per_100g: 2.7,
      carbs_per_100g: 28,
      fat_per_100g: 0.3,
      health_score: 6,
      reasoning: "פחמימה זולה ובסיסית, מתאימה לאנרגיה מתמשכת"
    },
    {
      original_name: "פסטה ספגטי עלית 500 ג",
      normalized_name: "פסטה ספגטי",
      category: "carb",
      is_food: true,
      is_approved_for_menu: true,
      estimated_quantity: "500 ג'",
      price: 5.90,
      calories_per_100g: 131,
      protein_per_100g: 5,
      carbs_per_100g: 25,
      fat_per_100g: 1.1,
      health_score: 5,
      reasoning: "פחמימה מהירה, עדיפה גרסת מלא לסיבים"
    },
    {
      original_name: "ביצים L גבעות 12 יח",
      normalized_name: "ביצים",
      category: "protein",
      is_food: true,
      is_approved_for_menu: true,
      estimated_quantity: "12 ביצים",
      price: 17.90,
      calories_per_100g: 155,
      protein_per_100g: 13,
      carbs_per_100g: 1.1,
      fat_per_100g: 11,
      health_score: 8,
      reasoning: "חלבון רב-תכליתי עם שומנים בריאים, מצוין לכל ארוחה"
    },
    {
      original_name: "יוגורט יווני תנובה 170 ג",
      normalized_name: "יוגורט יווני",
      category: "dairy",
      is_food: true,
      is_approved_for_menu: true,
      estimated_quantity: "170 ג'",
      price: 7.50,
      calories_per_100g: 59,
      protein_per_100g: 10,
      carbs_per_100g: 3.6,
      fat_per_100g: 0.7,
      health_score: 9,
      reasoning: "גבוה בחלבון ופרוביוטיקה, מצוין לחטיף בריא"
    },
    {
      original_name: "עגבניות שרי 500 ג",
      normalized_name: "עגבניות שרי",
      category: "vegetable",
      is_food: true,
      is_approved_for_menu: true,
      estimated_quantity: "500 ג'",
      price: 9.90,
      calories_per_100g: 18,
      protein_per_100g: 0.9,
      carbs_per_100g: 3.9,
      fat_per_100g: 0.2,
      health_score: 9,
      reasoning: "ירק עשיר בליקופן ונוגדי חמצון, דל קלוריות"
    },
    {
      original_name: "מלפפונים 1 ק\"ג",
      normalized_name: "מלפפונים",
      category: "vegetable",
      is_food: true,
      is_approved_for_menu: true,
      estimated_quantity: "1 ק\"ג",
      price: 7.90,
      calories_per_100g: 16,
      protein_per_100g: 0.7,
      carbs_per_100g: 3.6,
      fat_per_100g: 0.1,
      health_score: 9,
      reasoning: "ירק מרענן ומייבש, דל קלוריות מאוד"
    },
    {
      original_name: "תפוחים פינק ליידי 1 ק\"ג",
      normalized_name: "תפוחים",
      category: "fruit",
      is_food: true,
      is_approved_for_menu: true,
      estimated_quantity: "1 ק\"ג",
      price: 12.90,
      calories_per_100g: 52,
      protein_per_100g: 0.3,
      carbs_per_100g: 14,
      fat_per_100g: 0.2,
      health_score: 8,
      reasoning: "פרי עשיר בסיבים ורב-חשיבות, מצוין לחטיף"
    },
    {
      original_name: "גבינה לבנה 5% 250 ג",
      normalized_name: "גבינה לבנה",
      category: "dairy",
      is_food: true,
      is_approved_for_menu: true,
      estimated_quantity: "250 ג'",
      price: 8.50,
      calories_per_100g: 72,
      protein_per_100g: 11,
      carbs_per_100g: 3.2,
      fat_per_100g: 5,
      health_score: 8,
      reasoning: "חלבי קל, גבוה בחלבון ודל שומן יחסית"
    },
    {
      original_name: "חלב טרי 1% תנובה 1 ל",
      normalized_name: "חלב 1%",
      category: "dairy",
      is_food: true,
      is_approved_for_menu: true,
      estimated_quantity: "1 ליטר",
      price: 5.90,
      calories_per_100g: 42,
      protein_per_100g: 3.4,
      carbs_per_100g: 5,
      fat_per_100g: 1,
      health_score: 7,
      reasoning: "סידן וחלבון, גרסת 1% עדיפה על שמן"
    },
    {
      original_name: "לחם מלא 750 ג",
      normalized_name: "לחם מלא",
      category: "carb",
      is_food: true,
      is_approved_for_menu: true,
      estimated_quantity: "750 ג'",
      price: 9.90,
      calories_per_100g: 247,
      protein_per_100g: 13,
      carbs_per_100g: 41,
      fat_per_100g: 3.4,
      health_score: 7,
      reasoning: "פחמימה מלאה עם סיבים, עדיף על לחם לבן"
    },
    {
      original_name: "שמן זית כתית מעולה 750 מ\"ל",
      normalized_name: "שמן זית",
      category: "fat",
      is_food: true,
      is_approved_for_menu: true,
      estimated_quantity: "750 מ\"ל",
      price: 31.90,
      calories_per_100g: 884,
      protein_per_100g: 0,
      carbs_per_100g: 0,
      fat_per_100g: 100,
      health_score: 8,
      reasoning: "שומן בריא עשיר באומגה 9, מרכיב מפתח בתזונה ים-תיכונית"
    },
    {
      original_name: "עדשים כתומות 500 ג",
      normalized_name: "עדשים כתומות",
      category: "protein",
      is_food: true,
      is_approved_for_menu: true,
      estimated_quantity: "500 ג'",
      price: 8.90,
      calories_per_100g: 116,
      protein_per_100g: 9,
      carbs_per_100g: 20,
      fat_per_100g: 0.4,
      health_score: 9,
      reasoning: "קטנייה עשירה בחלבון, סיבים וברזל, מזון-על"
    },
    {
      original_name: "טונה בשמן 3x160 ג",
      normalized_name: "טונה בשמן",
      category: "protein",
      is_food: true,
      is_approved_for_menu: true,
      estimated_quantity: "3 × 160 ג'",
      price: 18.90,
      calories_per_100g: 200,
      protein_per_100g: 26,
      carbs_per_100g: 0,
      fat_per_100g: 10,
      health_score: 7,
      reasoning: "מקור אומגה 3 וחלבון, מוכן לאכילה מיידית"
    },
    {
      original_name: "בצל 1 ק\"ג",
      normalized_name: "בצל",
      category: "vegetable",
      is_food: true,
      is_approved_for_menu: true,
      estimated_quantity: "1 ק\"ג",
      price: 4.90,
      calories_per_100g: 40,
      protein_per_100g: 1.1,
      carbs_per_100g: 9.3,
      fat_per_100g: 0.1,
      health_score: 8,
      reasoning: "תבלין-ירק בסיסי, נוגד חמצון, זול ומשתלם"
    },
    {
      original_name: "שום 250 ג",
      normalized_name: "שום",
      category: "vegetable",
      is_food: true,
      is_approved_for_menu: true,
      estimated_quantity: "250 ג'",
      price: 6.90,
      calories_per_100g: 149,
      protein_per_100g: 6.4,
      carbs_per_100g: 33,
      fat_per_100g: 0.5,
      health_score: 9,
      reasoning: "נוגד חמצון חזק, מחזק מערכת חיסון"
    },
    {
      original_name: "עוגיות אוריאו 154 ג",
      normalized_name: "עוגיות אוריאו",
      category: "snack",
      is_food: true,
      is_approved_for_menu: false,
      estimated_quantity: "154 ג'",
      price: 11.90,
      calories_per_100g: 480,
      protein_per_100g: 4.7,
      carbs_per_100g: 70,
      fat_per_100g: 20,
      health_score: 2,
      reasoning: "גבוה בסוכר ושמן דקלים, לא מומלץ לתפריט יומי"
    },
    {
      original_name: "קולה זירו 1.5 ל",
      normalized_name: "קולה זירו",
      category: "drink",
      is_food: true,
      is_approved_for_menu: false,
      estimated_quantity: "1.5 ליטר",
      price: 8.90,
      calories_per_100g: 0,
      protein_per_100g: 0,
      carbs_per_100g: 0,
      fat_per_100g: 0,
      health_score: 2,
      reasoning: "ממותקת בסוכרים מלאכותיים, מומלץ להחליף במים או משקה טבעי"
    },
  ],
  non_food_items: [
    {
      name: "נוזל כלים פיירי",
      price: 14.90,
      reason: "חומר ניקוי — לא מזון"
    }
  ],
  insights: {
    main_food_preferences: ["עוף", "ביצים", "ירקות", "מוצרי חלב", "קטניות"],
    frequent_categories: ["protein", "vegetable", "dairy"],
    high_spending_categories: ["protein", "fat"],
    less_healthy_patterns: ["משקאות מוגזים (קולה זירו)", "חטיפים עתירי סוכר (עוגיות אוריאו)"],
    recommended_improvements: [
      "החליפו קולה זירו במים, מיץ טבעי או תה",
      "החליפו עוגיות אוריאו בפרי טרי או אגוזים",
      "הוסיפו יותר ירקות עלים ירוקים (תרד, רוקט)",
      "שקלו לגוון בקטניות — גם עדשות ירוקות וחומוס"
    ]
  }
};
