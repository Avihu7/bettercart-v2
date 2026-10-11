<!-- טיוטה 1 · נבדק מול הקוד בקומיט 3673ff9 (ענף feat/basket-menu-fixes) · 2026-10-11 · אינו קובץ להגשה -->

# חלקים מקדימים

## שער

**המכללה האקדמית תל-חי**
**החוג למדעי המחשב**

**דוח סיכום פרויקט**

בנושא:

**BetterCart — [VERIFY: שם הפרויקט הרשמי בעברית]**
*[VERIFY: שם הפרויקט הרשמי באנגלית]*

מגישים:
[VERIFY: שם מלא ומספר ת"ז של מגיש/ה 1]
[VERIFY: שם מלא ומספר ת"ז של מגיש/ה 2]

מנחה: [VERIFY: שם המנחה ותוארו האקדמי]

[VERIFY: האם הפרויקט נעשה בשיתוף חברה או גורם חיצוני]

[VERIFY: סמסטר ושנת הגשה]

---

## תודות (אופציונלי)

[VERIFY: האם לכלול דף תודות, ולמי.]

---

## תוכן העניינים

ייווצר אוטומטית מסגנונות הכותרת בשלב הפקת המסמך. אין להקליד מספרי עמודים ידנית.

## רשימת איורים, תרשימים ותמונות

תיווצר אוטומטית מכיתובי האיורים בשלב הפקת המסמך.

---

## תקציר

<!-- ההנחיות: כחצי עמוד — הגדרת הבעיה, דרך הפתרון, תוצאות ומסקנות עיקריות. חצי עליון בעברית, חצי תחתון באנגלית. -->

קבלת קנייה מהסופרמרקט מתעדת את הרגלי הצריכה בפועל של משק בית, אך המידע שבה אינו מובנה ואינו מקושר ליעדי תזונה או לתקציב. בפרויקט זה פותחה BetterCart, מערכת ווב בעברית, ההופכת קבלת קנייה לסל מוצרים שבועי, לתפריט שבועי ולרשימת קניות סופית, בהתאמה לפרופיל המשתמש: יעדי קלוריות ואבות מזון, העדפות תזונה, אלרגיות ותקציב.

הפתרון מבוסס על הפרדה בין שני סוגי עיבוד. מודל שפה רב-מודאלי משמש אך ורק לקריאת הקבלה: תמלול התמונה וחילוץ השורות המודפסות. כל ההחלטות שלאחר מכן מתקבלות בקוד דטרמיניסטי מבוסס חוקים: סיווג מזון, התאמה לקטלוג מוצרים בעל ספי ביטחון, מדד בריאות היוריסטי, ציון היסטוריית רכישות על פני מספר קבלות, בניית סל לפי ציון משוקלל ואילוצים קשיחים, תכנון תפריט שבועי בחיפוש חמדני ובחיפוש מקומי, איזון מנות ליעדים, בדיקת תקינות בארבע רמות איכות, ומודל תקציב המפריד בין מזון למוצרי בית.

המערכת מומשה כיישום React בצד הלקוח ושרת Node.js/Express עם שני מסדי נתונים מסוג SQLite. חבילת הבדיקות האוטומטיות כוללת 402 בדיקות יחידה ו-6 בדיקות אינטגרציה, כולן עוברות. [VERIFY: להשלים תוצאות עיקריות לאחר סבב ה-QA הסופי — עמידה ביעדי תזונה ותקציב בתרחישי הבדיקה, ודיוק קריאת קבלות אם יימדד.]

המסקנה ההנדסית העיקרית היא שצמצום השימוש במודל השפה לשלב הקלט הלא-מובנה בלבד מאפשר תוצאות הניתנות לשחזור, להסבר ולבדיקה אוטומטית. [FINALIZE AFTER QA]

## Abstract

A supermarket receipt records what a household actually buys, yet its content is unstructured and disconnected from nutrition goals and budget. This project presents BetterCart, a Hebrew web application that turns a receipt into a weekly product basket, a weekly meal plan and a final shopping list, adapted to the user's profile: calorie and macronutrient targets, dietary preferences, allergies and budget.

The solution separates two kinds of processing. A multimodal language model is used only to read the receipt: transcribing the image and extracting the printed lines. Every subsequent decision is taken by deterministic, rule-based code: food classification, catalog matching with confidence thresholds, a heuristic health indicator, a purchase-history score over several receipts, basket construction by a weighted score under hard constraints, weekly meal planning by greedy construction and local search, portion balancing, validation on four quality levels, and a budget model that separates food from household products.

The system is implemented as a React client and a Node.js/Express server with two SQLite databases. The automated test suite contains 402 unit tests and 6 integration tests, all passing. [VERIFY: main results after final QA.]

The main engineering conclusion is that restricting the language model to the unstructured input stage yields results that are repeatable, explainable and testable. [FINALIZE AFTER QA]

---

## רשימת קיצורים ומונחים

### קיצורים

| קיצור | פירוש |
|---|---|
| AI | Artificial Intelligence — בדוח זה: מודל שפה גדול רב-מודאלי המופעל דרך שירות חיצוני |
| API | Application Programming Interface — ממשק תכנות יישומים |
| BMI | Body Mass Index — מדד מסת גוף |
| BMR | Basal Metabolic Rate — קצב חילוף חומרים בסיסי |
| CORS | Cross-Origin Resource Sharing |
| CRUD | Create, Read, Update, Delete — פעולות יצירה, קריאה, עדכון ומחיקה |
| ER | Entity–Relationship — ישויות וקשרים |
| HTTP | Hypertext Transfer Protocol |
| JSON | JavaScript Object Notation |
| OCR | Optical Character Recognition — זיהוי תווים אופטי |
| QA | Quality Assurance — אבטחת איכות |
| REST | Representational State Transfer |
| RTL | Right-to-Left — כיוון כתיבה מימין לשמאל |
| SPA | Single-Page Application — יישום דף יחיד |
| SQL | Structured Query Language |
| TDEE | Total Daily Energy Expenditure — הוצאת אנרגיה יומית כוללת |
| WAL | Write-Ahead Logging — מצב רישום של SQLite |

### מונחי המערכת

| מונח | משמעות בדוח |
|---|---|
| פרופיל משתמש | נתוני המשתמש שנאספים בשאלון ההיכרות: נתוני גוף, רמת פעילות, מטרה, העדפות תזונה, אלרגיות, מזונות אהובים ולא אהובים, תקציב |
| שורת קבלה / פריט קבלה | מוצר אחד כפי שנקרא מהקבלה, לאחר העיבוד |
| קטלוג המוצרים | מסד הנתונים `products.db` — מוצרי רשתות שיווק עם מחיר, משקל אריזה וערכים תזונתיים חלקיים |
| התאמה לקטלוג | קישור פריט קבלה למוצר בקטלוג, עם רמת ביטחון |
| מדד בריאות היוריסטי | ציון 0–10 למוצר, המחושב משמו לפי חוקים קבועים; אינו מדד רפואי |
| היסטוריית רכישות | ציון העדפה למוצר, המחושב מכלל הקבלות של המשתמש |
| מוצר קבוע | מוצר שציון ההיסטוריה שלו גבוה דיו כדי להיכנס לסל מעצמו |
| סל חכם | סל המוצרים השבועי שממנו נבנה התפריט; שלב ביניים, לא רשימת הקנייה הסופית |
| צורכי הסל | קבוצות המזון שהסל השבועי נדרש להכיל (חלבון, לחם, דגנים, שומן, ירקות, פירות ועוד) |
| אילוץ קשיח | תנאי שמוצר חייב לקיים כדי להיות מועמד (תזונה, אלרגיה, מזון לא אהוב); אינו נתון לשקלול |
| ארוחה מועמדת | ארוחה אפשרית שנוצרה מתבנית וממוצרי הסל, ועומדת בחוקי הארוחה |
| תפריט שבועי | שבעה ימים, מיום ראשון עד שבת, ובכל יום ארוחת בוקר, צהריים, ערב וביניים |
| רמת איכות | דירוג התפריט בידי מערכת הוולידציה, מ-1 (הטובה) עד 4 (תפריט שאינו מוצג) |
| תקציב הסופר השבועי | התקציב החודשי מהפרופיל, מומר לשבוע; כולל את כל הקנייה בסופר |
| רזרבה למוצרים שאינם מזון | הסכום השבועי הנשמר למוצרי ניקיון, היגיינה ובית, לפי היסטוריית הקבלות |
| תקציב המזון השבועי | תקציב הסופר השבועי פחות הרזרבה; מולו נמדדים הסל והתפריט |
| רשימת קניות סופית | רשימת המוצרים והכמויות לקנייה, הנגזרת מהתפריט השבועי |
