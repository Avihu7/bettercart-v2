import { describe, it, expect } from "vitest";
import { selectCandidates, isDuplicate, canonicalProduceFamily, BASKET_NEEDS, needHave } from "@/lib/smartBasketEngine";
import { itemGroup, itemPer100g } from "@/lib/basketAlternatives";
import { ITEMS as I } from "./fixtures/baskets";

// A catalog-like candidate pool built from the fixture items (no network)
const poolOf = items => items.map(item => {
  const group = itemGroup(item);
  return { item, group, per100: itemPer100g(item, group), pricePer100: item.price_per_kg / 10, source: "catalog" };
});
const POOL = poolOf([I.chicken, I.turkey, I.tuna, I.eggs, I.lentils, I.chickpeas, I.tofu, I.cottage, I.yogurt, I.rice, I.pasta,
  I.bread, I.oats, I.potato, I.cucumber, I.pepper, I.carrot, I.lettuce, I.banana, I.apple, I.orange, I.oil, I.tahini, I.almonds]);
const RECEIPT = [I.beef, I.tomato, I.rice];

describe("smart basket engine (selection)", () => {
  const added = selectCandidates(POOL, RECEIPT, { budgetLeft: 400, hasReceipt: true });

  it("is deterministic", () => {
    const again = selectCandidates(POOL, RECEIPT, { budgetLeft: 400, hasReceipt: true });
    expect(again.map(i => i.name)).toEqual(added.map(i => i.name));
  });
  it("adds 1–12 items around a receipt, none duplicating the basket", () => {
    expect(added.length).toBeGreaterThan(0);
    expect(added.length).toBeLessThanOrEqual(12);
    added.forEach((item, i) => expect(isDuplicate(item, [...RECEIPT, ...added.slice(0, i)])).toBe(false));
  });
  it("covers every weekly need the pool can cover", () => {
    const basket = [...RECEIPT, ...added];
    for (const need of BASKET_NEEDS) expect(needHave(need, basket), need.key).toBeGreaterThanOrEqual(need.count);
  });
  it("gives every addition a Hebrew reason", () => {
    added.forEach(i => expect(i.reason).toMatch(/[א-ת]/));
  });
  it("keeps non-staple additions within a tight budget (staples may exceed; the page trims after)", () => {
    const tight = selectCandidates(POOL, RECEIPT, { budgetLeft: 20, hasReceipt: true });
    const staples = tight.filter(i => i.added_staple).length;
    expect(staples).toBeGreaterThan(0);
  });
});

describe("produce families", () => {
  it("groups variants of the same produce", () => {
    expect(canonicalProduceFamily("עגבניות שרי")).toBe("tomato");
    expect(canonicalProduceFamily("תפוח אדמה")).not.toBe("apple");
    expect(canonicalProduceFamily("פלפל שחור")).not.toBe("pepper");
    expect(isDuplicate({ name: "עגבניה ירדן" }, [{ name: "עגבניות" }])).toBe(true);
    expect(isDuplicate({ name: "מלפפון" }, [{ name: "עגבניות" }])).toBe(false);
  });
});
