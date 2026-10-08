import { describe, it, expect } from "vitest";
import { fitPlanToBudget, planCost } from "@/lib/mealPlanBudget";
import { buildProductCatalog, validatePlan, recomputeTotals } from "@/lib/mealPlanRules";
import { buildDensities, applyDensities, closeCalories } from "@/lib/mealPlanCalories";
import { buildFinalShoppingList } from "@/lib/shoppingOptimizer";
import { ITEMS as I } from "./fixtures/baskets";

const basket = [I.beef, I.chicken, I.lentils, I.rice, I.bread, I.cottage, I.tomato, I.cucumber, I.banana, I.oil];
const catalog = buildProductCatalog(basket);
const id = name => catalog.find(p => p.name_he === name).id;
const it_ = (name, grams) => ({ product_id: id(name), food_name: name, grams });
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const targets = { calories: 2200, protein: 140, fat: 70 };

function beefWeek() {
  const plan = { days: DAYS.map(day_name => ({ day_name, meals: [
    { meal_type: "Breakfast", meal_name: "לחם מלא עם קוטג' ועגבניות", items: [it_(I.bread.name, 120), it_(I.cottage.name, 200), it_(I.tomato.name, 150)] },
    { meal_type: "Lunch", meal_name: "בשר טחון עם אורז ומלפפון", items: [it_(I.beef.name, 250), it_(I.rice.name, 250), it_(I.cucumber.name, 150), it_(I.oil.name, 10)] },
    { meal_type: "Dinner", meal_name: "לחם מלא עם קוטג' ומלפפון", items: [it_(I.bread.name, 100), it_(I.cottage.name, 200), it_(I.cucumber.name, 150)] },
    { meal_type: "Snacks", meal_name: "בננה", items: [it_(I.banana.name, 150)] },
  ] })) };
  const densities = buildDensities(catalog, { days: [] });
  applyDensities(plan, densities);
  const reports = closeCalories(plan, catalog, densities, targets);
  return { plan, densities, reports };
}

describe("fitPlanToBudget", () => {
  const { plan, densities, reports } = beefWeek();
  const before = planCost(basket, plan.days);
  const problemsBefore = validatePlan(plan, catalog).length;

  it("leaves a menu within budget untouched", () => {
    const p = structuredClone(plan);
    const r = fitPlanToBudget({ plan: p, catalog, densities, targets, basketItems: basket, budget: 10000, reports });
    expect(r.swaps).toHaveLength(0);
    expect(p).toEqual(plan);
  });

  it("reaches a reachable budget with valid swaps, keeping calories and protein", () => {
    // reachable while keeping meal shapes, ≤3 lunches per protein and one main protein per
    // plate (85% was reached only with lentils + chicken on one plate — QA round 4)
    const budget = Math.round(before * 0.95);
    const p = structuredClone(plan);
    const r = fitPlanToBudget({ plan: p, catalog, densities, targets, basketItems: basket, budget, reports });
    recomputeTotals(p);
    expect(r.fits).toBe(true);
    expect(r.estimated_cost).toBeLessThanOrEqual(budget);
    expect(buildFinalShoppingList(basket, p.days).total_estimated_cost).toBe(r.estimated_cost);
    expect(validatePlan(p, catalog).length).toBeLessThanOrEqual(problemsBefore);
    p.days.forEach(d => expect(Math.abs(d.total_calories - 2200) / 2200).toBeLessThanOrEqual(0.05));
    p.days.forEach(d => expect(d.total_protein).toBeGreaterThanOrEqual(140 * 0.85));
    // no second protein added to a plate to make the swap's numbers work
    const plateProteins = m => m.items.filter(i => ["meat", "fish", "legumes"].includes(catalog.find(c => c.id === i.product_id)?.group)).length;
    p.days.forEach(d => d.meals.forEach(m => expect(plateProteins(m), `${d.day_name}/${m.meal_type}`).toBeLessThanOrEqual(1)));
  });

  it("reports an unreachable budget honestly, never raising the cost", () => {
    const p = structuredClone(plan);
    const r = fitPlanToBudget({ plan: p, catalog, densities, targets, basketItems: basket, budget: 60, reports });
    expect(r.fits).toBe(false);
    expect(r.over_by).toBeGreaterThan(0);
    expect(r.estimated_cost).toBeLessThanOrEqual(r.cost_before);
    expect(r.top_costs.length).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const a = structuredClone(plan), b = structuredClone(plan);
    fitPlanToBudget({ plan: a, catalog, densities, targets, basketItems: basket, budget: 150, reports });
    fitPlanToBudget({ plan: b, catalog, densities, targets, basketItems: basket, budget: 150, reports });
    expect(a).toEqual(b);
  });
});
