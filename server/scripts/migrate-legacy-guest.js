/**
 * Manual, operator-only migration of legacy guest data into a user account.
 *
 * Legacy guest ids came from the browser's localStorage and prove nothing about
 * who owns the data, so there is no API for this. Whoever runs this script has
 * direct access to the server database and is responsible for confirming,
 * outside the app, that the account holder really owns the guest's data.
 *
 * Usage (from the project root):
 *   node server/scripts/migrate-legacy-guest.js <guest_id> <account-email>          # dry run
 *   node server/scripts/migrate-legacy-guest.js <guest_id> <account-email> --apply  # migrate
 *
 * Safety rules: the account must exist and be empty (so two people's data is
 * never mixed), and the guest must still own data (so a second run moves nothing).
 */

import db from '../db.js';
import { normalizeEmail } from '../auth.js';

const PERSONAL_TABLES = ['userProfile', 'receipts', 'receiptItems', 'shoppingLists', 'nutritionPlans'];

const [guestId, rawEmail, flag] = process.argv.slice(2);
const apply = flag === '--apply';

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!guestId || !rawEmail) fail('Usage: node server/scripts/migrate-legacy-guest.js <guest_id> <account-email> [--apply]');

const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(normalizeEmail(rawEmail));
if (!user) fail('No account with that email.');

const count = owner => Object.fromEntries(PERSONAL_TABLES.map(t =>
  [t, db.prepare(`SELECT COUNT(*) AS n FROM "${t}" WHERE created_by = ?`).get(owner).n]));
const sum = counts => Object.values(counts).reduce((a, b) => a + b, 0);

const guestCounts = count(guestId);
if (sum(guestCounts) === 0) fail('That guest id owns no data (nothing to migrate, or it was already migrated).');
if (sum(count(user.id)) > 0) fail('The account already has data. Legacy data is only moved into an empty account.');

console.log(`Guest data to move into ${user.email}:`, guestCounts);
if (!apply) {
  console.log('Dry run only. Re-run with --apply to migrate.');
  process.exit(0);
}

const moved = {};
db.transaction(() => {
  for (const t of PERSONAL_TABLES) {
    moved[t] = db.prepare(`UPDATE "${t}" SET created_by = ? WHERE created_by = ?`).run(user.id, guestId).changes;
  }
})();
console.log('Migrated:', moved);
