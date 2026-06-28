/**
 * Local API client for BetterCart v2.
 * Uses localStorage for data persistence and Claude API (or demo mode) for AI.
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
  },

  auth: {
    isAuthenticated: () => Promise.resolve(true),
    me: () => {
      const id = localStorage.getItem('bettercart_guest_user_id') || 'anonymous';
      return Promise.resolve({ email: id, name: 'אורח' });
    },
    logout: () => {
      if (confirm('מחיקת כל הנתונים המקומיים וחזרה לדף הבית?')) {
        Object.keys(localStorage)
          .filter(k => k.startsWith('bc2_'))
          .forEach(k => localStorage.removeItem(k));
        window.location.href = '/';
      }
    },
    redirectToLogin: (redirect) => {
      window.location.href = redirect || '/dashboard';
    },
  },
};
