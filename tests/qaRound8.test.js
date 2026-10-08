/**
 * Manual QA, round 8 (2026-10-08): the quality card said "the menu repeats the same
 * foods although the basket has alternatives — try 'בנייה מחדש'", when the planner had
 * only one valid week. Alternative products in the basket are not another valid menu:
 * rebuild is suggested only when the planner found more than one (menuAlternatives).
 */
import { describe, it, expect } from "vitest";
import { explainMenu } from "@/lib/explainMenu";

const text = e => e.points.map(p => p.text).join("\n");
// a week that repeats tuna across breakfast, lunch and dinner although the basket has other foods
const validation = (extra = []) => ({
  level: 2, offer: { has: {}, mainProteins: [] }, stats: {},
  checks: [
    { id: "cross_meal_repeat", area: "variety", ok: false, data: { crossMeal: [], sameDayCore: [] } },
    { id: "product_repeat", area: "variety", ok: false, data: { overused: [{ product: "טונה במים", meals: 12, of: 21 }] } },
    { id: "lunch_protein_repeat", area: "variety", ok: false, data: { overLunch: [{ product: "טונה במים", lunches: 5 }], alternatives: 3 } },
    { id: "breakfast_variety", area: "variety", ok: false, data: { styles: {} } },
    ...extra,
  ],
});

describe("\"בנייה מחדש\" is suggested only when another valid menu exists", () => {
  it("several valid menus: the card may suggest a rebuild", () => {
    const t = text(explainMenu(validation(), { menuAlternatives: 3 }));
    expect(t).toMatch(/יש חלופות בסל — אפשר לנסות "בנייה מחדש" לתפריט מגוון יותר/);
  });

  it.each([["one valid menu (alternative.of === 1)", 1], ["rebuild exhausted (counted as 1)", 1], ["unknown (an older menu)", null]])(
    "%s: no rebuild promise — says no other realistic week was found, and what to change", (_, menuAlternatives) => {
      const t = text(explainMenu(validation(), { menuAlternatives }));
      expect(t).not.toMatch(/בנייה מחדש/);
      expect(t).not.toMatch(/מגבלה של בניית התפריט/);
      expect(t).toMatch(/לא נמצאה חלופה שבועית ריאלית נוספת מהסל הנוכחי/);
      expect(t).toMatch(/אפשר לבחור סל חלופי או להוסיף לסל עוד מקורות חלבון, פחמימה או ירקות מתאימים/);
    });

  it("when protein is what limits the week, the card says so", () => {
    const short = { id: "protein", area: "nutrition", ok: false, data: { low: [{ day: "Sunday", protein: 140 }] } };
    const t = text(explainMenu({ ...validation([short]), level: 3 }, { menuAlternatives: 1 }));
    expect(t).toMatch(/הסל הנוכחי מגביל את הגיוון בגלל מחסור במקורות חלבון ריאליים/);
    expect(t).not.toMatch(/בנייה מחדש/);
  });
});
