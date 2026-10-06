/**
 * One-off catalog repair: food products that the catalog import filed as
 * "hygiene" (is_food = 0), so they never show in search, matching or baskets.
 *
 * Cause: the importer matched the nail-polish keyword "לק" inside other words —
 * קורנפלקס, סלק, חלק (meat cuts), סלמי, לקטוז, לקט, מילקי, מילקה, ביסקויט…
 *
 * A row is moved back to food only when its name clearly names a food AND
 * contains no cosmetic/cleaning word. Everything else stays untouched.
 *
 *   node server/scripts/repair-hygiene-food.js            dry run (prints the list)
 *   node server/scripts/repair-hygiene-food.js --apply    writes the change
 *
 * Back up server/products.db before --apply.
 */
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '..', 'products.db'));
const apply = process.argv.includes('--apply');

// Clearly food (whole words or unambiguous stems)
const FOOD = new RegExp([
  'קורנפלקס', 'דגני בוקר', 'גרנולה',
  '(^|[^א-ת])סלק', 'מנגולד', 'לקט (?:הגינה|ירקות|עלים|חסות)', 'לקט סלנובה', 'סלט',
  'חלב(?!ון)', 'לקטוז', 'מילקי', 'מילקה', 'שוקולד', 'ריקוטה', 'גבינ', 'יוגורט', 'קצפת',
  'נקניק', 'סלמי', 'בשר', 'עוף', 'הודו', 'קבב', 'המבורגר', 'סינטה', 'אנטריקוט', 'כתף', 'צלעות', 'שניצל', 'עגל', 'כבש', 'פרגית',
  'פיצה', 'ביסקויט', 'עוגי', 'וופל', 'חטיף', 'קרמשניט', 'בצק', 'לחם', 'פיתה', 'מאפה',
  'מיץ', 'משקה', '(^|[^א-ת])יין', 'מרלו', 'קברנה', 'שרדונה', 'בירה', 'קפה', 'תה ',
  'זרעי', 'אגוזי', 'שקדי', 'פירות', 'ירקות', 'תפוח', 'בננ', 'מנגו', 'גזר',
].join('|'));

// Anything that is not eaten — wins over FOOD (e.g. "קרם גוף שוקולד", "שמפו חלב ודבש")
const NON_FOOD = new RegExp([
  'שמפו', 'מרכך', 'סבון', 'קרם', 'סרום', 'מסכה', 'מסיר', 'דאודורנט', 'בושם', 'אדט', 'אדפ', 'EDT', 'EDP',
  'לק(?![א-ת])', '(^|[^א-ת])לק', 'שפתון', 'פודרה', 'מייק', 'איפור', 'ריס', 'גבות', 'ציפורנ',
  'גילוח', 'מברשת', 'משחת', 'שיני', 'תחבושת', 'טמפון', 'פד', 'חיתול', 'מגבונ', 'מגבות', 'נייר',
  'ניקוי', 'כביסה', 'כלים', 'אקונומיקה', 'מטהר', 'ספוג', 'שקיות', 'נרות',
  'שיער', 'החלקה', 'מוחלק', 'פנים', 'גוף', 'עור', 'קמטים', 'לחות', 'שמש', 'SPF',
  'קומפלקס', 'טבליות', 'כמוסות', 'טב(?![א-ת])', 'ויטמין', 'תוסף',
  'סיליקון', 'סילקון', 'ריפוד', 'כרית', 'פלסטר', 'לקוסט',
  'רחצה', 'תחליב', 'פלמוליב', 'ס\\.נוזלי', "ג'ל", 'דאב ', 'ניוואה', 'רקסונה', 'קולגייט', 'סנסודיין', 'מי פה', 'לנור', 'כדוריות', 'גבר',
  'סוללות', 'אלקליין', 'עגלת', 'מלקחיים', 'מטאטא',
  'כלב', 'חתול', 'פורינה', 'בונזו', 'דוגלי',
  // baby formula/purees are food, but not for an adult's weekly basket
  'מטרנה', 'סימילאק', 'תרכובת מזון', 'תחליף חלב',
].join('|'), 'i');

const rows = db.prepare(`SELECT id, original_product_name AS name FROM products WHERE category = 'hygiene' AND is_food = 0`).all();
const fix = rows.filter(r => FOOD.test(r.name) && !NON_FOOD.test(r.name));

const names = [...new Set(fix.map(r => r.name))].sort();
console.log(names.join('\n'));
console.log(`\n${fix.length} rows (${names.length} distinct names) of ${rows.length} hygiene rows → food`);

if (apply) {
  const upd = db.prepare(`UPDATE products SET is_food = 1, category = 'other', sub_category = NULL, replacement_group = NULL WHERE id = ? AND category = 'hygiene'`);
  db.transaction(() => { for (const r of fix) upd.run(r.id); })();
  console.log('applied');
} else {
  console.log('dry run — pass --apply to write');
}
