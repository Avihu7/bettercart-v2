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

export const FLOW_QUERY_KEY = "flow";

export const isFinalList = list => list?.status === "final";

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
  const profiles = useQuery({
    queryKey: [FLOW_QUERY_KEY, "profile", email],
    queryFn: () => api.entities.UserProfile.filter({ created_by: email }),
    enabled: !!email,
  });

  const allLists = lists.data || [];
  const baskets = allLists.filter(l => !isFinalList(l));
  const basket = (listId && baskets.find(l => l.id === listId)) || baskets[0] || null;
  const plan = plans.data?.[0] || null;
  const finalList = plan ? allLists.find(l => isFinalList(l) && l.nutrition_plan_id === plan.id) || null : null;
  // The basket the plan was built from (falls back to the latest basket for older plans)
  const planBasket = plan ? baskets.find(l => l.id === plan.shopping_list_id) || baskets[0] || null : null;

  return {
    profile: profiles.data?.[0] || null,
    basket,
    plan,
    planBasket,
    finalList,
    isLoading: lists.isLoading || plans.isLoading,
    // Steps completed so far (for the step indicator)
    completed: {
      basket: !!basket,
      plan: !!plan?.days?.length,
      final: !!finalList,
    },
  };
}
