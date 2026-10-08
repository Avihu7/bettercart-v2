/**
 * The budget model — one place that says what the weekly budget is and what the
 * week's food is compared against. Deterministic.
 *
 *   1. weekly supermarket budget   the user's budget from the profile (everything
 *                                  bought at the supermarket, not only food)
 *   2. household reserve           non-food the user buys anyway (cleaning, hygiene,
 *                                  paper, home), estimated from receipt history;
 *                                  never part of the menu or the food shopping list
 *   3. available food budget       1 − 2 (or a higher amount the user accepted for a basket)
 *   4. planned food cost           what the week's menu / final list costs
 *   5. status                      4 against 3: within / over by ₪N / unrealistic
 *
 * Receipts are history only: products, habits and the household reserve — never
 * the budget the menu is measured against.
 */
import { weeklyBudget, basketBudget } from "@/lib/pricing";

const round = n => Math.round(n);
const round1 = n => Math.round(n * 10) / 10;
const WEEKS_PER_MONTH = 30 / 7;
const shekel = n => `₪${round1(n)}`;

/** Receipt history, per week (receiptSpending's averages × the profile's purchases per week). */
export function weeklyHistory(spending, profile) {
  const count = spending?.count || 0;
  const perWeek = (Number(profile?.purchases_per_month) || 4) / WEEKS_PER_MONTH;
  const w = cls => (count ? round(spending.perReceipt[cls] * perWeek) : 0);
  return {
    receipts_counted: count,
    // one or two receipts are a glimpse, not a pattern
    confidence: count === 0 ? "none" : count < 3 ? "low" : "ok",
    food_plannable: w("food_plannable"),
    food_non_plannable: w("food_non_plannable"),
    non_food: w("non_food"),
    total: w("total"),
  };
}

/** The weekly household / non-food reserve from receipt history (0 without receipts). */
export function householdReserve(spending, profile) {
  return weeklyHistory(spending, profile).non_food;
}

/**
 * The weekly budget picture. spending: receiptSpending(...) of the user's receipts
 * (or null); basket: its accepted_budget may raise the food budget; plannedFoodCost:
 * the week's menu / final list cost (null before there is a menu).
 */
export function budgetPicture({ profile, spending = null, basket = null, plannedFoodCost = null }) {
  const total = weeklyBudget(profile);
  const history = weeklyHistory(spending, profile);
  const reserve = Math.min(history.non_food, total);
  const fromBudget = Math.max(0, total - reserve);
  const accepted = Number(basket?.accepted_budget) || 0;
  // the same number the basket and the menu are held to
  const food = basketBudget(profile, basket, reserve);
  const planned = plannedFoodCost == null ? null : round1(Number(plannedFoodCost) || 0);
  const status = planned == null ? null : fromBudget <= 0 && !accepted ? "unrealistic" : planned <= food ? "within" : "over";
  return {
    weekly_total_budget: total,
    household_reserve: reserve,
    reserve_basis: reserve > 0 ? "receipts" : "none",
    available_food_budget: food,
    accepted_override: accepted > fromBudget,
    planned_food_cost: planned,
    status,
    over_by: status === "over" ? round1(planned - food) : 0,
    left: status === "within" ? round1(food - planned) : 0,
    history,
  };
}

/**
 * What the food budget is, in one Hebrew sentence — said wherever a cost is
 * compared with it, so "over budget" always says over what.
 */
export function foodBudgetLabel(pic) {
  if (pic.accepted_override) return `תקציב המזון השבועי ${shekel(pic.available_food_budget)} (סכום שאישרת לסל הזה)`;
  if (pic.household_reserve > 0) {
    return `תקציב המזון השבועי ${shekel(pic.available_food_budget)} — תקציב הסופר השבועי ${shekel(pic.weekly_total_budget)} ` +
      `פחות ${shekel(pic.household_reserve)} ששמרנו למוצרים שאינם מזון (ניקיון, היגיינה, בית)`;
  }
  return `תקציב הסופר השבועי ${shekel(pic.weekly_total_budget)} — לא הופחתה ממנו שמירה למוצרים שאינם מזון` +
    (pic.history.receipts_counted ? " (בקבלות לא נמצאו מוצרים כאלה)" : " (אין עדיין קבלות שמראות הוצאה כזו)");
}

/** A short note on how far the receipt history can be trusted. */
export function historyNote(history) {
  if (history.confidence === "none") return "אין עדיין קבלות — אין היסטוריית קניות להשוואה.";
  if (history.confidence === "low") {
    return `לפי ${history.receipts_counted === 1 ? "קבלה אחת" : `${history.receipts_counted} קבלות`} בלבד — תמונה חלקית של הקניות שלך. ככל שתעלו יותר קבלות, ההערכה תהיה מדויקת יותר.`;
  }
  return `לפי ${history.receipts_counted} קבלות.`;
}

/**
 * Before / after saved with a plan: the plan against the user's budget (monthly),
 * with receipt history beside it as context — never as the baseline.
 */
export function budgetComparison(pic) {
  const m = n => (n == null ? null : round(n * WEEKS_PER_MONTH));
  return {
    comparison_basis: "budget",
    monthly_total_budget: m(pic.weekly_total_budget),
    monthly_household_reserve: m(pic.household_reserve),
    monthly_food_budget: m(pic.available_food_budget),
    estimated_new_monthly_spending: m(pic.planned_food_cost),
    budget_status: pic.status,
    monthly_left: m(pic.left),
    monthly_over: m(pic.over_by),
    receipts_counted: pic.history.receipts_counted,
    history_confidence: pic.history.confidence,
    // receipt history, per month — context only
    history_monthly: {
      food_plannable: m(pic.history.food_plannable),
      food_non_plannable: m(pic.history.food_non_plannable),
      non_food: m(pic.history.non_food),
      total: m(pic.history.total),
    },
  };
}
