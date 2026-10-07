import { describe, it, expect } from "vitest";
import { computePurchaseHistory } from "../server/purchaseHistory.js";

const now = new Date("2026-10-07T12:00:00Z");
const row = (rid, date, name) => ({
  id: `${rid}-${name}`, receipt_id: rid, purchase_date: date, created_date: date,
  normalized_name: name, matched_product_name: name, catalog_match_status: "matched",
});

describe("purchase history", () => {
  const rows = [];
  for (let r = 0; r < 6; r++) rows.push(row(`r${r}`, `2026-09-${String(10 + r * 3).padStart(2, "0")}`, "קוטג' 5%"));
  rows.push(row("r5", "2026-09-25", "במבה"));
  const history = computePurchaseHistory(rows, new Map(), now);
  const cottage = history.find(p => p.name === "קוטג' 5%");
  const bamba = history.find(p => p.name === "במבה");

  it("scores a frequent healthy product as a strong habit", () => {
    expect(cottage.history_score).toBeGreaterThan(0.65);
    expect(cottage.receipt_count).toBe(6);
  });
  it("scores a one-off snack lower", () => {
    expect(bamba.history_score).toBeLessThan(cottage.history_score);
  });
  it("keeps a single receipt near neutral", () => {
    const one = computePurchaseHistory([row("x", "2026-10-01", "חלב 1%")], new Map(), now);
    expect(Math.abs(one[0].history_score - 0.5)).toBeLessThan(0.12);
  });
  it("ignores an implausible future purchase date", () => {
    const future = computePurchaseHistory([row("x", "2030-01-01", "חלב")], new Map(), now);
    expect(future[0].days_since_last_seen).toBeGreaterThanOrEqual(0);
  });
});
