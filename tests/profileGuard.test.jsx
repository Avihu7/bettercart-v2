/**
 * QA (2026-10-08): after the profile was reset, a basket and a menu were still
 * built — with no goals, diet or favorites, and no quality card. Neither may be
 * built without a completed profile (src/lib/profileGuard.js).
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildBasket } from "@/lib/basketBuilder";
import { generateNutritionPlan } from "@/lib/nutritionPlanGenerator";
import { profileReady, ProfileRequiredError, PROFILE_REQUIRED_TITLE } from "@/lib/profileGuard";
import { FLOW_QUERY_KEY } from "@/lib/flowData";
import { BASKETS, BASE_PROFILE } from "./fixtures/baskets";

const USER = { id: "u1", email: "qa@test.local", name: "qa@test.local" };
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ user: USER, isAuthenticated: true }) }));

const MISSING = [["no profile", undefined], ["onboarding not finished", { ...BASE_PROFILE, onboarding_complete: false }],
  ["no nutrition goals", { ...BASE_PROFILE, daily_calories: null, protein_target: null }]];

describe("profileReady", () => {
  it("a completed profile with goals is ready; anything less is not", () => {
    expect(profileReady({ ...BASE_PROFILE, onboarding_complete: true })).toBe(true);
    for (const [, p] of MISSING) expect(profileReady(p)).toBe(false);
  });
});

describe("basket generation requires a profile", () => {
  const receiptItems = BASKETS.rich.items.slice(0, 6).map((i, k) => ({ id: `r${k}`, original_name: i.name, normalized_name: i.name, category: i.category, is_food: true, is_approved_for_menu: true, price: 10 }));
  const deps = { additions: async () => [], staples: async () => [] };
  it.each(MISSING)("%s: refused with the onboarding message, nothing built", async (_, profile) => {
    await expect(buildBasket({ receiptItems, profile, weeklyBudget: 400, ...deps })).rejects.toBeInstanceOf(ProfileRequiredError);
  });
  it("with a completed profile the basket is built", async () => {
    const r = await buildBasket({ receiptItems, profile: BASE_PROFILE, weeklyBudget: 400, ...deps });
    expect(r.items.length).toBeGreaterThan(0);
  });
});

describe("menu generation requires a profile", () => {
  const list = { items: BASKETS.rich.items };
  it.each(MISSING)("%s: refused with the onboarding message, no menu", async (_, profile) => {
    await expect(generateNutritionPlan({ list, profile, budget: 400 })).rejects.toThrow(ProfileRequiredError);
  });
});

describe("without a profile, the basket and menu pages say to complete onboarding", () => {
  beforeAll(() => {
    // the pages read the address; server rendering has no window
    globalThis.window = { location: { search: "?build=1", pathname: "/" }, history: { replaceState() {} }, addEventListener() {}, removeEventListener() {} };
  });
  const render = async (page, seed) => {
    const { default: Page } = await import(`@/pages/${page}.jsx`);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seed(client);
    return renderToString(<QueryClientProvider client={client}><MemoryRouter><Page /></MemoryRouter></QueryClientProvider>);
  };
  const noProfile = client => {
    client.setQueryData(["userProfile", USER.email], []);
    client.setQueryData([FLOW_QUERY_KEY, "profile", USER.email], []);
    client.setQueryData([FLOW_QUERY_KEY, "lists", USER.email], [{ id: "l1", items: BASKETS.rich.items }]);
    client.setQueryData([FLOW_QUERY_KEY, "plans", USER.email], []);
  };

  it.each(["ShoppingListPage", "NutritionPlanPage"])("%s shows the profile-required notice with a link to onboarding, and no build button", async page => {
    const html = await render(page, noProfile);
    expect(html).toContain(PROFILE_REQUIRED_TITLE);
    expect(html).toContain('href="/onboarding"');
    expect(html).not.toMatch(/בניית סל מוצרים חכם<|בניית תפריט תזונה|בחירה מחדש|בנייה מחדש/);
  });

  it("a saved menu with no breakfasts is not shown: the page says it is incomplete and offers a rebuild (QA round 5)", async () => {
    const meal = meal_type => ({ meal_type, meal_name: "עוף עם אורז", items: [{ food_name: BASKETS.rich.items[0].name, grams: 200, calories: 300, protein: 40, carbs: 0, fat: 5 }] });
    const broken = { id: "p1", shopping_list_id: "l1", daily_calories: 2200, days: ["Sunday", "Monday"].map(day_name => ({ day_name, meals: [meal("Lunch"), meal("Dinner")] })) };
    const html = await render("NutritionPlanPage", client => {
      noProfile(client);
      client.setQueryData([FLOW_QUERY_KEY, "profile", USER.email], [{ ...BASE_PROFILE, onboarding_complete: true }]);
      client.setQueryData([FLOW_QUERY_KEY, "plans", USER.email], [broken]);
    });
    expect(html).toContain("התפריט השמור לא שלם");
    expect(html).not.toContain("עוף עם אורז");
  });

  it.each(["ShoppingListPage", "NutritionPlanPage"])("%s with a completed profile shows no notice", async page => {
    const html = await render(page, client => {
      noProfile(client);
      client.setQueryData(["userProfile", USER.email], [{ ...BASE_PROFILE, onboarding_complete: true }]);
      client.setQueryData([FLOW_QUERY_KEY, "profile", USER.email], [{ ...BASE_PROFILE, onboarding_complete: true }]);
    });
    expect(html).not.toContain(PROFILE_REQUIRED_TITLE);
  });
});
