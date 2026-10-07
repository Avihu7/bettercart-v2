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
import { NON_FOOD_STRONG, NON_FOOD_WEAK, FOOD_WORDS, NEVER_FOOD } from '../../src/lib/nonFood.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '..', 'products.db'));
const apply = process.argv.includes('--apply');
const list = process.argv.includes('--list');

// The food / non-food rules are shared with receipt reading
const STRONG = NON_FOOD_STRONG, WEAK = NON_FOOD_WEAK, FOOD = FOOD_WORDS, PET = NEVER_FOOD;

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
  // products.db is committed: move the change out of the WAL file into it
  db.pragma('wal_checkpoint(TRUNCATE)');
  console.log('applied');
} else {
  console.log('dry run — pass --apply to write');
}
