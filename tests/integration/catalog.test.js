/**
 * Integration checks against the running API (catalog search, matching data).
 * Skipped unless run with `npm run test:integration` (API on localhost:3001) or BETTERCART_API set, e.g.:
 *   BETTERCART_API=http://localhost:3001 npm test
 */
import { describe, it, expect, beforeAll } from "vitest";
import { buildSmartAdditions } from "@/lib/smartBasketEngine";
import { ITEMS as I } from "../fixtures/baskets";
import { classifyProduct } from "@/lib/mealPlanRules";
import STATE from "../fixtures/qaRound5State.json";
import { buildBasketAlternatives, basketDifference } from "@/lib/basketBuilder";
import { basketSufficiency } from "@/lib/basketAlternatives";
import { generateNutritionPlan } from "@/lib/nutritionPlanGenerator";
import { validateMenu } from "@/lib/validateMenu";
import { planMissingMeals } from "@/lib/flowData";
import { weeklyBudget, basketBudget } from "@/lib/pricing";

const API = process.env.BETTERCART_API || (import.meta.env.MODE === "integration" ? "http://localhost:3001" : null);
const search = async q => (await (await fetch(`${API}/api/products/search?q=${encodeURIComponent(q)}&limit=10`)).json()).results || [];

describe.runIf(!!API)("catalog API", () => {
  beforeAll(() => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (u, o) => realFetch(String(u).startsWith("/") ? API + u : u, o);
  });

  it("returns real pack weights for per-kg products", async () => {
    const beef = (await search("בשר בקר טחון טרי")).find(r => r.sold_by_weight);
    expect(beef.pack_grams).toBe(1000);
    expect(beef.price_per_100g).toBeLessThan(20);
  });

  it("does not return cosmetics as food", async () => {
    for (const q of ["סרום", "מסקרה", "שמפו", "קרם לחות"]) {
      const names = (await search(q)).map(r => r.original_product_name);
      expect(names.filter(n => new RegExp(q).test(n) && !/מסקרפונה/.test(n)), q).toEqual([]);
    }
  });

  it("keeps foods that share words with cosmetics", async () => {
    expect((await search("קרם קוקוס")).length).toBeGreaterThan(0);
    expect((await search("קורנפלקס")).length).toBeGreaterThan(0);
  });

  it("QA round 5: a receipt whose only breakfast base is bread gets eggs / yogurt / cereal from the real catalog", async () => {
    const basket = STATE.basket.filter(i => i.from_receipt);
    const added = await buildSmartAdditions({ basket, profile: STATE.profile, budgetLeft: 250, hasReceipt: true });
    const groups = added.map(i => classifyProduct(i.name, i.category));
    expect(groups.some(g => ["eggs", "yogurt", "cereal"].includes(g)), added.map(i => i.name).join(", ")).toBe(true);
  }, 30000);

  it("basket alternatives (real catalog): each a different basket that meets every goal and makes a complete menu", async () => {
    const receiptItems = STATE.basket.filter(i => i.from_receipt).map((i, k) => ({
      id: `r${k}`, original_name: i.name, normalized_name: i.name, category: i.category, is_food: true, is_approved_for_menu: true,
      quantity: i.quantity, price: i.estimated_price, matched_product_name: i.name, catalog_match_status: "matched",
    }));
    const args = { receiptItems, history: [], profile: STATE.profile, weeklyBudget: weeklyBudget(STATE.profile) };
    let r = await buildBasketAlternatives(args);
    const n = r.alternative.of;
    expect(n).toBeGreaterThanOrEqual(2);
    for (let k = 0; k < n; k++) {
      expect(r.alternative.index).toBe(k);
      expect(r.total).toBeLessThanOrEqual(args.weeklyBudget);
      expect(basketSufficiency(r.items, STATE.profile).issues).toEqual([]);
      const list = { items: r.items }, budget = basketBudget(STATE.profile, list);
      const plan = await generateNutritionPlan({ list, profile: STATE.profile, budget });
      expect(planMissingMeals(plan)).toEqual([]);
      expect(validateMenu({ plan, basketItems: r.items, profile: STATE.profile, budget }).level, `basket ${k + 1}`).toBeLessThanOrEqual(2);
      const next = await buildBasketAlternatives({ ...args, previous: r.items });
      if (k < n - 1) expect(basketDifference(r.items, next.items)).toBeGreaterThanOrEqual(0.4);
      r = next;
    }
  }, 120000);

  it("builds deterministic smart additions with no vegan leaks", async () => {
    const profile = { dietary_preferences: ["טבעוני"], allergies: [], disliked_foods: [] };
    const basket = [I.tomato, I.rice];
    const a = await buildSmartAdditions({ basket, profile, budgetLeft: 400, hasReceipt: true });
    const b = await buildSmartAdditions({ basket, profile, budgetLeft: 400, hasReceipt: true });
    expect(b.map(i => i.name)).toEqual(a.map(i => i.name));
    expect(a.map(i => i.name).join(" ")).not.toMatch(/עוף|בקר|טונה|ביצ|קוטג|גבינ|יוגורט/);
  }, 30000);
});
