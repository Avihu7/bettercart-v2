/**
 * Shared state of the 4-step flow, derived from what is already saved:
 *   1. receipt → 2. smart product basket → 3. weekly nutrition plan → 4. final shopping list
 *
 * Baskets and final lists both live in `shoppingLists`: a final list has
 * status "final" and `nutrition_plan_id` set to the plan it was calculated from.
 * Everything else (including lists saved before this distinction) is a basket.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/localAPI";
import { normalizeHebrew } from "@/lib/mealPlanRules";
import { receiptSpending } from "@/lib/receiptClassifier";
import { householdReserve } from "@/lib/budgetModel";

export const FLOW_QUERY_KEY = "flow";

export const isFinalList = list => list?.status === "final";

/**
 * True when the plan uses a product that is no longer in the basket it was
 * built from (the user removed or replaced it in step 2 afterwards).
 */
export function isPlanOutdated(plan, basket) {
  if (!plan?.days?.length || !basket || plan.shopping_list_id !== basket.id) return false;
  const names = new Set((basket.items || []).map(i => normalizeHebrew(i.name)));
  return plan.days.some(day => (day.meals || []).some(meal =>
    (meal.items || []).some(i => i.food_name && !names.has(normalizeHebrew(i.food_name)))));
}

/** "Day/MealType" of every day missing its breakfast, lunch or dinner. */
export function planMissingMeals(plan) {
  return (plan?.days || []).flatMap(d => ["Breakfast", "Lunch", "Dinner"]
    .filter(t => !(d.meals || []).some(m => m.meal_type === t && m.items?.length)).map(t => `${d.day_name}/${t}`));
}

export function useFlowData(user, { listId } = {}) {
  const email = user?.email;
  const lists = useQuery({
    queryKey: [FLOW_QUERY_KEY, "lists", email],
    queryFn: () => api.entities.ShoppingList.filter({ created_by: email }, "-created_date", 30),
    enabled: !!email,
  });
  const plans = useQuery({
    queryKey: [FLOW_QUERY_KEY, "plans", email],
    queryFn: () => api.entities.NutritionPlan.filter({ created_by: email }, "-created_date", 5),
    enabled: !!email,
  });
  // Receipt history: habits and the household / non-food reserve (src/lib/budgetModel.js)
  const receipts = useQuery({
    queryKey: [FLOW_QUERY_KEY, "receipts", email],
    queryFn: () => api.entities.Receipt.filter({ created_by: email }),
    enabled: !!email,
  });
  const receiptItems = useQuery({
    queryKey: [FLOW_QUERY_KEY, "receiptItems", email],
    queryFn: () => api.entities.ReceiptItem.filter({ created_by: email }),
    enabled: !!email,
  });
  const profiles = useQuery({
    queryKey: [FLOW_QUERY_KEY, "profile", email],
    queryFn: () => api.entities.UserProfile.filter({ created_by: email }),
    enabled: !!email,
  });

  const allLists = lists.data || [];
  const baskets = allLists.filter(l => !isFinalList(l));
  const basket = (listId && baskets.find(l => l.id === listId)) || baskets[0] || null;
  const latestPlan = plans.data?.[0] || null;
  // The basket the plan was built from (falls back to the latest basket for older plans)
  const planBasket = latestPlan ? baskets.find(l => l.id === latestPlan.shopping_list_id) || baskets[0] || null : null;
  // A plan that uses products the user removed/replaced in step 2 afterwards is
  // not used anywhere (steps 3–4, results, print) until it is rebuilt
  const planOutdated = isPlanOutdated(latestPlan, planBasket);
  // A saved menu missing a meal (built before that was refused) is never shown or used
  const planIncomplete = !!latestPlan?.days?.length && planMissingMeals(latestPlan).length > 0;
  const plan = planOutdated || planIncomplete ? null : latestPlan;
  const finalList = plan ? allLists.find(l => isFinalList(l) && l.nutrition_plan_id === plan.id) || null : null;

  const profile = profiles.data?.[0] || null;
  const spending = receipts.data && receiptItems.data
    ? receiptSpending(receipts.data, receiptItems.data, { purchasesPerMonth: profile?.purchases_per_month || 4 })
    : null;

  return {
    profile,
    // receipt spending (history) and the weekly household reserve taken from the budget
    spending,
    reserve: householdReserve(spending, profile),
    // the profile query answered (a missing profile is then really missing)
    profileFetched: profiles.isFetched,
    basket,
    plan,
    planBasket,
    finalList,
    // The basket changed after the latest plan was built — steps 3–4 must be rebuilt
    planOutdated,
    planIncomplete,
    isLoading: lists.isLoading || plans.isLoading,
    // Steps completed so far (for the step indicator)
    completed: {
      basket: !!basket,
      plan: !!plan?.days?.length,
      final: !!finalList,
    },
  };
}
