/**
 * "בחירה מחדש" on the smart basket (QA, 2026-10-08): the next deterministic
 * alternative basket — meaningfully different, and as good as the best basket on
 * every goal (budget, nutrition, diet, favorites, breakfast / lunch / dinner).
 * Not trade-off modes. The receipt is the QA account's real one
 * (tests/fixtures/qaRound5State.json); the catalog pool is fixed (no network).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { buildBasket, buildBasketAlternatives, basketDifference, MIN_BASKET_DIFFERENCE, BASKET_EXHAUSTED_MESSAGE } from "@/lib/basketBuilder";
import { selectCandidates, passesHardFilters } from "@/lib/smartBasketEngine";
import { itemGroup, itemPer100g, profileConflict, isFavorite, basketSufficiency } from "@/lib/basketAlternatives";
import { generateNutritionPlan } from "@/lib/nutritionPlanGenerator";
import { validateMenu } from "@/lib/validateMenu";
import { planMissingMeals } from "@/lib/flowData";
import { classifyProduct } from "@/lib/mealPlanRules";
import { basketBudget } from "@/lib/pricing";
import { ITEMS as I } from "./fixtures/baskets";
import STATE from "./fixtures/qaRound5State.json";

const PROFILE = STATE.profile;
const WEEKLY = 420;
const POOL_ITEMS = [I.chicken, I.turkey, I.beef, I.tuna, I.eggs, I.lentils, I.chickpeas, I.tofu, I.cottage, I.yogurt, I.rice, I.pasta,
  I.bread, I.oats, I.potato, I.cucumber, I.pepper, I.carrot, I.lettuce, I.banana, I.apple, I.orange, I.oil, I.tahini, I.almonds];
const poolOf = items => items.map(item => { const group = itemGroup(item); return { item, group, per100: itemPer100g(item, group), pricePer100: item.price_per_kg / 10, source: "catalog" }; });
// the engine on a fixed pool, with the profile's hard filters — diet, allergies, dislikes (as catalogPool applies them)
const additionsFrom = pool => async ({ basket, profile, budgetLeft, hasReceipt, avoid }) =>
  selectCandidates(pool.filter(e => passesHardFilters(e.item, profile)), basket, { budgetLeft, hasReceipt, favorites: profile?.favorite_foods || [], avoid });
const receiptItems = STATE.basket.filter(i => i.from_receipt).map((i, k) => ({
  id: `r${k}`, original_name: i.name, normalized_name: i.name, category: i.category, is_food: true, is_approved_for_menu: true,
  quantity: i.quantity, price: i.estimated_price, matched_product_name: i.name, catalog_match_status: "matched",
}));
const args = (over = {}) => ({ receiptItems, history: [], profile: PROFILE, weeklyBudget: WEEKLY, additions: additionsFrom(poolOf(POOL_ITEMS)), staples: async () => [], ...over });

/** Every alternative, by clicking "בחירה מחדש" until it wraps around. */
async function walk(a) {
  const first = await buildBasketAlternatives(a);
  const seen = [first];
  let prev = first;
  for (let k = 1; k <= first.alternative.of; k++) {
    prev = await buildBasketAlternatives({ ...a, previous: prev.items });
    seen.push(prev);
    if (prev.alternative.exhausted || prev.alternative.wrapped) break;
  }
  return seen;
}

describe("basket alternatives on the QA receipt", () => {
  let seen;
  beforeAll(async () => { seen = await walk(args()); }, 120000);
  const all = () => seen.slice(0, seen[0].alternative.of);

  it("1. the first build is the best basket, deterministically", async () => {
    const best = await buildBasket(args());
    expect(seen[0].items.map(i => i.name)).toEqual(best.items.map(i => i.name));
    expect(seen[0].alternative).toMatchObject({ index: 0, exhausted: false });
    expect((await buildBasketAlternatives(args())).items.map(i => i.name)).toEqual(best.items.map(i => i.name));
  });

  it("2. each click returns a meaningfully different basket, in order, then wraps to the first", () => {
    const n = seen[0].alternative.of;
    expect(n).toBeGreaterThanOrEqual(2);
    expect(seen.map(r => r.alternative.index)).toEqual([...Array(n).keys(), 0]);
    for (let k = 1; k < seen.length; k++) expect(basketDifference(seen[k - 1].items, seen[k].items), `click ${k}`).toBeGreaterThanOrEqual(MIN_BASKET_DIFFERENCE);
    expect(seen.at(-1).alternative.wrapped).toBe(true);
    expect(seen.at(-1).items).toEqual(seen[0].items);
  });

  it("the receipt products stay in every alternative; what changes is the smart additions", () => {
    const receiptNames = seen[0].items.filter(i => i.from_receipt).map(i => i.name).sort();
    for (const r of all()) expect(r.items.filter(i => i.from_receipt).map(i => i.name).sort()).toEqual(receiptNames);
  });

  // (this pool has no protein completion from the live catalog — missingStaples — so even
  // the best basket is short of the 179 g protein target here; the rule is "never worse than the best")
  it("3. every alternative gives a complete weekly menu (breakfast, lunch, dinner every day), no worse than the best basket's", async () => {
    const levels = [];
    for (const r of all()) {
      const list = { items: r.items };
      const budget = basketBudget(PROFILE, list);
      const plan = await generateNutritionPlan({ list, profile: PROFILE, budget });
      expect(planMissingMeals(plan), `alternative ${r.alternative.index + 1}`).toEqual([]);
      levels.push(validateMenu({ plan, basketItems: r.items, profile: PROFILE, budget }).level);
    }
    expect(levels[0]).toBeLessThan(4);
    for (const l of levels) expect(l).toBeLessThanOrEqual(levels[0]);
  }, 120000);

  it("5. every alternative is within the weekly budget, with no nutrition gap the best basket does not have", () => {
    const bestGaps = basketSufficiency(seen[0].items, PROFILE).issues.map(i => i.key);
    for (const r of all()) {
      expect(r.total).toBeLessThanOrEqual(WEEKLY);
      expect(basketSufficiency(r.items, PROFILE).issues.map(i => i.key).filter(k => !bestGaps.includes(k))).toEqual([]);
    }
  });

  it("not a trade-off: the user's favorite foods in the best basket are in every alternative", () => {
    const favs = items => PROFILE.favorite_foods.filter(f => items.some(i => isFavorite(i.name, [f])));
    expect(favs(seen[0].items).length).toBeGreaterThan(0);
    for (const r of all()) expect(favs(r.items)).toEqual(favs(seen[0].items));
  });
});

describe("4. every alternative respects diet, allergies and dislikes", () => {
  it.each([
    ["vegetarian", { dietary_preferences: ["צמחוני"], favorite_foods: [] }, g => !["meat", "fish"].includes(g)],
    ["egg allergy, dislikes yogurt", { allergies: ["ביצים"], disliked_foods: ["יוגורט"] }, (g, name) => g !== "eggs" && !/יוגורט/.test(name)],
  ])("%s", async (_, over, allowed) => {
    const profile = { ...PROFILE, ...over };
    const seen = await walk(args({ profile }));
    for (const r of seen) for (const i of r.items.filter(x => !x.from_receipt)) {
      expect(allowed(classifyProduct(i.name, i.category), i.name), `${i.name} (alternative ${r.alternative.index + 1})`).toBe(true);
      expect(profileConflict(i, profile)).toBeNull();
    }
  }, 120000);
});

describe("6. no other basket meets every goal", () => {
  it("rebuild says so (exhausted) instead of returning the same basket as new", async () => {
    // a pool with exactly what the week needs: nothing to vary
    const a = args({ additions: additionsFrom(poolOf([I.chicken, I.eggs, I.oil, I.banana, I.orange])) });
    const first = await buildBasketAlternatives(a);
    expect(first.alternative.of).toBe(1);
    const again = await buildBasketAlternatives({ ...a, previous: first.items });
    expect(again.alternative.exhausted).toBe(true);
    expect(BASKET_EXHAUSTED_MESSAGE).toBe("לא נמצא סל חלופי שונה מספיק שעומד בכל היעדים. אפשר להחליף או להוסיף מוצרים ידנית.");
  });

  it("a basket the user changed by hand is not \"the same\": rebuild starts from the best basket", async () => {
    const first = await buildBasketAlternatives(args());
    const edited = first.items.filter(i => i.from_receipt);
    const r = await buildBasketAlternatives({ ...args(), previous: edited });
    expect(r.alternative.index).toBe(0);
    expect(r.alternative.exhausted).toBe(false);
  });
});
