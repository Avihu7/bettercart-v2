/**
 * One-off catalog repair, two import mistakes:
 *
 * 1. Not fish. The importer matched the letters "דג" inside other words — דגנים,
 *    דגש, דגם, מדגסקר… — and filed those rows as fish: sub_category 'fish',
 *    category 'protein', a generic fish nutrition profile (130 kcal / 22 g protein).
 *    So "לחם דגנים" was a protein with no carbs. A row is repaired when it is filed
 *    as fish and its name, by the app's own classifier (src/lib/mealPlanRules.js,
 *    where "דג" is now matched as a word), is neither fish nor another protein food.
 *    It gets the category of its real food group and the catalog's "no nutrition
 *    data" state (the app then uses typical values for the food group); nothing
 *    is invented. Only names with the letters "דג" are considered — fish the importer
 *    recognized by species name stay as they are. Rows the classifier reads as another protein (e.g. "…דגש עוף")
 *    are listed, not changed.
 *
 * 2. Pet food. Cat / dog food and treats, fish feed (and a few pet toys) marked
 *    is_food = 1 — some as 'protein'. Rule: PET_FOOD in src/lib/nonFood.js, the
 *    same rule receipt reading uses. They become is_food = 0, category 'pet'.
 *
 *   node server/scripts/repair-fish-and-pet.js            dry run (counts + samples)
 *   node server/scripts/repair-fish-and-pet.js --list     dry run, every name
 *   node server/scripts/repair-fish-and-pet.js --apply    writes the change
 *
 * Back up server/products.db before --apply (it is committed: `git checkout
 * server/products.db` restores it). Stop the API server first. Running it twice
 * changes nothing the second time.
 */
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { classifyProduct, normalizeHebrew, FISH_WORD } from '../../src/lib/mealPlanRules.js';
import { PET_FOOD } from '../../src/lib/nonFood.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apply = process.argv.includes('--apply');
const list = process.argv.includes('--list');
const db = new Database(path.join(__dirname, '..', 'products.db'), { readonly: !apply });

const PROTEIN_GROUPS = new Set(['fish', 'meat', 'eggs', 'legumes', 'dairy_protein', 'yogurt']);
// Food group → the catalog's own category names
const CATEGORY = { bread: 'bakery', grain: 'carb', cereal: 'carb', starch_veg: 'carb', fruit: 'fruit', vegetable: 'vegetable' };
// Pet toys are not pet food — still not food
const TOY = /בובת|בובות|בצק משחק|אלקטרוני|ספוג/;

const show = (title, rows) => {
  const names = [...new Set(rows.map(r => r.name))].sort();
  console.log(`\n── ${title}: ${rows.length} rows, ${names.length} names`);
  const step = Math.max(1, Math.floor(names.length / 20));
  console.log((list ? names : names.filter((_, i) => i % step === 0)).join('\n'));
};
const byChain = rows => Object.entries(rows.reduce((m, r) => ({ ...m, [r.chain]: (m[r.chain] || 0) + 1 }), {})).map(([c, n]) => `${c} ${n}`).join(', ');

// ── 1. filed as fish, not fish
const filedFish = db.prepare(`
  SELECT id, original_product_name AS name, source_chain AS chain, category, value_score
  FROM products WHERE is_food = 1 AND (sub_category = 'fish' OR replacement_group = 'fish')`).all();
// The word "דג" itself keeps a row as fish whatever group wins in the app ("דג הרינג בשמן" is
// read as oil there — packing liquids are handled elsewhere)
const groupOf = name => (FISH_WORD.test(` ${normalizeHebrew(name)} `) ? 'fish' : classifyProduct(name));
const withGroup = filedFish.filter(r => !PET_FOOD.test(r.name)).map(r => ({ ...r, group: groupOf(r.name) }));
// Only the mistake's own signature: the letters "דג" in the name. Fish the importer knew by
// species ("בורי", "לברק", "דניס"…) are fish, whatever the app's shorter word list says.
const hasLetters = r => r.name.includes('דג');
const notFish = withGroup.filter(r => hasLetters(r) && !PROTEIN_GROUPS.has(r.group));
const otherProtein = withGroup.filter(r => hasLetters(r) && r.group !== 'fish' && PROTEIN_GROUPS.has(r.group));
console.log(`filed as fish without the letters "דג" (other fish words) — untouched: ${withGroup.filter(r => !hasLetters(r)).length}`);
console.log(`filed as fish (food rows): ${filedFish.length}; really fish by name: ${withGroup.filter(r => r.group === 'fish').length}`);
show(`1. filed as fish, not fish → repaired (${byChain(notFish)})`, notFish);
const to = notFish.reduce((m, r) => ({ ...m, [CATEGORY[r.group] || 'other']: (m[CATEGORY[r.group] || 'other'] || 0) + 1 }), {});
console.log('new categories:', JSON.stringify(to));
show('1b. filed as fish, another protein by name → left as they are', otherProtein);

// ── 2. pet food marked as food
const pet = db.prepare(`SELECT id, original_product_name AS name, source_chain AS chain, category FROM products WHERE is_food = 1`).all()
  .filter(r => PET_FOOD.test(r.name));
show(`2. pet food marked as food → non-food (${byChain(pet)})`, pet);
console.log('categories before:', JSON.stringify(pet.reduce((m, r) => ({ ...m, [r.category]: (m[r.category] || 0) + 1 }), {})));

console.log(`\n${notFish.length} rows re-filed, ${pet.length} rows → non-food`);

if (apply) {
  // The catalog's own "no nutrition data" state (nutrition score 50, overall = 0.6·nutrition + 0.4·value)
  const refile = db.prepare(`
    UPDATE products SET category = ?, sub_category = NULL, replacement_group = 'other', meal_fit = NULL,
      calories_per_100g = NULL, protein_per_100g = NULL, carbs_per_100g = NULL, fat_per_100g = NULL,
      fiber_per_100g = NULL, sugar_per_100g = NULL, sodium_per_100g = NULL,
      nutrition_source = NULL, nutrition_confidence = 'missing',
      price_per_gram_protein = NULL, price_per_100_calories = NULL,
      nutrition_score = 50, overall_score = ?
    WHERE id = ?`);
  const notFood = db.prepare(`UPDATE products SET is_food = 0, category = ? WHERE id = ? AND is_food = 1`);
  db.transaction(() => {
    for (const r of notFish) {
      const value = Number(r.value_score);
      refile.run(CATEGORY[r.group] || 'other', Number.isFinite(value) ? Math.round((0.6 * 50 + 0.4 * value) * 10) / 10 : null, r.id);
    }
    for (const r of pet) notFood.run(TOY.test(r.name) ? 'other_non_food' : 'pet', r.id);
  })();
  // products.db is committed: move the change out of the WAL file into it
  db.pragma('wal_checkpoint(TRUNCATE)');
  console.log('applied');
} else {
  console.log('dry run — pass --apply to write');
}
