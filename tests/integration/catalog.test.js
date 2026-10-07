/**
 * Integration checks against the running API (catalog search, matching data).
 * Skipped unless run with `npm run test:integration` (API on localhost:3001) or BETTERCART_API set, e.g.:
 *   BETTERCART_API=http://localhost:3001 npm test
 */
import { describe, it, expect, beforeAll } from "vitest";
import { buildSmartAdditions } from "@/lib/smartBasketEngine";
import { ITEMS as I } from "../fixtures/baskets";

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

  it("builds deterministic smart additions with no vegan leaks", async () => {
    const profile = { dietary_preferences: ["טבעוני"], allergies: [], disliked_foods: [] };
    const basket = [I.tomato, I.rice];
    const a = await buildSmartAdditions({ basket, profile, budgetLeft: 400, hasReceipt: true });
    const b = await buildSmartAdditions({ basket, profile, budgetLeft: 400, hasReceipt: true });
    expect(b.map(i => i.name)).toEqual(a.map(i => i.name));
    expect(a.map(i => i.name).join(" ")).not.toMatch(/עוף|בקר|טונה|ביצ|קוטג|גבינ|יוגורט/);
  }, 30000);
});
