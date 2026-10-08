/**
 * Manual QA, round 3 (2026-10-08): "בנייה מחדש" walking through every
 * alternative, the budget card's replacement message, and purchase history
 * across several receipts.
 */
import { describe, it, expect } from "vitest";
import { generateNutritionPlan, menuDifference } from "@/lib/nutritionPlanGenerator";
import { validateMenu } from "@/lib/validateMenu";
import { replacementNote } from "@/lib/basketBudget";
import { buildBasket, correctedReceiptItems, receiptToBasketItem } from "@/lib/basketBuilder";
import { selectCandidates, historyPool } from "@/lib/smartBasketEngine";
import { classifyProduct } from "@/lib/mealPlanRules";
import { spendClass } from "@/lib/receiptClassifier";
import { computePurchaseHistory } from "../server/purchaseHistory.js";
import { weeklyBudget } from "@/lib/pricing";
import { BASKETS, BASE_PROFILE, ITEMS as I } from "./fixtures/baskets";

describe("\"בנייה מחדש\" walks through every alternative", () => {
  const { items, profile } = BASKETS.rich;
  const budget = weeklyBudget(profile);
  const list = { items };

  it("each click gives a menu different from the one on screen, then wraps around to the first", async () => {
    const first = await generateNutritionPlan({ list, profile, budget });
    const seen = [first];
    let current = first;
    for (let click = 1; click <= 6; click++) {
      const next = await generateNutritionPlan({ list, profile, budget, previous: current });
      expect(next.alternative.exhausted).toBe(false);
      expect(menuDifference(current.days, next.days), `click ${click}`).toBeGreaterThanOrEqual(0.25);
      expect(validateMenu({ plan: next, basketItems: items, profile, budget }).level).toBeLessThanOrEqual(2);
      seen.push(next);
      current = next;
      if (next.alternative.wrapped) break;
    }
    const n = first.alternative.of;
    expect(n).toBeGreaterThanOrEqual(3);
    // menu #1 → #2 → #3 … → back to #1, in order
    expect(seen.map(p => p.alternative.index)).toEqual([...Array(n).keys(), 0]);
    expect(seen.at(-1).alternative.wrapped).toBe(true);
    expect(seen.at(-1).days).toEqual(first.days);
  }, 180000);

  it("the list does not move between clicks: the last alternative leads back to the first, not elsewhere", async () => {
    const first = await generateNutritionPlan({ list, profile, budget });
    let current = first;
    for (let k = 1; k < first.alternative.of; k++) current = await generateNutritionPlan({ list, profile, budget, previous: current });
    expect(current.alternative.index).toBe(first.alternative.of - 1);
    const again = await generateNutritionPlan({ list, profile, budget, previous: current });
    expect(again.alternative.index).toBe(0);
  }, 180000);

  it("a menu from an older basket starts the walk at the best menu", async () => {
    const other = await generateNutritionPlan({ list: { items: BASKETS.vegetarian.items }, profile: BASKETS.vegetarian.profile, budget });
    const r = await generateNutritionPlan({ list, profile, budget, previous: other });
    expect(r.alternative).toMatchObject({ index: 0, exhausted: false });
  }, 120000);

  it("a basket with nothing else to offer says so", async () => {
    // one menu only (the tiny basket cannot make breakfast at all — refused, tests/qaRound5.test.js)
    const few = [I.chicken, I.rice, I.tomato, I.bread, I.cottage], p = BASKETS.tiny.profile;
    const first = await generateNutritionPlan({ list: { items: few }, profile: p, budget: weeklyBudget(p) });
    const again = await generateNutritionPlan({ list: { items: few }, profile: p, budget: weeklyBudget(p), previous: first });
    expect(again.alternative.exhausted).toBe(true);
    expect(again.alternative.wrapped).toBe(false);
  }, 60000);
});

describe("the budget card's replacement message", () => {
  const chicken = { name: "חזה עוף טרי 1 ק\"ג", category: "protein", quantity: "1 ק\"ג" };
  const rice = { name: "אורז פרסי 1 ק\"ג", category: "carb", quantity: "1 ק\"ג" };
  const opt = { saving: 5 };
  it("a cheaper product of the same family: the options speak for themselves", () => {
    expect(replacementNote({ item: chicken, options: [opt], broadOptions: [opt] })).toEqual({ kind: "same_family", text: null });
  });
  it("none of the same family, but a cheaper protein of another kind: says so, and they are shown", () => {
    const n = replacementNote({ item: chicken, options: [], broadOptions: [opt] });
    expect(n.kind).toBe("broad_only");
    expect(n.text).toMatch(/מאותה משפחה ששומרת על ערכי החלבון.*ממקור חלבון אחר/);
  });
  it("nothing cheaper of any kind: says that for protein precisely, and where to swap anyway", () => {
    const n = replacementNote({ item: chicken, options: [], broadOptions: [] });
    expect(n.kind).toBe("none");
    expect(n.text).toMatch(/לא מאותה משפחה ולא ממקור חלבון אחר/);
    expect(n.text).toMatch(/החלפה/);
    expect(replacementNote({ item: rice, options: [], broadOptions: [] }).text).toBe("לא מצאנו בקטלוג חלופה זולה יותר שמתאימה לתזונה שלך.");
  });
});

describe("purchase history across several receipts", () => {
  const NOW = new Date("2026-10-08T12:00:00Z");
  let n = 0;
  const row = (receipt, day, name, extra = {}) => ({
    id: `i${n++}`, receipt_id: receipt, purchase_date: `2026-10-0${day}`, created_date: `2026-10-0${day}T10:00:00Z`,
    original_name: name, normalized_name: name, category: "other", quantity: "", price: 10,
    matched_product_id: null, matched_product_name: name, catalog_match_type: "token", catalog_match_status: "matched",
    is_approved_for_menu: 1, user_edited: 0, ...extra,
  });
  // the engine with only the history pool (no catalog): what history alone adds
  const historyOnly = async ({ basket, historyItems, profile, budgetLeft }) => selectCandidates(historyPool(historyItems, profile), basket, { budgetLeft });
  const build = async (rows, latest) => (await buildBasket({
    receiptItems: rows.filter(r => r.receipt_id === latest).map(r => ({ ...r, is_food: true })),
    history: computePurchaseHistory(rows, new Map(), NOW), profile: BASE_PROFILE, weeklyBudget: 400,
    additions: historyOnly, staples: async () => [],
  })).items;
  // five weekly receipts: chicken and yogurt every time, eggs in three
  const five = () => {
    const rows = [];
    for (let d = 1; d <= 5; d++) {
      rows.push(row(`r${d}`, d, "חזה עוף טרי"), row(`r${d}`, d, "יוגורט 3% 200 גרם"));
      if (d % 2) rows.push(row(`r${d}`, d, "ביצים L 12 יחידות"));
    }
    return rows;
  };

  it("one receipt: no history effect (one purchase is not a habit)", async () => {
    const rows = [row("r1", 7, "חזה עוף טרי"), row("r1", 7, "אורז פרסי")];
    const items = await build(rows, "r1");
    expect(items.map(i => i.name)).toEqual(["חזה עוף טרי", "אורז פרסי"]);
    expect(items.some(i => i.from_history)).toBe(false);
  });

  it("repeated foods: a regular missing from the latest receipt is added, with its habit as the reason", async () => {
    const rows = [...five(), row("r6", 7, "אורז פרסי")]; // the latest receipt has only rice
    const items = await build(rows, "r6");
    const yogurt = items.find(i => i.name === "יוגורט 3% 200 גרם");
    expect(yogurt).toMatchObject({ from_history: true, history_receipt_count: 5 });
    expect(yogurt.reason).toMatch(/רכשת את המוצר ב-5 מתוך 6/);
  });

  it("non-food, water and spices from earlier receipts never reach the basket", async () => {
    const rows = [...five(),
      ...[1, 2, 3, 4].map(d => row(`r${d}`, d, "שמפו הד אנד שולדרס")),
      ...[1, 2, 3, 4].map(d => row(`r${d}`, d, "מים מינרליים 6x1.5")),
      ...[1, 2, 3, 4].map(d => row(`r${d}`, d, "פלפל שחור טחון")),
      row("r6", 7, "אורז פרסי")];
    const names = (await build(rows, "r6")).map(i => i.name).join("|");
    expect(names).not.toMatch(/שמפו|מים מינרליים|פלפל שחור/);
  });

  it("black pepper is a spice, not the vegetable", () => {
    expect(classifyProduct("פלפל שחור טחון")).toBe("other");
    expect(classifyProduct("פלפל אדום")).toBe("vegetable");
    expect(spendClass({ normalized_name: "פלפל שחור טחון", is_food: true, is_approved_for_menu: true })).toBe("food_non_plannable");
  });

  it("a product corrected on an earlier receipt is known by its corrected name — the misreading never leaks", async () => {
    const approvedCorn = d => row(`r${d}`, d, "גרעיני דיריז מתוק", { matched_product_name: "גרעיני תירס מתוק יכין550", catalog_match_status: "approved" });
    const rows = [...five(), ...[1, 2, 3, 4, 5].map(approvedCorn), row("r6", 7, "אורז פרסי")];
    const history = computePurchaseHistory(rows, new Map(), NOW);
    expect(history.map(h => h.name)).toContain("גרעיני תירס מתוק יכין550");
    const names = (await build(rows, "r6")).map(i => i.name);
    expect(names).toContain("גרעיני תירס מתוק יכין550");
    expect(names.join("|")).not.toContain("דיריז");
  });

  it("a receipt line corrected after the basket was built is found, and the basket item rebuilt from it", () => {
    const line = row("r1", 7, "גרעיני דיריז מתוק", { id: "corn", catalog_match_status: "matched", matched_product_name: "גרעיני דיריז מתוק" });
    const basket = [receiptToBasketItem({ ...line, is_food: true })];
    expect(correctedReceiptItems(basket, [{ ...line, is_food: true }])).toEqual([]);
    const fixed = { ...line, is_food: true, matched_product_name: "גרעיני תירס מתוק יכין550", catalog_match_status: "approved" };
    const found = correctedReceiptItems(basket, [fixed]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ index: 0, from: "גרעיני דיריז מתוק", item: { name: "גרעיני תירס מתוק יכין550", from_receipt: true, receipt_item_id: "corn" } });
  });
});
