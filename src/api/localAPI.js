/**
 * Local API client for BetterCart v2.
 * Personal data goes to the local API server (per signed-in user); AI via Claude API (or demo mode).
 */

import { createEntityAPI } from '@/lib/serverDB';
import { profileMacroTargets } from '@/lib/calculations';
import { uploadFile, extractDataFromFile } from '@/lib/ai';

// Every profile the app reads carries macro targets from the current formula
// (calculateMacros), so all screens and the plan generator agree — including
// profiles that were saved under an older formula.
const withCurrentTargets = profile => {
  if (!profile || typeof profile !== 'object') return profile;
  const { protein, carbs, fat } = profileMacroTargets(profile);
  return { ...profile, protein_target: protein, carbs_target: carbs, fat_target: fat };
};

function userProfileAPI() {
  const base = createEntityAPI('userProfile');
  const one = p => p.then(withCurrentTargets);
  const many = p => p.then(rows => (Array.isArray(rows) ? rows.map(withCurrentTargets) : rows));
  return {
    ...base,
    filter: (...args) => many(base.filter(...args)),
    list: (...args) => many(base.list(...args)),
    create: data => one(base.create(data)),
    update: (id, data) => one(base.update(id, data)),
  };
}

export const api = {
  entities: {
    UserProfile: userProfileAPI(),
    Receipt: createEntityAPI('receipts'),
    ReceiptItem: createEntityAPI('receiptItems'),
    ShoppingList: createEntityAPI('shoppingLists'),
    NutritionPlan: createEntityAPI('nutritionPlans'),
  },

  integrations: {
    Core: {
      UploadFile: uploadFile,
      ExtractDataFromUploadedFile: extractDataFromFile,
    },
  }
};
