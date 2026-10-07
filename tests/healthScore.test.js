import { describe, it, expect } from "vitest";
import { productHealthScore } from "@/lib/healthScore";

// [name, min, max]
const CASES = [
  ["נקטרינה", 7, 10], ["קורנפלקס", 3, 7], ["סלק", 8, 10], ["קוקה קולה", 0, 2], ["חזה עוף", 8, 10],
  ["נקניק", 0, 4], ["לחם מלא", 6, 8], ["לחם לבן", 3, 5], ["קוטג' 5%", 7, 9], ["גבינה צהובה 28%", 4, 6],
  ["מים מינרליים", 10, 10], ["ברוקולי", 9, 10], ["טופו", 7, 10], ["שמן זית", 7, 9], ["פיתות", 4, 7],
  ["ענבים", 8, 10], ["גומי לעיסה", 0, 3], ["תפוח אדמה", 6, 9], ["מיץ תפוזים", 3, 5], ["נקטר אפרסק", 0, 2],
];

describe("productHealthScore", () => {
  it.each(CASES)("%s scores %i–%i", (name, lo, hi) => {
    const s = productHealthScore(name);
    expect(s).toBeGreaterThanOrEqual(lo);
    expect(s).toBeLessThanOrEqual(hi);
  });
  it("is deterministic", () => {
    expect(productHealthScore("גבינת קוטג 5%")).toBe(productHealthScore("גבינת קוטג 5%"));
  });
});
