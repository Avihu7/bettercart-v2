/**
 * Local API client for BetterCart v2.
 * Personal data goes to the local API server (per signed-in user); AI via Claude API (or demo mode).
 */

import { createEntityAPI } from '@/lib/serverDB';
import { invokeLLM, uploadFile, extractDataFromFile } from '@/lib/ai';

export const api = {
  entities: {
    UserProfile: createEntityAPI('userProfile'),
    Receipt: createEntityAPI('receipts'),
    ReceiptItem: createEntityAPI('receiptItems'),
    ShoppingList: createEntityAPI('shoppingLists'),
    NutritionPlan: createEntityAPI('nutritionPlans'),
  },

  integrations: {
    Core: {
      InvokeLLM: invokeLLM,
      UploadFile: uploadFile,
      ExtractDataFromUploadedFile: extractDataFromFile,
    },
  }
};
