/**
 * Manual QA, round 7 (2026-10-08): the only menu for the QA basket was ₪29 over the
 * weekly budget (level 3 — "חסר ביעדים או בתקציב"), yet the page showed it like a
 * usable menu and the "no other menu" message said "עומד בכל היעדים".
 * A shown menu is either acceptable (level 1–2), or the page says clearly that no
 * menu meeting every goal could be built from this basket, and what to change.
 * A level-4 week is never saved or shown. State: the QA account's real profile,
 * basket and saved menu (tests/fixtures/qaRound7State.json).
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { generateNutritionPlan, UnacceptableMenuError, ONLY_MENU_MESSAGE, NO_ACCEPTABLE_MENU_MESSAGE } from "@/lib/nutritionPlanGenerator";
import { validateMenu } from "@/lib/validateMenu";
import { FLOW_QUERY_KEY } from "@/lib/flowData";
import { basketBudget, weeklyBudget } from "@/lib/pricing";
import { ITEMS as I, BASE_PROFILE } from "./fixtures/baskets";
import STATE from "./fixtures/qaRound7State.json";

const USER = { id: "u1", email: "qa@test.local", name: "qa@test.local" };
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ user: USER, isAuthenticated: true }) }));

describe("the QA menu is level 3 (over budget), not level 4", () => {
  it("validation: ₪472 against ₪443 — the budget is the only failed goal", () => {
    const v = validateMenu({ plan: STATE.plan, basketItems: STATE.basket.items, profile: STATE.profile, budget: basketBudget(STATE.profile, STATE.basket) });
    expect(v.level).toBe(3);
    expect(v.failed).toContain("within_budget");
    expect(v.checks.filter(c => !c.ok && ["safety", "realism", "coverage", "nutrition"].includes(c.area))).toEqual([]);
  });
});

describe("a level-4 week is never saved or shown", () => {
  it("a basket the planner can only turn into a level-4 week: refused, with what to add", async () => {
    const items = [I.chicken, I.rice, I.bread, I.cottage, I.banana, I.oil]; // no vegetables
    const err = await generateNutritionPlan({ list: { items }, profile: BASE_PROFILE, budget: weeklyBudget(BASE_PROFILE) }).catch(e => e);
    expect(err).toBeInstanceOf(UnacceptableMenuError);
    expect(err.message).toMatch(/לא הצלחנו לבנות מהסל הנוכחי תפריט תקין/);
    expect(err.message).toMatch(/ירקות/);
  });
});

describe("the menu page is honest about the menu it shows", () => {
  beforeAll(() => {
    globalThis.window = { location: { search: "", pathname: "/" }, history: { replaceState() {} }, addEventListener() {}, removeEventListener() {} };
  });
  const render = async (plan, profile = STATE.profile) => {
    const { default: Page } = await import("@/pages/NutritionPlanPage.jsx");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData([FLOW_QUERY_KEY, "profile", USER.email], [{ ...profile, onboarding_complete: true }]);
    client.setQueryData([FLOW_QUERY_KEY, "lists", USER.email], [STATE.basket]);
    client.setQueryData([FLOW_QUERY_KEY, "plans", USER.email], [plan]);
    // (server rendering marks text joins with <!-- -->)
    return renderToString(<QueryClientProvider client={client}><MemoryRouter><Page /></MemoryRouter></QueryClientProvider>).replace(/<!-- -->/g, "");
  };

  it("level 3: the menu is shown as the closest one, with a clear \"no menu meets every goal\" notice and what to do", async () => {
    const html = await render(STATE.plan);
    expect(html).toContain("לא נמצא תפריט שעומד בכל היעדים עם הסל הנוכחי");
    expect(html).toContain("עדכון תקציב ויעדים");
    expect(html).toContain("רמה 3 מתוך 4");
  });

  it("level 4 (a saved menu that breaks a rule): not shown — the page says it is invalid and offers a rebuild", async () => {
    // the saved menu serves salmon and tuna; the profile is vegetarian now → profile_safe fails → level 4
    const vegetarian = { ...STATE.profile, dietary_preferences: ["צמחוני"] };
    const v = validateMenu({ plan: STATE.plan, basketItems: STATE.basket.items, profile: vegetarian, budget: basketBudget(vegetarian, STATE.basket) });
    expect(v.level).toBe(4);
    const html = await render(STATE.plan, vegetarian);
    expect(html).toContain("התפריט השמור לא תקין");
    expect(html).toContain("בניית תפריט מחדש");
    expect(html).not.toContain("לא נמצא תפריט שעומד בכל היעדים עם הסל הנוכחי");
  });

  it("the \"no other menu\" message never says the goals are met when the menu misses one", () => {
    expect(ONLY_MENU_MESSAGE).toMatch(/עומד בכל היעדים/);
    expect(NO_ACCEPTABLE_MENU_MESSAGE).toMatch(/לא הצלחנו לבנות מהסל הנוכחי תפריט שעומד בכל היעדים/);
    expect(NO_ACCEPTABLE_MENU_MESSAGE).toMatch(/הקרוב ביותר/);
  });
});
