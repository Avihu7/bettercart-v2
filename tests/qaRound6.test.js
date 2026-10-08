/**
 * Manual QA, round 6 (2026-10-08): breakfast realism. A tuna sandwich (50 g on
 * bread) is a breakfast; tuna on oatmeal / cereal / yogurt is not, nor three protein
 * foods piled on one breakfast to reach the protein number; 10 g of fish or meat is
 * never a portion. Quality before the number of alternatives: with the QA account's
 * current basket (tests/fixtures/qaRound6State.json) only one realistic menu meets
 * every goal — "בנייה מחדש" says so instead of offering an unrealistic one.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { generateNutritionPlan, menuDifference, ONLY_MENU_MESSAGE } from "@/lib/nutritionPlanGenerator";
import { checkMeal, buildProductCatalog, classifyProduct } from "@/lib/mealPlanRules";
import { validateMenu } from "@/lib/validateMenu";
import { planMissingMeals } from "@/lib/flowData";
import { basketBudget } from "@/lib/pricing";
import STATE from "./fixtures/qaRound6State.json";

const { profile: PROFILE, basket: BASKET } = STATE;

describe("minimum protein portions depend on the meal", () => {
  const catalog = buildProductCatalog([
    { name: "טונה במים בד\"צ כשל\"פ 960", category: "protein" }, { name: "סרדינים בשמן סויה 120 גר", category: "protein" },
    { name: "חזה עוף טרי 1 ק\"ג", category: "protein" }, { name: "פיתות מרקם מיוחד", category: "carb" },
    { name: "קינואה 500 גרם", category: "carb" }, { name: "עגבניה", category: "vegetable" }, { name: "מלפפון", category: "vegetable" },
    { name: "שיבולת שועל מלאה", category: "carb" }, { name: "יוגורט 3%", category: "dairy" }, { name: "חלב 3%", category: "dairy" },
    { name: "בננה", category: "fruit" }, { name: "גבינה בולגרית 5%", category: "dairy" }, { name: "קוטג' 5%", category: "dairy" },
    { name: "ביצים L 12 יחידות", category: "protein" },
  ]);
  const id = name => catalog.find(p => p.name_he.startsWith(name)).id;
  const meal = (meal_type, items) => ({ meal_type, meal_name: "ארוחה", items: items.map(([n, g]) => ({ product_id: id(n), food_name: catalog.find(p => p.id === id(n)).name_he, grams: g })) });
  const portionIssues = m => checkMeal(m, catalog).filter(i => /unrealistic portion/.test(i));

  it("2. 50 g tuna on bread is a valid breakfast (a sandwich)", () => {
    expect(portionIssues(meal("Breakfast", [["טונה", 50], ["פיתות", 100], ["עגבניה", 120], ["מלפפון", 120]]))).toEqual([]);
  });
  it("3. 10 g of sardines or tuna is rejected everywhere — on bread at breakfast too", () => {
    expect(portionIssues(meal("Breakfast", [["סרדינים", 10], ["פיתות", 100], ["עגבניה", 120]])).join()).toMatch(/10g סרדינים.*min 40g/);
    expect(portionIssues(meal("Lunch", [["סרדינים", 10], ["קינואה", 250], ["עגבניה", 120]])).join()).toMatch(/10g סרדינים.*min 60g/);
    expect(portionIssues(meal("Breakfast", [["טונה", 30], ["פיתות", 100], ["עגבניה", 120]])).join()).toMatch(/min 40g/);
  });
  it("4. lunch and dinner plates keep the main-meal minimum (60 g)", () => {
    expect(portionIssues(meal("Lunch", [["טונה", 50], ["קינואה", 250], ["עגבניה", 120]])).join()).toMatch(/50g טונה.*min 60g/);
    expect(portionIssues(meal("Dinner", [["חזה עוף", 50], ["קינואה", 250], ["עגבניה", 120]])).join()).toMatch(/50g חזה עוף.*min 60g/);
    expect(portionIssues(meal("Lunch", [["חזה עוף", 180], ["קינואה", 250], ["עגבניה", 120]]))).toEqual([]);
  });
  const breakfastIssues = m => checkMeal(m, catalog).filter(i => /breakfast/.test(i));
  it("3b. tuna / fish with oats, cereal or yogurt is not a breakfast", () => {
    expect(breakfastIssues(meal("Breakfast", [["שיבולת", 50], ["חלב", 200], ["בננה", 120], ["טונה", 150]])).join()).toContain("oats / cereal / yogurt");
    expect(breakfastIssues(meal("Breakfast", [["יוגורט", 200], ["בננה", 120], ["סרדינים", 80]])).join()).toContain("oats / cereal / yogurt");
    expect(breakfastIssues(meal("Breakfast", [["שיבולת", 50], ["חלב", 200], ["בננה", 120]]))).toEqual([]);
  });
  it("4b. more than two protein foods on one breakfast is protein piling, not a breakfast", () => {
    // the QA examples: oats + milk + banana + cheese + cottage + tuna; cheese + pita + cottage + tuna
    expect(breakfastIssues(meal("Breakfast", [["שיבולת", 30], ["חלב", 200], ["בננה", 70], ["גבינה", 100], ["קוטג", 250], ["טונה", 250]])).join()).toMatch(/more than two protein foods/);
    expect(breakfastIssues(meal("Breakfast", [["גבינה", 85], ["פיתות", 80], ["קוטג", 200], ["טונה", 45], ["מלפפון", 120]])).join()).toContain("more than two protein foods at breakfast (3)");
    // two is fine: cheese and an egg on bread
    expect(breakfastIssues(meal("Breakfast", [["גבינה", 60], ["ביצים", 100], ["פיתות", 80], ["עגבניה", 120]]))).toEqual([]);
  });
  it("a breakfast without bread gets no sandwich allowance", () => {
    expect(portionIssues(meal("Breakfast", [["טונה", 50], ["עגבניה", 120], ["מלפפון", 120]])).join()).toMatch(/min 60g/);
  });
});

describe("the QA account's current basket: only realistic menus", () => {
  const list = { items: BASKET };
  const budget = basketBudget(PROFILE, list);
  const PROTEIN = new Set(["meat", "fish", "eggs", "dairy_protein", "legumes", "yogurt"]);
  let seq;
  beforeAll(async () => {
    let cur = await generateNutritionPlan({ list, profile: PROFILE, budget });
    seq = [cur];
    for (let k = 0; k < cur.alternative.of; k++) { cur = await generateNutritionPlan({ list, profile: PROFILE, budget, previous: cur }); seq.push(cur); }
  }, 300000);
  const menus = () => seq.slice(0, seq[0].alternative.of);

  it("1. every breakfast is realistic: no meat / fish with oats, cereal or yogurt, at most two protein foods", () => {
    for (const p of menus()) for (const d of p.days) {
      const groups = d.meals.find(m => m.meal_type === "Breakfast").items.map(i => classifyProduct(i.food_name));
      const where = `menu ${p.alternative.index + 1} ${d.day_name}`;
      expect(groups.some(g => g === "meat" || g === "fish") && groups.some(g => g === "cereal" || g === "yogurt"), where).toBe(false);
      expect(groups.filter(g => PROTEIN.has(g)).length, where).toBeLessThanOrEqual(2);
    }
  });

  it("5. every menu rebuild shows is complete (breakfast, lunch, dinner, snack every day) and passes every realism check", () => {
    for (const p of menus()) {
      expect(planMissingMeals(p)).toEqual([]);
      expect(p.days.every(d => d.meals.some(m => m.meal_type === "Snacks"))).toBe(true);
      const q = validateMenu({ plan: p, basketItems: BASKET, profile: PROFILE, budget });
      expect(q.level, `menu ${p.alternative.index + 1}`).toBeLessThan(4);
      expect(q.checks.filter(c => c.area === "realism" && !c.ok)).toEqual([]);
    }
  });

  it("6. one valid menu or several: rebuild is honest — the next different menu, or \"no other menu\"", () => {
    const n = seq[0].alternative.of;
    expect(n).toBeGreaterThanOrEqual(1);
    if (n === 1) {
      // no fake alternative: rebuild says there is none, and the page says why
      expect(seq[1].alternative.exhausted).toBe(true);
      expect(ONLY_MENU_MESSAGE).toMatch(/לא נמצא תפריט חלופי שונה מספיק שעומד בכל היעדים/);
    } else {
      expect(seq.map(p => p.alternative.index)).toEqual([...Array(n).keys(), 0]);
      for (let k = 1; k < seq.length; k++) expect(menuDifference(seq[k - 1].days, seq[k].days)).toBeGreaterThanOrEqual(0.25);
    }
  });
});
