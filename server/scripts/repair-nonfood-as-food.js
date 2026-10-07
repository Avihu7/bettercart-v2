/**
 * One-off catalog repair: cosmetics, toiletries and household goods that the
 * catalog import filed as food (is_food = 1, category "other"), so they could
 * show up in search, receipt matching and price scans as food.
 *
 * Only category "other" is touched — rows the import placed in a food category
 * (dairy, fruit, snack…) keep their flag. A row becomes non-food when:
 *   - its name has an unambiguous non-food word (שמפו, מסקרה, אדפ, מברשת…), or
 *   - it has a word that is usually non-food (קרם, לחות, ג'ל, גוף…) and no food word
 *     ("וופל קרם קקאו" stays food, "קרם גוף" does not).
 * Changed rows get category 'hygiene', like the rows the import got right.
 *
 *   node server/scripts/repair-nonfood-as-food.js            dry run (counts + samples)
 *   node server/scripts/repair-nonfood-as-food.js --list     dry run, every name
 *   node server/scripts/repair-nonfood-as-food.js --apply    writes the change
 *
 * Back up server/products.db before --apply.
 */
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '..', 'products.db'));
const apply = process.argv.includes('--apply');
const list = process.argv.includes('--list');

// Whole Hebrew word (prefixes ו/ה/ל/ב allowed), so "עור" does not match "שעורה"
const word = w => `(?:^|[^א-ת])[והלב]?${w}(?![א-ת])`;
// Word start, any ending ("מסקר" → מסקרה), Hebrew-prefix aware
const stem = w => `(?:^|[^א-ת])[והלב]?${w}`;

// Never eaten, whatever else the name says
const STRONG = new RegExp([
  stem('שמפו'), stem('מרכך'), stem('סבון'), stem('אלסבון'), stem('סרום'), stem('מסקרה'), stem('שפתון'),
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
].join('|'), 'i');

// Usually non-food — unless a food word is there too
const WEAK = new RegExp([
  word('קרם'), stem('ק\\. ?לחות'), word('לחות'), word('ג.ל'), word('גוף'), word('פנים'), word('עור'),
  word('שיער'), word('לשיער'), word('עיניים'), word('ידיים'), word('רגליים'), stem('קמטים'), stem('אנטי אייג'),
  stem('עיסוי'), word('מסכה'), word('מסיכה'), word('ספריי'), word('סט'), stem('ארנק'),
].join('|'), 'i');

// Food words that keep a WEAK name as food ("וופל קרם", "קרם קרמל", "חלב גוף מלא"…)
// (short words as whole words: "מרק" is not "מרקם", "מלח" is not "ים המלח")
const FOOD = new RegExp([
  'וופל', 'ופל', 'עוגי', 'עוגה', 'עוגת', 'עוגות', word('דבש'), 'ביסקוו', 'ביסקוי', 'קרקר', 'שוקולד', 'קרמל', 'וניל', 'חלב(?!ון)',
  'שמנת', 'גבינ', 'ריקוט', 'יוגורט', 'מעדן', 'פודינג', 'גלידה', 'גלטו', 'חטיף', 'אגוז', 'בוטנ', 'שקד', 'פיסטוק',
  'קוקוס', 'בננ', 'קפה', 'חליטה', 'חליטת', 'מיץ', 'משקה', 'פירות', 'ירקות', 'טונה', 'בשר', 'רוטב', 'פסטה',
  'אורז', 'לחם', 'מאפה', 'בצק', 'קרמשניט', 'קרמבו', 'פחזני', 'סופגני', 'דונאט', 'ממרח', 'למריחה', 'אפייה',
  'ריבה', 'קינוח', 'פרלין', 'טופי', 'סוכר', 'קמח', 'תבלין', 'חומוס', 'טחינה', 'שמן זית', 'בייגלה', 'גליליות',
  'עוג\\.', 'פינוקיות',
  word('תה'), word('מרק'), word('מלח'), word('דג'), word('עוף'), word('תות'), word('לימון'), word('קקאו'),
].join('|'));

// Pet food is food — but never for the user's basket ("סלמון לחתול")
const PET = /לחתול|לכלב|לחתולים|לכלבים|פורינה|בונזו/;

const rows = db.prepare(`SELECT id, original_product_name AS name FROM products WHERE is_food = 1 AND category = 'other'`).all();
const strong = [], weak = [];
for (const r of rows) {
  if (STRONG.test(r.name)) strong.push(r);
  else if (WEAK.test(r.name) && !FOOD.test(r.name)) weak.push(r);
}
// In the food categories (the import guessed "protein"/"fat"/"drink" for some
// cosmetics too) only an unambiguous non-food word with no food word counts
const typed = db.prepare(`SELECT id, original_product_name AS name FROM products WHERE is_food = 1 AND category != 'other'`).all()
  .filter(r => STRONG.test(r.name) && (!FOOD.test(r.name) || PET.test(r.name)));
const fix = [...strong, ...weak, ...typed];

const show = (title, rs) => {
  const names = [...new Set(rs.map(r => r.name))].sort();
  console.log(`\n── ${title}: ${rs.length} rows, ${names.length} names`);
  console.log((list ? names : names.filter((_, i) => i % Math.max(1, Math.floor(names.length / 25)) === 0)).join('\n'));
};
show('unambiguous non-food', strong);
show('non-food words, no food word', weak);
// The other way round: what stays food although it has a WEAK word (check these are really food)
show('kept as food (weak word + food word)', rows.filter(r => !STRONG.test(r.name) && WEAK.test(r.name) && FOOD.test(r.name)));
show('food categories, unambiguous non-food', typed);
console.log(`\n${fix.length} food rows → non-food`);

if (apply) {
  const upd = db.prepare(`UPDATE products SET is_food = 0, category = 'hygiene' WHERE id = ? AND is_food = 1`);
  db.transaction(() => { for (const r of fix) upd.run(r.id); })();
  console.log('applied');
} else {
  console.log('dry run — pass --apply to write');
}
