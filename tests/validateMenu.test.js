/**
 * The central validator, and the baseline it measures: the quality level of
 * the current planner on every fixture basket. A planner change may keep or
 * improve a basket's level, never make it worse.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { validateMenu } from "@/lib/validateMenu";
import { generateNutritionPlan } from "@/lib/nutritionPlanGenerator";
import { weeklyBudget } from "@/lib/pricing";
import { BASKETS, BASE_PROFILE, ITEMS as I } from "./fixtures/baskets";

// Quality levels of the old fixed-template planner (menuComposer.js, removed) on 2026-10-07 — the baseline.
// 2026-10-08 (QA): the validator now also checks variety across meal types (the same
// meal moved between breakfast / lunch / dinner, one food in most of the week's meals).
// Under that stricter yardstick the vegan basket is level 2 — tofu, its only breakfast
// protein, fills 18 of 21 meals (reported as limited by the basket).
export const BASELINE = { rich: 3, limited: 2, vegan: 2, vegetarian: 2, kosher: 3, allergies: 2, expensive: 3, tiny: 4, real: 3 };
// Levels of the weekly planner (candidates → scoring → greedy + local search) — locked in.
// kosher/real/expensive: fat and budget (see the explanations); limited/tiny: the basket.
// vegan / allergies: level 2 since the cross-meal variety checks (2026-10-08) — real repeats:
// tofu in most meals; eggs or bread at every meal type once fish and nuts are excluded.
export const CURRENT = { rich: 1, limited: 2, vegan: 2, vegetarian: 1, kosher: 3, allergies: 2, expensive: 3, tiny: 4, real: 3 };

describe("validator checks", () => {
  const basket = [I.chicken, I.cottage, I.rice, I.bread, I.tomato, I.cucumber, I.banana, I.oil];
  const item = (p, grams, kcal, protein) => ({ food_name: p.name, grams, calories: kcal, protein, carbs: 0, fat: 0 });
  // A plausible day: 2200 kcal, 140 g protein (macros only matter for the nutrition checks)
  const day = (name, lunch = I.chicken) => ({ day_name: name, meals: [
    { meal_type: "Breakfast", meal_name: "לחם עם קוטג'", items: [item(I.bread, 100, 400, 9), item(I.cottage, 200, 200, 22), item(I.tomato, 120, 20, 1)] },
    { meal_type: "Lunch", meal_name: "עוף עם אורז", items: [item(lunch, 250, 300, 58), item(I.rice, 180, 500, 15), item(I.cucumber, 120, 20, 1)] },
    { meal_type: "Dinner", meal_name: "לחם עם קוטג'", items: [item(I.bread, 80, 300, 7), item(I.cottage, 200, 200, 22), item(I.cucumber, 120, 20, 1)] },
    { meal_type: "Snacks", meal_name: "בננה", items: [item(I.banana, 150, 240, 14)] },
  ] });
  const week = lunch => ({ days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(n => day(n, lunch)) });
  const profile = { ...BASE_PROFILE, fat_target: null, carbs_target: null };

  it("passes safety and realism on a valid week; limited variety is level 2", () => {
    const v = validateMenu({ plan: week(), basketItems: basket, profile });
    expect(v.failed).toEqual([]);
    expect(v.limited).toContain("lunch_protein_repeat"); // one lunch protein in the basket
    expect(v.level).toBe(2);
  });
  it("level 4 for a product that is not in the basket", () => {
    const v = validateMenu({ plan: week(I.salmon), basketItems: basket, profile });
    expect(v.failed).toContain("products_exist");
    expect(v.level).toBe(4);
  });
  it("level 4 for a diet violation", () => {
    const v = validateMenu({ plan: week(), basketItems: basket, profile: { ...profile, dietary_preferences: ["צמחוני"] } });
    expect(v.failed).toContain("profile_safe");
    expect(v.level).toBe(4);
  });
  it("level 4 for meat with dairy in one meal", () => {
    const plan = week();
    plan.days[0].meals[1].items.push(item(I.cottage, 100, 100, 11));
    expect(validateMenu({ plan, basketItems: basket, profile }).failed).toContain("kosher_separation");
  });
  it("level 3 over budget", () => {
    const v = validateMenu({ plan: week(), basketItems: basket, profile, budget: 50 });
    expect(v.failed).toContain("within_budget");
    expect(v.level).toBe(3);
  });
  it("level 3 when protein is short", () => {
    const v = validateMenu({ plan: week(), basketItems: basket, profile: { ...profile, protein_target: 250 } });
    expect(v.failed).toContain("protein");
    expect(v.level).toBe(3);
  });
  it("lunch repeats are a planner failure when the basket has alternatives", () => {
    const v = validateMenu({ plan: week(), basketItems: [...basket, I.lentils], profile });
    expect(v.failed).toContain("lunch_protein_repeat");
  });
  it("level 4 when the basket lacks key food groups", () => {
    const v = validateMenu({ plan: week(), basketItems: [I.chicken, I.rice], profile });
    expect(v.checks.find(c => c.id === "coverage").data.missing).toEqual(expect.arrayContaining(["vegetable"]));
    expect(v.level).toBe(4);
  });
});

describe("baseline: quality level per fixture basket", () => {
  const results = {};
  beforeAll(async () => {
    for (const [label, { items, profile }] of Object.entries(BASKETS)) {
      const budget = weeklyBudget(profile);
      const plan = await generateNutritionPlan({ list: { items }, profile, budget });
      results[label] = validateMenu({ plan, basketItems: items, profile, budget });
    }
  }, 120000);

  it.each(Object.keys(BASELINE))("%s basket is no worse than its baseline level", label => {
    expect(results[label].level).toBeLessThanOrEqual(BASELINE[label]);
  });
  it.each(Object.keys(CURRENT))("%s basket keeps the weekly planner's level", label => {
    expect(results[label].level).toBeLessThanOrEqual(CURRENT[label]);
  });
  it("never breaks safety on any basket", () => {
    for (const [label, v] of Object.entries(results)) {
      expect(v.failed.filter(id => ["products_exist", "no_non_food", "profile_safe", "kosher_separation"].includes(id)), label).toEqual([]);
    }
  });
});
