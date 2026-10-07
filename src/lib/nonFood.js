/**
 * Food vs. non-food from a product name — deterministic, shared by the catalog
 * repair (server/scripts/repair-nonfood-as-food.js) and receipt reading
 * (src/lib/receiptClassifier.js), so both draw the line in the same place.
 *
 *   - an unambiguous non-food word (שמפו, מסקרה, אדפ, מברשת…) → non-food,
 *     unless a food word is there too ("וופל קרם", "טונה בשמן") — except words
 *     that are never food for the user whatever follows ("סרום אורז", "סלמון לחתול")
 *   - a word that is usually non-food (קרם, לחות, ג'ל, גוף…) → non-food only
 *     when no food word is there ("קרם גוף" vs "קרם קוקוס")
 *
 * No "@/" imports: the server scripts use it too.
 */

// Whole Hebrew word (prefixes ו/ה/ל/ב allowed), so "עור" does not match "שעורה"
const word = w => `(?:^|[^א-ת])[והלב]?${w}(?![א-ת])`;
// Word start, any ending ("מסקר" → מסקרה), Hebrew-prefix aware
const stem = w => `(?:^|[^א-ת])[והלב]?${w}`;

// Never eaten, whatever else the name says
export const NON_FOOD_STRONG = new RegExp([
  stem('שמפו'), stem('מרכך'), stem('סבון'), stem('אלסבון'), stem('סרום'), stem('מסקרה'), stem('מסקרת'), word('גבות'), stem('לגבות'), stem('שפתון'),
  stem('ליפ גלוס'), stem('קונסילר'), stem('פודרה'), '(?:^|[^א-ת])(?<!תבלין )סומק', stem('צללית'), stem('אייליינר'),
  stem('מייקאפ'), stem('איפור'), stem('פריימר'), word('אדפ'), word('אדט'), 'EDP', 'EDT', stem('בושם'),
  stem('דאודורנט'), stem('תחליב'), stem('תרחיץ'), stem('מברשת'), stem('משחת שיניים'), stem('מי פה'),
  stem('חיתול'), stem('מגבונ'), stem('טמפונ'), stem('תחבושת'), stem('גילוח'), stem('סכין גילוח'),
  stem('צבע שיער'), stem('ספריי לשיער'), stem('ספריי נפח'), stem('ספריי מקבע'), stem('ספריי שומר'),
  stem('מסיכה לשיער'), stem('מסכה לשיער'), stem('מסכת פנים'), stem('ווקס'), stem('מקדם הגנה'),
  stem('ק\\. ?מקלחת'), stem('ג.ל רחצה'), stem('ג.ל לשיער'), stem('ג.ל לפנים'), stem('מסיר'),
  stem('אקונומיקה'), stem('אבקת כביסה'), stem('מרכך כביסה'), stem('נוזל כלים'), stem('ניקוי'),
  stem('מטהר'), stem('ספוגי'), stem('ספוג (?:כלים|קרצוף|רחצה|ניקוי)'), stem('שקיות'), stem('נרות'), stem('סוללות'), stem('צלחות'), stem('כוסות חד'),
  stem('מכונת'), stem('אסלה'), stem('נייר טואלט'), stem('מגבות נייר'), word('לק'), stem('ציפורנ'),
  'SPF', 'BB קרם', 'CC קרם', 'MOISTURE', 'Wear',
  stem('לכלב'), stem('לחתול'), stem('פורינה'), stem('בונזו'),
  stem('קרם לחות'), stem('קרם ידיים'), stem('קרם גוף'), stem('קרם פנים'), stem('קרם לילה'), stem('ק\\. ?גוף'),
  stem('ק\\. ?ידיים'), stem('להסרת שיער'), stem('לשיער'), stem('אקסלנס (?:קרם|[0-9])'), stem('עפרון'),
  stem('מסכה למרקם'), stem('מסכה לעור'), stem('טישו מסק'), stem('ת\\. ?פנים'), stem('מי פנים'),
  stem('מגע הדבש'), stem('דאב '), stem('חמאת גוף'), stem('מסיכה לפנים'), stem('פורמולה לחות'), stem('ספריי מלח'),
  // receipt abbreviations
  stem('מש\\.? ?שיניים'), stem('נייר סופג'), stem('ג.ל כביסה'), stem('קולגייט'), stem('מרידול'),
].join('|'), 'i');

// Usually non-food — unless a food word is there too
export const NON_FOOD_WEAK = new RegExp([
  word('קרם'), stem('ק\\. ?לחות'), word('לחות'), word('ג.ל'), word('גוף'), word('פנים'), word('עור'),
  word('שיער'), word('לשיער'), word('עיניים'), word('ידיים'), word('רגליים'), stem('קמטים'), stem('אנטי אייג'),
  stem('עיסוי'), word('מסכה'), word('מסיכה'), word('ספריי'), word('סט'), stem('ארנק'),
].join('|'), 'i');

// Food words that keep a name as food ("וופל קרם", "קרם קרמל", "חלב גוף מלא"…)
// (short words as whole words: "מרק" is not "מרקם", "מלח" is not "ים המלח")
export const FOOD_WORDS = new RegExp([
  'וופל', 'ופל', 'עוגי', 'עוגה', 'עוגת', 'עוגות', word('דבש'), 'ביסקוו', 'ביסקוי', 'קרקר', 'שוקולד', 'קרמל', 'וניל', 'חלב(?!ון)',
  'שמנת', 'גבינ', 'ריקוט', 'יוגורט', 'מעדן', 'פודינג', 'גלידה', 'גלטו', 'חטיף', 'אגוז', 'בוטנ', 'שקד', 'פיסטוק',
  'קוקוס', 'בננ', 'קפה', 'חליטה', 'חליטת', 'מיץ', 'משקה', 'פירות', 'ירקות', 'טונה', 'בשר', 'רוטב', 'פסטה',
  'אורז', 'לחם', 'מאפה', 'בצק', 'קרמשניט', 'קרמבו', 'פחזני', 'סופגני', 'דונאט', 'ממרח', 'למריחה', 'אפייה',
  'ריבה', 'קינוח', 'פרלין', 'טופי', 'סוכר', 'קמח', 'תבלין', 'חומוס', 'טחינה', 'שמן זית', 'בייגלה', 'גליליות',
  'עוג\\.', 'פינוקיות',
  word('תה'), word('מרק'), word('מלח'), word('דג'), word('עוף'), word('תות'), word('לימון'), word('קקאו'),
].join('|'));

// Never food for the user, even next to a food word ("סלמון לחתול", "סרום אורז", "שפתון תות")
export const NEVER_FOOD = /לחתול|לכלב|לחתולים|לכלבים|פורינה|בונזו|סרום|מסקרה|שפתון|אדפ|אדט|דאודורנט|שמפו|תחליב|מייקאפ/;

/** True when a product name is not food (cosmetics, cleaning, household, pet food). */
export function isNonFoodName(name) {
  const n = String(name || "");
  if (!n.trim()) return false;
  if (NON_FOOD_STRONG.test(n)) return !FOOD_WORDS.test(n) || NEVER_FOOD.test(n);
  return NON_FOOD_WEAK.test(n) && !FOOD_WORDS.test(n);
}
