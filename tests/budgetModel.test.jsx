/**
 * The budget model (2026-10-08): the user's weekly budget is the target; receipts are
 * history (habits, a household / non-food reserve) — never the baseline the plan is
 * measured against. src/lib/budgetModel.js
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { budgetPicture, budgetComparison, householdReserve, foodBudgetLabel, historyNote } from "@/lib/budgetModel";
import { receiptSpending } from "@/lib/receiptClassifier";
import { weeklyBudget, basketBudget } from "@/lib/pricing";
import { buildBasket } from "@/lib/basketBuilder";
import { explainMenu } from "@/lib/explainMenu";
import { FLOW_QUERY_KEY } from "@/lib/flowData";
import BudgetSummaryCard from "@/components/BudgetSummaryCard";
import { BASE_PROFILE } from "./fixtures/baskets";

// pages and the API client read the address at load; server rendering has no window
vi.hoisted(() => {
  globalThis.window = { location: { search: "", pathname: "/" }, history: { replaceState() {} }, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
});
const USER = { id: "u1", email: "qa@test.local", name: "qa@test.local" };
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ user: USER, isAuthenticated: true }) }));

// 1800 a month → ₪420 a week; 4 purchases a month
const PROFILE = { ...BASE_PROFILE, monthly_budget: 1800, purchases_per_month: 4, onboarding_complete: true };
let n = 0;
const line = (receipt, name, price, extra = {}) => ({
  id: `l${n++}`, receipt_id: receipt, original_name: name, normalized_name: name, category: "other",
  is_food: true, is_approved_for_menu: true, price, quantity: "", ...extra,
});
// one receipt: ₪120 of menu food, ₪20 of snacks, ₪70 of household products
const ONE = {
  receipts: [{ id: "r1", purchase_date: "2026-10-07" }],
  items: [line("r1", "חזה עוף טרי", 80), line("r1", "אורז פרסי", 40), line("r1", "במבה", 20),
    line("r1", "שמפו הד אנד שולדרס", 40, { is_food: false }), line("r1", "נוזל כלים", 30, { is_food: false })],
};
const spendingOf = ({ receipts, items }) => receiptSpending(receipts, items, { purchasesPerMonth: 4 });
const PER_WEEK = 4 * 7 / 30; // purchases per week

describe("1. the profile's weekly budget is the main target", () => {
  it("the supermarket budget comes from the profile, whatever the receipts show", () => {
    const pic = budgetPicture({ profile: PROFILE, spending: spendingOf(ONE), plannedFoodCost: 300 });
    expect(pic.weekly_total_budget).toBe(weeklyBudget(PROFILE));
    expect(pic.weekly_total_budget).toBe(420);
  });
});

describe("4. household / non-food spending is a reserve taken from the supermarket budget", () => {
  const pic = budgetPicture({ profile: PROFILE, spending: spendingOf(ONE), plannedFoodCost: 300 });
  it("reserve = the receipts' non-food per purchase × purchases per week", () => {
    expect(pic.household_reserve).toBe(Math.round(70 * PER_WEEK));
    expect(householdReserve(spendingOf(ONE), PROFILE)).toBe(pic.household_reserve);
  });
  it("available food budget = supermarket budget − reserve, the same number the basket and menu are held to", () => {
    expect(pic.available_food_budget).toBe(420 - pic.household_reserve);
    expect(basketBudget(PROFILE, null, pic.household_reserve)).toBe(pic.available_food_budget);
    expect(foodBudgetLabel(pic)).toMatch(/תקציב המזון השבועי ₪355.*תקציב הסופר השבועי ₪420.*פחות ₪65/);
  });
  it("without receipts nothing is reserved, and the label says so instead of implying non-food is covered", () => {
    const none = budgetPicture({ profile: PROFILE, spending: null, plannedFoodCost: 300 });
    expect(none.household_reserve).toBe(0);
    expect(none.available_food_budget).toBe(420);
    expect(foodBudgetLabel(none)).toMatch(/לא הופחתה ממנו שמירה למוצרים שאינם מזון/);
  });
  it("a reserve that leaves nothing for food: budget unrealistic", () => {
    const heavy = { receipts: [{ id: "r9" }], items: [line("r9", "אבקת כביסה", 900, { is_food: false })] };
    expect(budgetPicture({ profile: PROFILE, spending: spendingOf(heavy), plannedFoodCost: 100 }).status).toBe("unrealistic");
  });
});

describe("the reserve rule, exactly: every non-food line → average per trip × trips per week", () => {
  // two trips: r1 has ₪70 of household products (one marked "not food" by the user, one
  // with a discount); r2 has none — and an ignored food line, which is not household
  const two = {
    receipts: [{ id: "r1" }, { id: "r2" }],
    items: [
      line("r1", "חזה עוף טרי", 50),
      line("r1", "נוזל כלים", 40, { is_food: false }),
      line("r1", "הנחה", -10),
      line("r1", "מגבונים לחים", 40, { catalog_match_status: "non_food", is_food: false }),
      line("r2", "אורז פרסי", 30),
      line("r2", "שוקולד מתנה", 25, { catalog_match_status: "ignored" }),
    ],
  };
  const s = spendingOf(two);
  it("every non-food line counts — rule-classified and user-marked, net of its discount; an ignored food line does not", () => {
    expect(s.receipts.find(r => r.id === "r1").non_food).toBe(70);
    expect(s.receipts.find(r => r.id === "r2").non_food).toBe(0);
    expect(s.receipts.find(r => r.id === "r2").food_non_plannable).toBe(25);
  });
  it("reserve = average non-food per trip (₪35) × trips per week; food budget = supermarket budget − reserve", () => {
    const pic = budgetPicture({ profile: PROFILE, spending: s, plannedFoodCost: 300 });
    expect(s.perReceipt.non_food).toBe(35);
    expect(pic.household_reserve).toBe(Math.round(35 * PER_WEEK));
    expect(pic.available_food_budget).toBe(weeklyBudget(PROFILE) - pic.household_reserve);
  });
  it("non-food and ignored lines never reach the food basket", async () => {
    const { items } = await buildBasket({ receiptItems: two.items, profile: PROFILE, weeklyBudget: 400, additions: async () => [], staples: async () => [] });
    expect(items.map(i => i.name).join("|")).not.toMatch(/נוזל כלים|מגבונים|שוקולד מתנה/);
  });
});

describe("5. the planned food cost is compared with the available food budget", () => {
  it("₪380 is within the ₪420 supermarket budget, but ₪25 over the ₪355 food budget — the status says over", () => {
    const pic = budgetPicture({ profile: PROFILE, spending: spendingOf(ONE), plannedFoodCost: 380 });
    expect(pic.status).toBe("over");
    expect(pic.over_by).toBe(380 - pic.available_food_budget);
  });
  it("within the food budget: how much is left", () => {
    const pic = budgetPicture({ profile: PROFILE, spending: spendingOf(ONE), plannedFoodCost: 300 });
    expect(pic).toMatchObject({ status: "within", left: pic.available_food_budget - 300 });
  });
  it("the menu's quality card says over which budget, and what it is made of", () => {
    const pic = budgetPicture({ profile: PROFILE, spending: spendingOf(ONE), plannedFoodCost: 380 });
    const validation = { level: 3, offer: {}, stats: {}, checks: [{ id: "within_budget", ok: false, data: { cost: 380, budget: pic.available_food_budget, over: pic.over_by } }] };
    const text = explainMenu(validation, { budgetLabel: foodBudgetLabel(pic) }).points.map(p => p.text).join(" ");
    expect(text).toMatch(/מעל תקציב המזון השבועי \(₪355\)/);
    expect(text).toMatch(/פחות ₪65 ששמרנו למוצרים שאינם מזון/);
  });
});

describe("2 + 8. receipts are history only — the plan is not \"worse\" for costing more than the receipts", () => {
  // the receipt shows ₪120 of menu food; the week's menu costs ₪300 — more, but within the budget
  const pic = budgetPicture({ profile: PROFILE, spending: spendingOf(ONE), plannedFoodCost: 300 });
  it("the saved before / after is against the budget; receipt spending is kept beside it as history", () => {
    const c = budgetComparison(pic);
    expect(c.comparison_basis).toBe("budget");
    expect(c.monthly_food_budget).toBe(Math.round(pic.available_food_budget * 30 / 7));
    expect(c.budget_status).toBe("within");
    expect(c).not.toHaveProperty("previous_monthly_spending");
    expect(c).not.toHaveProperty("monthly_savings");
    expect(c.history_monthly.food_plannable).toBe(Math.round(pic.history.food_plannable * 30 / 7));
  });
  it("the card shows the history as context, labelled as not the budget target, and the plan as within budget", () => {
    const html = renderToString(<BudgetSummaryCard pic={pic} />).replace(/<!-- -->/g, "");
    expect(html).toContain("היסטוריית הקבלות — לעיון בלבד, לא יעד התקציב");
    expect(html).toContain("בתוך תקציב המזון");
    expect(html).not.toMatch(/עולה יותר ממה שהקבלות/);
  });
});

describe("3. non-food receipt lines never reach the food basket (so never the menu cost)", () => {
  it("shampoo and dish soap from the receipt stay out of the basket", async () => {
    const { items } = await buildBasket({
      receiptItems: ONE.items, profile: PROFILE, weeklyBudget: 400,
      additions: async () => [], staples: async () => [],
    });
    expect(items.map(i => i.name).join("|")).not.toMatch(/שמפו|נוזל כלים/);
    expect(items.map(i => i.name)).toContain("חזה עוף טרי");
  });
});

describe("6. one receipt: the history is marked as partial", () => {
  it("low confidence, and the note says it is one receipt only", () => {
    const pic = budgetPicture({ profile: PROFILE, spending: spendingOf(ONE), plannedFoodCost: 300 });
    expect(pic.history.confidence).toBe("low");
    expect(historyNote(pic.history)).toMatch(/קבלה אחת בלבד — תמונה חלקית/);
    expect(renderToString(<BudgetSummaryCard pic={pic} />)).toContain("קבלה אחת בלבד");
  });
  it("no receipts: says there is no history; 3+ receipts: no partial-history warning", () => {
    expect(historyNote(budgetPicture({ profile: PROFILE, plannedFoodCost: 1 }).history)).toMatch(/אין עדיין קבלות/);
    const three = { receipts: ["a", "b", "c"].map(id => ({ id })), items: ["a", "b", "c"].map(id => line(id, "אורז פרסי", 20)) };
    expect(historyNote(budgetPicture({ profile: PROFILE, spending: spendingOf(three), plannedFoodCost: 1 }).history)).not.toMatch(/חלקית/);
  });
});

describe("7. the basket's cost and the week's menu / list cost are labelled, not treated as one number", () => {
  it("the budget card explains the basket page's number beside the week's cost", () => {
    const pic = budgetPicture({ profile: PROFILE, spending: spendingOf(ONE), plannedFoodCost: 472 });
    const html = renderToString(<BudgetSummaryCard pic={pic} basketCost={298} />).replace(/<!-- -->/g, "");
    expect(html).toContain("עלות המזון לשבוע לפי התפריט");
    expect(html).toContain("עלות המוצרים בסל (₪298.00)");
    expect(html).toContain("מחיר אריזה אחת מכל מוצר שנבחר");
  });
});

describe("the final list page (step 4): the list cost against the food budget, receipts as history", () => {
  it("a plan dearer than the receipt history but within the food budget is shown as within budget, with no \"worse than receipts\" note", async () => {
    const { default: Page } = await import("@/pages/FinalShoppingList.jsx");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const basket = { id: "b1", items: [{ name: "חזה עוף טרי", category: "protein" }], total_estimated_cost: 250 };
    const meal = meal_type => ({ meal_type, meal_name: "עוף", items: [{ food_name: "חזה עוף טרי", grams: 150 }] });
    const plan = { id: "p1", shopping_list_id: "b1", estimated_weekly_cost: 300, days: [{ day_name: "Sunday", meals: ["Breakfast", "Lunch", "Dinner"].map(meal) }],
      before_after: { previous_health_score: 50, new_health_score: 70 } };
    client.setQueryData([FLOW_QUERY_KEY, "profile", USER.email], [PROFILE]);
    const finalList = { id: "f1", status: "final", nutrition_plan_id: "p1", shopping_period_days: 7, total_estimated_cost: 300,
      items: [{ name: "חזה עוף טרי", category: "protein", quantity: "1 ק\"ג", estimated_price: 300 }] };
    client.setQueryData([FLOW_QUERY_KEY, "lists", USER.email], [finalList, basket]);
    client.setQueryData([FLOW_QUERY_KEY, "plans", USER.email], [plan]);
    client.setQueryData([FLOW_QUERY_KEY, "receipts", USER.email], ONE.receipts);
    client.setQueryData([FLOW_QUERY_KEY, "receiptItems", USER.email], ONE.items);
    const html = renderToString(<QueryClientProvider client={client}><MemoryRouter><Page /></MemoryRouter></QueryClientProvider>).replace(/<!-- -->/g, "");
    expect(html).toContain("תקציב השבוע");
    expect(html).toContain("בתוך תקציב המזון");
    expect(html).toContain("לעיון בלבד, לא יעד התקציב");
    expect(html).toContain("עלות רשימת הקניות לשבוע");
    // the list (₪300) against the food budget (₪420 − ₪65 = ₪355), not the ₪420 supermarket budget
    expect(html).toContain("₪355.00");
    expect(html).toContain("נשארו ₪55.00");
    expect(html).toContain("עלות המוצרים בסל (₪250.00)");
    expect(html).not.toMatch(/התפריט עולה יותר ממה שהקבלות|חיסכון חודשי/);
  });
});
