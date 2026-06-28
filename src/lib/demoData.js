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

export const DEMO_SHOPPING_LIST_RESPONSE = {
  items: [
    { name: "חזה עוף", category: "protein", quantity: "1 ק\"ג", estimated_price: 39.90, calories: 1650, protein: 310, carbs: 0, fat: 36, health_score: 9, reason: "מקור חלבון רזה ומצוין" },
    { name: "ביצים", category: "protein", quantity: "12 יחידות", estimated_price: 17.90, calories: 864, protein: 72, carbs: 4, fat: 60, health_score: 8, reason: "חלבון רב-תכליתי עם שומנים בריאים" },
    { name: "עדשים כתומות", category: "protein", quantity: "500 ג'", estimated_price: 8.90, calories: 580, protein: 45, carbs: 100, fat: 2, health_score: 9, reason: "קטנייה עשירה בחלבון וסיבים" },
    { name: "אורז לבן", category: "carb", quantity: "1 ק\"ג", estimated_price: 10.90, calories: 1300, protein: 27, carbs: 280, fat: 3, health_score: 6, reason: "פחמימה בסיסית ומשתלמת" },
    { name: "פסטה ספגטי", category: "carb", quantity: "500 ג'", estimated_price: 5.90, calories: 655, protein: 25, carbs: 125, fat: 5, health_score: 5, reason: "פחמימה זולה ומזינה" },
    { name: "לחם מלא", category: "carb", quantity: "500 ג'", estimated_price: 9.90, calories: 1235, protein: 65, carbs: 205, fat: 17, health_score: 7, reason: "פחמימה מלאה עם סיבים" },
    { name: "עגבניות שרי", category: "vegetable", quantity: "500 ג'", estimated_price: 9.90, calories: 90, protein: 5, carbs: 20, fat: 1, health_score: 9, reason: "ירק עשיר בנוטריינטים" },
    { name: "מלפפונים", category: "vegetable", quantity: "1 ק\"ג", estimated_price: 7.90, calories: 160, protein: 7, carbs: 36, fat: 1, health_score: 9, reason: "ירק מרענן ודל קלוריות" },
    { name: "תפוחים", category: "fruit", quantity: "1 ק\"ג", estimated_price: 12.90, calories: 520, protein: 3, carbs: 140, fat: 2, health_score: 8, reason: "פרי עשיר בסיבים" },
    { name: "יוגורט יווני", category: "dairy", quantity: "500 ג'", estimated_price: 22.00, calories: 295, protein: 50, carbs: 18, fat: 4, health_score: 9, reason: "עשיר בחלבון ופרוביוטיקה" },
    { name: "גבינה לבנה 5%", category: "dairy", quantity: "250 ג'", estimated_price: 8.50, calories: 180, protein: 28, carbs: 8, fat: 13, health_score: 8, reason: "חלבי קל וגבוה בחלבון" },
    { name: "שמן זית", category: "fat", quantity: "250 מ\"ל", estimated_price: 12.90, calories: 2000, protein: 0, carbs: 0, fat: 227, health_score: 8, reason: "שומן בריא לבישול" },
  ],
  total_estimated_cost: 166.60,
  total_calories: 9529,
};

export const DEMO_NUTRITION_PLAN_RESPONSE = {
  days: [
    {
      day_name: "Monday",
      meals: [
        {
          meal_type: "Breakfast",
          items: [
            { food_name: "יוגורט יווני", grams: 200, calories: 118, protein: 20, carbs: 7, fat: 1.4, estimated_cost: 8.80 },
            { food_name: "תפוחים", grams: 150, calories: 78, protein: 0.5, carbs: 21, fat: 0.3, estimated_cost: 1.94 },
            { food_name: "לחם מלא", grams: 60, calories: 148, protein: 7.8, carbs: 24.6, fat: 2, estimated_cost: 1.19 },
          ],
          total_calories: 344, total_protein: 28, total_carbs: 53, total_fat: 4, estimated_cost: 11.93,
        },
        {
          meal_type: "Lunch",
          items: [
            { food_name: "חזה עוף", grams: 200, calories: 330, protein: 62, carbs: 0, fat: 7.2, estimated_cost: 7.98 },
            { food_name: "אורז לבן", grams: 150, calories: 195, protein: 4.1, carbs: 42, fat: 0.5, estimated_cost: 1.64 },
            { food_name: "עגבניות שרי", grams: 100, calories: 18, protein: 0.9, carbs: 3.9, fat: 0.2, estimated_cost: 1.98 },
            { food_name: "מלפפונים", grams: 80, calories: 13, protein: 0.6, carbs: 2.9, fat: 0.1, estimated_cost: 0.63 },
          ],
          total_calories: 556, total_protein: 68, total_carbs: 49, total_fat: 8, estimated_cost: 12.23,
        },
        {
          meal_type: "Dinner",
          items: [
            { food_name: "עדשים כתומות", grams: 100, calories: 116, protein: 9, carbs: 20, fat: 0.4, estimated_cost: 1.78 },
            { food_name: "ביצים", grams: 120, calories: 186, protein: 15.6, carbs: 1.3, fat: 13.2, estimated_cost: 2.39 },
            { food_name: "גבינה לבנה 5%", grams: 50, calories: 36, protein: 5.5, carbs: 1.6, fat: 2.5, estimated_cost: 1.70 },
          ],
          total_calories: 338, total_protein: 30, total_carbs: 23, total_fat: 16, estimated_cost: 5.87,
        },
        {
          meal_type: "Snacks",
          items: [
            { food_name: "תפוחים", grams: 120, calories: 62, protein: 0.4, carbs: 16.8, fat: 0.2, estimated_cost: 1.55 },
            { food_name: "יוגורט יווני", grams: 100, calories: 59, protein: 10, carbs: 3.6, fat: 0.7, estimated_cost: 4.40 },
          ],
          total_calories: 121, total_protein: 10, total_carbs: 20, total_fat: 1, estimated_cost: 5.95,
        },
      ],
      total_calories: 1359, total_protein: 136, total_carbs: 145, total_fat: 29, estimated_cost: 35.98,
    },
    {
      day_name: "Tuesday",
      meals: [
        {
          meal_type: "Breakfast",
          items: [
            { food_name: "ביצים", grams: 150, calories: 233, protein: 19.5, carbs: 1.7, fat: 16.5, estimated_cost: 2.98 },
            { food_name: "לחם מלא", grams: 60, calories: 148, protein: 7.8, carbs: 24.6, fat: 2, estimated_cost: 1.19 },
            { food_name: "עגבניות שרי", grams: 80, calories: 14, protein: 0.7, carbs: 3.1, fat: 0.2, estimated_cost: 1.58 },
          ],
          total_calories: 395, total_protein: 28, total_carbs: 29, total_fat: 19, estimated_cost: 5.75,
        },
        {
          meal_type: "Lunch",
          items: [
            { food_name: "פסטה ספגטי", grams: 100, calories: 131, protein: 5, carbs: 25, fat: 1.1, estimated_cost: 1.18 },
            { food_name: "חזה עוף", grams: 150, calories: 248, protein: 46.5, carbs: 0, fat: 5.4, estimated_cost: 5.99 },
            { food_name: "עגבניות שרי", grams: 100, calories: 18, protein: 0.9, carbs: 3.9, fat: 0.2, estimated_cost: 1.98 },
            { food_name: "מלפפונים", grams: 100, calories: 16, protein: 0.7, carbs: 3.6, fat: 0.1, estimated_cost: 0.79 },
          ],
          total_calories: 413, total_protein: 53, total_carbs: 33, total_fat: 7, estimated_cost: 9.94,
        },
        {
          meal_type: "Dinner",
          items: [
            { food_name: "עדשים כתומות", grams: 150, calories: 174, protein: 13.5, carbs: 30, fat: 0.6, estimated_cost: 2.67 },
            { food_name: "מלפפונים", grams: 150, calories: 24, protein: 1.1, carbs: 5.4, fat: 0.2, estimated_cost: 1.19 },
            { food_name: "גבינה לבנה 5%", grams: 100, calories: 72, protein: 11, carbs: 3.2, fat: 5, estimated_cost: 3.40 },
          ],
          total_calories: 270, total_protein: 26, total_carbs: 39, total_fat: 6, estimated_cost: 7.26,
        },
        {
          meal_type: "Snacks",
          items: [
            { food_name: "יוגורט יווני", grams: 150, calories: 89, protein: 15, carbs: 5.4, fat: 1.1, estimated_cost: 6.60 },
            { food_name: "תפוחים", grams: 120, calories: 62, protein: 0.4, carbs: 16.8, fat: 0.2, estimated_cost: 1.55 },
          ],
          total_calories: 151, total_protein: 15, total_carbs: 22, total_fat: 1, estimated_cost: 8.15,
        },
      ],
      total_calories: 1229, total_protein: 122, total_carbs: 123, total_fat: 33, estimated_cost: 31.10,
    },
  ],
  weekly_calories: 2588,
  estimated_weekly_cost: 67.08,
};
