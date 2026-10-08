import { describe, it, expect, beforeAll } from "vitest";
import { generateNutritionPlan } from "@/lib/nutritionPlanGenerator";
import { validateMenu } from "@/lib/validateMenu";
import { explainMenu } from "@/lib/explainMenu";
import { weeklyBudget } from "@/lib/pricing";
import { BASKETS, ITEMS as I } from "./fixtures/baskets";

const explained = {};
beforeAll(async () => {
  for (const label of ["vegan", "limited", "real", "vegetarian"]) {
    const { items, profile } = BASKETS[label];
    const budget = weeklyBudget(profile);
    const plan = await generateNutritionPlan({ list: { items }, profile, budget });
    explained[label] = explainMenu(validateMenu({ plan, basketItems: items, profile, budget }), { plan, basketItems: items, profile });
  }
  // The tiny basket cannot make a complete week, so no menu is built for it any more
  // (tests/qaRound5.test.js). Its level-4 explanation is checked on the week the planner
  // used to build: chicken, rice and tomato at lunch and dinner, no breakfast.
  const { items, profile } = BASKETS.tiny;
  const meal = meal_type => ({ meal_type, meal_name: "עוף עם אורז ועגבניה", items: items.map(i => ({ food_name: i.name, grams: 150, calories: 300, protein: 30, carbs: 30, fat: 5 })) });
  const plan = { days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(day_name => ({ day_name, meals: [meal("Lunch"), meal("Dinner")] })) };
  explained.tiny = explainMenu(validateMenu({ plan, basketItems: items, profile, budget: weeklyBudget(profile) }), { plan, basketItems: items, profile });
}, 120000);
const text = e => e.points.map(p => p.text).join("\n");

describe("menu explanation", () => {
  it("level 1: a short summary, nothing to add", () => {
    expect(explained.vegetarian.level).toBe(1);
    expect(explained.vegetarian.points.map(p => p.area)).toEqual(["summary"]);
    expect(explained.vegetarian.add).toEqual([]);
  });

  it("the same food all week, limited by a vegan basket: says so honestly, suggests vegan foods only", () => {
    // tofu is the vegan basket's only breakfast protein: it fills most of the week's meals
    const e = explained.vegan;
    expect(e.level).toBe(2);
    expect(text(e)).toMatch(/בסל יש מגוון מוגבל, ולכן התפריט חוזר על אותם מוצרים/);
    expect(text(e)).toMatch(/טופו, טמפה, עדשים, חומוס/);
    expect(text(e) + e.add.join(" ")).not.toMatch(/ביצים|יוגורט|טונה|עוף/);
  });

  it("level 2 limited by the basket: says why it repeats and what to add", () => {
    const e = explained.limited;
    expect(e.level).toBe(2);
    expect(text(e)).toMatch(/מקור החלבון היחיד לצהריים/);
    expect(text(e)).toMatch(/ארוחת הבוקר חוזרת על עצמה כי בסל אין ביצים, יוגורט, דגני בוקר/);
    expect(e.add).toEqual(expect.arrayContaining(["ביצים", "יוגורט"]));
  });

  it("level 2 by the planner: says the basket had alternatives", () => {
    // chicken at all 7 lunches although the basket has 3 lunch proteins
    const basket = [I.chicken, I.lentils, I.eggs, I.cottage, I.rice, I.bread, I.tomato, I.cucumber, I.pepper, I.banana, I.apple];
    const meal = (type, ...items) => ({ meal_type: type, meal_name: "ארוחה", items: items.map(([p, g]) => ({ food_name: p.name, grams: g, calories: 0, protein: 0, carbs: 0, fat: 0 })) });
    const plan = { days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(day_name => ({ day_name, meals: [
      meal("Breakfast", [I.bread, 100], [I.cottage, 150], [I.tomato, 100]),
      meal("Lunch", [I.chicken, 200], [I.rice, 200], [I.cucumber, 100]),
      meal("Dinner", [I.eggs, 120], [I.bread, 80], [I.pepper, 100]),
      meal("Snacks", [I.banana, 150]),
    ] })) };
    const profile = { ...BASKETS.rich.profile, daily_calories: null, protein_target: null, fat_target: null, carbs_target: null };
    const v = validateMenu({ plan, basketItems: basket, profile });
    // the planner found other valid weeks: rebuild is worth suggesting
    expect(text(explainMenu(v, { plan, basketItems: basket, profile, menuAlternatives: 3 }))).toMatch(/מופיע ב-7 ארוחות צהריים, למרות שיש בסל חלופות — אפשר לנסות "בנייה מחדש"/);
    // only one valid week: alternatives in the basket, but no rebuild promise (tests/qaRound8.test.js)
    expect(text(explainMenu(v, { plan, basketItems: basket, profile, menuAlternatives: 1 }))).not.toMatch(/בנייה מחדש/);
  });

  it("level 3 over budget: amount, the protein trade-off, and the way to the basket", () => {
    const e = explained.real;
    expect(e.level).toBe(3);
    expect(text(e)).toMatch(/מעל תקציב המזון השבועי/);
    expect(text(e)).toMatch(/יעד החלבון שלך \(175 ג׳ ביום\) יקר ביחס לתקציב/);
    expect(e.budgetAction).toBe(true);
  });

  it("level 4: what is missing, without the symptoms that follow from it", () => {
    const e = explained.tiny;
    expect(e.level).toBe(4);
    expect(text(e)).toMatch(/חסרים סוגי מזון בסיסיים/);
    expect(e.points.every(p => ["coverage", "safety", "realism"].includes(p.area))).toBe(true);
    expect(e.add.length).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const { items, profile } = BASKETS.real;
    const budget = weeklyBudget(profile);
    return generateNutritionPlan({ list: { items }, profile, budget }).then(plan => {
      const again = explainMenu(validateMenu({ plan, basketItems: items, profile, budget }), { plan, basketItems: items, profile });
      expect(again).toEqual(explained.real);
    });
  });
});
