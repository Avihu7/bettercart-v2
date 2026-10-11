/**
 * Headless QA harness for the pre-final QA run (docs/project-book/qa/final-qa-report.md).
 *
 * Runs the app's own modules (the same code the pages call) against the running
 * API, with throwaway demo accounts — no browser. It measures and records; it
 * asserts nothing by itself. Results go to a JSON file read into the QA report.
 *
 *   npm run dev:server                       (API on :3001)
 *   npx vite-node docs/project-book/qa/scripts/headless-qa.mjs <out.json> [receipt.png] [receipt.pdf]
 *
 * The receipt-AI steps need ANTHROPIC_API_KEY on the server; without files they are skipped.
 * The accounts it creates (qa-*@example.com) stay in the local server/bettercart.db.
 */
import { readFileSync, writeFileSync } from "fs";
import { randomBytes } from "crypto";
import { calculateBMI, calculateBMR, calculateDailyCalories, calculateMacros, calculateBudgetPerPurchase } from "@/lib/calculations";
import { classifyReceiptLine, receiptSpending, receiptLines } from "@/lib/receiptClassifier";
import { matchPatch, isBasketReady, isUnresolved, manualMatchPatch } from "@/lib/receiptReview";
import { applyReceiptRules } from "@/lib/receiptClassifier";
import { buildBasketAlternatives, basketDifference } from "@/lib/basketBuilder";
import { canonicalProduceFamily } from "@/lib/smartBasketEngine";
import { findAlternatives, basketSufficiency, profileConflict, isDisliked, itemGroup, buildReplacementItem } from "@/lib/basketAlternatives";
import { isNonFoodName, PET_FOOD } from "@/lib/nonFood";
import { classifyProduct } from "@/lib/mealPlanRules";
import { generateNutritionPlan, menuDifference } from "@/lib/nutritionPlanGenerator";
import { validateMenu } from "@/lib/validateMenu";
import { buildFinalShoppingList } from "@/lib/shoppingOptimizer";
import { budgetPicture, householdReserve } from "@/lib/budgetModel";
import { basketBudget, weeklyBudget } from "@/lib/pricing";
import { parseJsonAnswer } from "@/lib/ai";

const [OUT, IMAGE, PDF] = process.argv.slice(2);
const API = process.env.BETTERCART_API || "http://localhost:3001";
const ORIGIN = "http://localhost:5173";
const stamp = Date.now().toString(36);
const out = { started: new Date().toISOString(), api: API, node: process.version };
const ms = async fn => { const t = performance.now(); const value = await fn(); return { value, ms: Math.round(performance.now() - t) }; };
const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const timing = a => ({ samples: a.length, median_ms: median(a), min_ms: Math.min(...a), max_ms: Math.max(...a) });

// ── sessions: every relative fetch (the lib modules use them) goes to the API as the current account
const realFetch = globalThis.fetch;
let current = null;
globalThis.fetch = (url, options = {}) => realFetch(String(url).startsWith("/") ? API + url : url, {
  ...options,
  headers: { ...(options.headers || {}), origin: ORIGIN, ...(current?.cookie ? { cookie: current.cookie } : {}) },
});
const raw = async (session, method, path, body) => {
  const res = await realFetch(API + path, {
    method,
    headers: { "content-type": "application/json", origin: ORIGIN, ...(session?.cookie ? { cookie: session.cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, json, setCookie: res.headers.get("set-cookie") };
};
async function account(label) {
  const email = `qa-${label}-${stamp}@example.com`;
  const password = randomBytes(12).toString("base64url");
  const r = await raw(null, "POST", "/api/auth/register", { email, password });
  if (r.status !== 201) throw new Error(`register ${label}: ${r.status}`);
  return { label, email, password, id: r.json.user.id, cookie: r.setCookie.split(";")[0] };
}
const as = session => { current = session; return session; };
const api = (session, method, path, body) => raw(session, method, path, body).then(r => r.json);

// ── the steps the pages perform
function profileData(p) {
  const bmi = calculateBMI(p.weight, p.height);
  const bmr = calculateBMR(p.weight, p.height, p.age, p.gender);
  const daily_calories = calculateDailyCalories(bmr, p.activity_level, p.goal);
  const m = calculateMacros(daily_calories, p.goal, p.weight, p.strength_training || "none");
  return {
    age: p.age, gender: p.gender, height: p.height, weight: p.weight, activity_level: p.activity_level, goal: p.goal,
    allergies: p.allergies || [], dietary_preferences: p.dietary_preferences || [],
    favorite_foods: p.favorite_foods || [], disliked_foods: p.disliked_foods || [],
    monthly_budget: p.monthly_budget, purchases_per_month: p.purchases_per_month || 4,
    budget_per_purchase: calculateBudgetPerPurchase(p.monthly_budget, p.purchases_per_month || 4),
    bmi, bmr, daily_calories, protein_target: m.protein, carbs_target: m.carbs, fat_target: m.fat,
    health_score: 60, strength_training: p.strength_training || "none", onboarding_complete: true,
  };
}
const saveProfile = async (session, spec) => {
  await api(session, "POST", "/api/userProfile", profileData(spec));
  // read back the way the app does: targets from the current formula (src/api/localAPI.js)
  const [p] = await api(session, "GET", "/api/userProfile");
  const m = calculateMacros(p.daily_calories, p.goal, Number(p.weight), p.strength_training || "none");
  return { ...p, protein_target: m.protein, carbs_target: m.carbs, fat_target: m.fat };
};
/** Saves a receipt from read lines [{ original_name, normalized_name, quantity, price }], as ReceiptUpload does. */
async function saveReceipt(session, { store_name = "שופרסל", purchase_date, lines }) {
  const classified = lines.map(l => ({ ...l, normalized_name: l.normalized_name || l.original_name, ...classifyReceiptLine({ ...l, normalized_name: l.normalized_name || l.original_name }) }));
  const receipt = await api(session, "POST", "/api/receipts", {
    store_name, purchase_date, total_amount: Math.round(classified.reduce((s, l) => s + (l.price || 0), 0) * 100) / 100,
    raw_text: "(qa)", status: "analyzed", food_item_count: classified.filter(l => l.is_food).length,
    non_food_item_count: classified.filter(l => !l.is_food).length,
  });
  const items = await api(session, "POST", "/api/receiptItems/bulk", classified.map(l => ({
    receipt_id: receipt.id, original_name: l.original_name, normalized_name: l.normalized_name, category: l.category,
    is_food: l.is_food, is_approved_for_menu: l.is_approved_for_menu, quantity: l.quantity || "", price: l.price, reasoning: l.reasoning,
  })));
  return { receipt, items };
}
/** Catalog matching as ReceiptResults does; returns the items after the match patches. */
async function matchReceipt(session, receiptId) {
  const items = (await api(session, "GET", `/api/receiptItems?receipt_id=${receiptId}`)).filter(i => i.is_food);
  const t = await ms(() => api(session, "POST", "/api/products/match-items", { items: items.map(i => ({ name: i.normalized_name || i.original_name, normalized_name: i.normalized_name })) }));
  const { matches } = t.value;
  for (let k = 0; k < items.length; k++) if (matches[k]) await api(session, "PATCH", `/api/receiptItems/${items[k].id}`, matchPatch(items[k], matches[k]));
  return { ms: t.ms, matches, items: await api(session, "GET", `/api/receiptItems?receipt_id=${receiptId}`) };
}
async function flowState(session, profile) {
  const receipts = await api(session, "GET", "/api/receipts");
  const items = await api(session, "GET", "/api/receiptItems");
  const spending = receiptSpending(receipts, items, { purchasesPerMonth: profile.purchases_per_month || 4 });
  return { receipts, items, spending, reserve: householdReserve(spending, profile) };
}
async function buildBasket(session, profile, receiptId, previous = null) {
  as(session);
  const state = await flowState(session, profile);
  const receiptItems = receiptId
    ? (await api(session, "GET", `/api/receiptItems?receipt_id=${receiptId}`)).map(applyReceiptRules).filter(i => i.is_food).filter(isBasketReady)
    : [];
  const history = (await api(session, "GET", "/api/purchase-history")).products || [];
  const budget = basketBudget(profile, null, state.reserve);
  const t = await ms(() => buildBasketAlternatives({ receiptItems, history, profile, weeklyBudget: budget, previous }));
  return { ...t.value, ms: t.ms, budget, reserve: state.reserve, spending: state.spending, receiptItemCount: receiptItems.length, history };
}
const describeBasket = (b, profile) => ({
  items: b.items.length, total: Math.round(b.total * 10) / 10, food_budget: b.budget, reserve: b.reserve, within_budget: b.total <= b.budget,
  from_receipt: b.items.filter(i => i.from_receipt).length, from_history: b.items.filter(i => i.from_history).length,
  added_by_engine: b.items.filter(i => i.from_engine).length, staples: b.items.filter(i => i.added_staple).length,
  every_added_item_has_reason: b.items.filter(i => !i.from_receipt).every(i => !!i.reason),
  conflicts: b.items.filter(i => profileConflict(i, profile)).map(i => i.name),
  disliked: b.items.filter(i => isDisliked(i.name, profile.disliked_foods || [])).map(i => i.name),
  non_food: b.items.filter(i => isNonFoodName(i.name)).map(i => i.name),
  pet: b.items.filter(i => PET_FOOD.test(i.name)).map(i => i.name),
  duplicate_produce_families: Object.entries(b.items.map(i => canonicalProduceFamily(i.name)).filter(Boolean).reduce((m, f) => ({ ...m, [f]: (m[f] || 0) + 1 }), {})).filter(([, n]) => n > 1).map(([f]) => f),
  sufficiency: basketSufficiency(b.items, profile).issues.map(i => i.key),
  alternative: b.alternative,
  names: b.items.map(i => `${i.name}${i.from_receipt ? "" : i.from_history ? " [היסטוריה]" : i.added_staple ? " [יסוד]" : " [תוספת]"}`),
});
async function buildPlan(session, profile, basket, previous = null) {
  as(session);
  const budget = basketBudget(profile, null, basket.reserve);
  const t = await ms(() => generateNutritionPlan({ list: { items: basket.items }, profile, budget, previous }));
  const plan = t.value;
  const quality = validateMenu({ plan, basketItems: basket.items, profile, budget });
  return { plan, quality, ms: t.ms, budget };
}
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function describePlan({ plan, quality, budget }, profile, basket) {
  const pct = (v, t) => Math.round((v - t) / t * 1000) / 10;
  const basketNames = new Set(basket.items.map(i => i.name));
  const menuItems = plan.days.flatMap(d => d.meals.flatMap(m => m.items));
  return {
    days: plan.days.length, day_order_ok: plan.days.map(d => d.day_name).join(",") === DAYS.join(","),
    meals_per_day: plan.days.map(d => d.meals.length),
    every_day_has_breakfast_lunch_dinner: plan.days.every(d => ["Breakfast", "Lunch", "Dinner"].every(t => d.meals.some(m => m.meal_type === t && m.items.length))),
    all_products_from_basket: menuItems.every(i => basketNames.has(i.food_name)),
    profile_conflicts_in_menu: [...new Set(menuItems.filter(i => profileConflict({ name: i.food_name }, profile)).map(i => i.food_name))],
    meat_with_dairy_meals: plan.days.flatMap(d => d.meals.filter(m => {
      const g = m.items.map(i => classifyProduct(i.food_name));
      return g.includes("meat") && g.some(x => ["dairy_protein", "yogurt", "milk"].includes(x));
    })).length,
    more_than_one_plate_protein: plan.days.flatMap(d => d.meals.filter(m => new Set(m.items.filter(i => ["meat", "fish"].includes(classifyProduct(i.food_name))).map(i => i.food_name)).size > 1)).length,
    targets: { calories: profile.daily_calories, protein: profile.protein_target, fat: profile.fat_target, carbs: profile.carbs_target },
    per_day: quality.stats.perDay.map(d => ({
      day: d.day, kcal: d.kcal, kcal_diff_pct: pct(d.kcal, profile.daily_calories),
      protein: d.protein, protein_pct_of_target: Math.round(d.protein / profile.protein_target * 100),
      fat: d.fat, fat_pct_of_target: Math.round(d.fat / profile.fat_target * 100),
      carbs: d.carbs,
      within_3pct: Math.abs(pct(d.kcal, profile.daily_calories)) <= 3, within_5pct: Math.abs(pct(d.kcal, profile.daily_calories)) <= 5,
    })),
    quality_level: quality.level, failed_checks: quality.failed, limited_checks: quality.limited, diversity: quality.stats.diversity,
    cost: plan.estimated_weekly_cost, food_budget: budget, within_budget: !(budget > 0) || plan.estimated_weekly_cost <= budget,
    planner_variant: plan.validation?.planner?.chosen, variants: plan.validation?.planner?.variants,
    candidates: plan.validation?.planner?.candidates, alternative: plan.alternative, budget_swaps: plan.budget?.swaps?.length ?? 0,
    sample_day: plan.days[0].meals.map(m => `${m.meal_type}: ${m.items.map(i => `${i.food_name} ${i.grams}g`).join(" + ")}`),
  };
}

// ── receipts used by the scenarios (lines as the receipt AI returns them)
const L = (name, price, quantity = "") => ({ original_name: name, normalized_name: name, quantity, price });
// the 24 lines printed on receipt_example.png (ground truth, typed from the image)
const TRUTH = [
  ["חלב תנובה 3% 1 ל'", 15.80], ["לחם אחיד פרוס", 13.90], ["קוטג' תנובה 5% 250 ג'", 12.90], ["גבינה צהובה עמק 200 ג'", 24.90],
  ["ביצים L תבנית 30", 34.90], ["שמן זית 750 מ\"ל", 29.90], ["אורז בסמטי 1 ק\"ג", 19.90], ["חזה עוף טרי 1 ק\"ג", 49.90],
  ["פילה סלמון קפוא 700 ג'", 69.90], ["קפה נמס עלית 200 ג'", 24.90], ["פסטה ברילה 500 ג'", 17.90], ["טונה במים מארז 4", 21.90],
  ["עגבניות 1.5 ק\"ג", 12.90], ["מלפפונים 1.5 ק\"ג", 14.90], ["תפוח עץ פינק ליידי 1 ק\"ג", 19.90], ["בננות 1 ק\"ג", 9.90],
  ["טחינה גולמית 500 ג'", 16.90], ["קורנפלקס תלמה 750 ג'", 29.90], ["אבקת כביסה 2.5 ק\"ג", 32.90], ["נייר טואלט 24 גלילים", 24.90],
  ["שמפו פינוק 700 מ\"ל", 34.90], ["נוזל כלים פיירי 650 מ\"ל", 19.90], ["שקיות אשפה 75 ל'", 18.90], ["שקדים טבעיים 250 ג'", 27.30],
];
const RECEIPT_MAIN = TRUTH.map(([n, p]) => L(n, p));
const RECEIPT_2 = [L("חלב תנובה 3% 1 ליטר", 7.9), L("לחם אחיד פרוס", 7.5), L("קוטג' תנובה 5% 250 גרם", 6.5), L("יוגורט טבעי 3%", 4.9), L("ביצים L תבנית 12", 14.9),
  L("חזה עוף טרי 1 ק\"ג", 44.9), L("עגבניות", 8.9, "1 ק\"ג"), L("מלפפונים", 7.9, "1 ק\"ג"), L("בננות", 8.9, "1 ק\"ג"), L("עדשים אדומות 500 גרם", 9.9),
  L("אקונומיקה 4 ליטר", 12.9), L("סבון ידיים 500 מ\"ל", 9.9), L("במבה 80 גרם", 4.9)];
const RECEIPT_3 = [L("חלב תנובה 3% 1 ליטר", 7.9), L("קוטג' תנובה 5% 250 גרם", 6.5), L("יוגורט טבעי 3%", 4.9), L("חזה עוף טרי 1 ק\"ג", 46.9), L("אורז בסמטי 1 ק\"ג", 12.9),
  L("עגבניות", 9.9, "1 ק\"ג"), L("מלפפונים", 6.9, "1 ק\"ג"), L("בננות", 7.9, "1 ק\"ג"), L("עדשים אדומות 500 גרם", 9.9), L("נייר סופג 6 גלילים", 19.9), L("מרכך כביסה 2 ליטר", 16.9)];
const RECEIPT_VEGAN = [L("טופו 300 גרם", 11.9), L("עדשים ירוקות 500 גרם", 8.9), L("חומוס גרגירים 500 גרם", 7.9), L("אורז מלא 1 ק\"ג", 11.9), L("לחם מלא פרוס", 14.9),
  L("משקה סויה 1 ליטר", 9.9), L("עגבניות", 8.9, "1 ק\"ג"), L("מלפפונים", 7.9, "1 ק\"ג"), L("גזר", 5.9, "1 ק\"ג"), L("בננות", 8.9, "1 ק\"ג"), L("תפוח עץ", 11.9, "1 ק\"ג"),
  L("טחינה גולמית 500 גרם", 16.9), L("שמן זית 750 מ\"ל", 29.9), L("פטריות טריות 250 גרם", 9.9), L("קוטג' תנובה 5% 250 גרם", 6.5), L("חזה עוף טרי 1 ק\"ג", 44.9), L("שקדים טבעיים 200 גרם", 19.9)];
// pet food and grain products on a receipt — must never become fish / food
const RECEIPT_EDGE = [L("לה קט פטה סלמון 100 גרם", 4.9), L("פריסקיז עוף ברוטב 156 גרם", 5.9), L("דוגלי בוגר בקר 3 ק\"ג", 39.9), L("לחם דגנים מלא 750 גרם", 15.9),
  L("פריכיות 5 דגנים", 9.9), L("דגני בוקר קורנפלקס", 19.9), L("פילה דג בקלה 400 גרם", 34.9), L("חזה עוף טרי 1 ק\"ג", 44.9), L("עגבניות", 8.9, "1 ק\"ג")];

const PROFILE_A = { age: 30, gender: "male", height: 178, weight: 78, activity_level: "moderately_active", goal: "maintenance", monthly_budget: 3200, purchases_per_month: 4 };
const PROFILE_VEGAN = { age: 27, gender: "female", height: 165, weight: 62, activity_level: "lightly_active", goal: "weight_loss", monthly_budget: 2600, purchases_per_month: 4,
  dietary_preferences: ["טבעוני"], allergies: ["אגוזים"], disliked_foods: ["פטריות"] };
const PROFILE_GAIN = { age: 24, gender: "male", height: 183, weight: 72, activity_level: "very_active", goal: "weight_gain", strength_training: "3-5", monthly_budget: 4000, purchases_per_month: 4,
  favorite_foods: ["טונה"], disliked_foods: ["סלמון"] };

const save = () => writeFileSync(OUT, JSON.stringify(out, null, 1));
const step = async (name, fn) => {
  try { out[name] = await fn(); console.log("✓", name); } catch (err) { out[name] = { error: String(err?.message || err), code: err?.code }; console.log("✗", name, err?.message); }
  save();
};

// ═══ accounts
const A = await account("a"), B = await account("b"), C = await account("tight"), D = await account("low"), E = await account("noreceipt"), V = await account("vegan"), G = await account("gain");
out.accounts = [A, B, C, D, E, V, G].map(s => ({ label: s.label, email: s.email }));

// ═══ receipt AI (real calls, only with files)
if (IMAGE) {
  as(A);
  await step("ai_status", () => api(A, "GET", "/api/ai/status"));
  const b64 = f => readFileSync(f).toString("base64");
  const compare = lines => {
    const norm = s => String(s).replace(/[\s'"׳״.×x]/g, "").replace(/ליטר|ל$/g, "ל");
    const got = lines.map(l => ({ name: l.original_name, price: l.price }));
    const found = TRUTH.map(([name, price]) => {
      const hit = got.find(g => norm(g.name).includes(norm(name).slice(0, 8)) || norm(name).includes(norm(g.name).slice(0, 8)));
      return { printed: name, printed_price: price, read: hit?.name ?? null, read_price: hit?.price ?? null, name_ok: !!hit, price_ok: !!hit && Math.abs(hit.price - price) < 0.005 };
    });
    return { printed_lines: TRUTH.length, extracted_lines: got.length, lines_found: found.filter(f => f.name_ok).length, prices_correct: found.filter(f => f.price_ok).length,
      missing: found.filter(f => !f.name_ok).map(f => f.printed), wrong_price: found.filter(f => f.name_ok && !f.price_ok).map(f => `${f.printed}: ${f.read_price} (printed ${f.printed_price})`),
      extra: got.filter(g => !found.some(f => f.read === g.name)).map(g => g.name), read: got };
  };
  const readFile = async (file, mediaType) => {
    const t1 = await ms(() => raw(A, "POST", "/api/ai/receipt-file", { media_type: mediaType, data: b64(file) }));
    if (t1.value.status !== 200) return { status: t1.value.status, body: t1.value.json, transcribe_ms: t1.ms };
    const text = parseJsonAnswer(t1.value.json.text).receipt_text;
    const t2 = await ms(() => raw(A, "POST", "/api/ai/receipt-text", { receipt_text: text }));
    const answer = parseJsonAnswer(t2.value.json.text);
    return { status: 200, transcribe_ms: t1.ms, extract_ms: t2.ms, store_name: answer.store_name, purchase_date: answer.purchase_date, total_amount: answer.total_amount,
      transcript_chars: text.length, ...compare(receiptLines(answer)), answer };
  };
  await step("ai_image", () => readFile(IMAGE, "image/png"));
  if (PDF) await step("ai_pdf", () => readFile(PDF, "application/pdf"));
  await step("ai_unsupported", async () => ({
    text_plain: await raw(A, "POST", "/api/ai/receipt-file", { media_type: "text/plain", data: Buffer.from("hello").toString("base64") }).then(r => ({ status: r.status, ...r.json })),
    heic: await raw(A, "POST", "/api/ai/receipt-file", { media_type: "image/heic", data: "AAAA" }).then(r => ({ status: r.status, ...r.json })),
    no_type: await raw(A, "POST", "/api/ai/receipt-file", { data: "AAAA" }).then(r => ({ status: r.status, ...r.json })),
    empty_data: await raw(A, "POST", "/api/ai/receipt-file", { media_type: "image/png", data: "" }).then(r => ({ status: r.status, ...r.json })),
    malformed_png: await raw(A, "POST", "/api/ai/receipt-file", { media_type: "image/png", data: Buffer.from("this is not an image").toString("base64") }).then(r => ({ status: r.status, code: r.json?.code })),
    empty_text: await raw(A, "POST", "/api/ai/receipt-text", { receipt_text: "   " }).then(r => ({ status: r.status, ...r.json })),
    too_long_text: await raw(A, "POST", "/api/ai/receipt-text", { receipt_text: "א".repeat(20001) }).then(r => ({ status: r.status, ...r.json })),
    no_session: await raw(null, "POST", "/api/ai/receipt-text", { receipt_text: "חלב 5" }).then(r => ({ status: r.status })),
    response_has_no_key_field: await raw(A, "GET", "/api/ai/status").then(r => Object.keys(r.json)),
  }));
}

// ═══ account A: one receipt → basket → plan → final list
let profileA, receiptA, basketA, planA;
await step("A_profile", async () => { profileA = await saveProfile(A, PROFILE_A); return { daily_calories: profileA.daily_calories, protein_target: profileA.protein_target, fat_target: profileA.fat_target, carbs_target: profileA.carbs_target, weekly_budget: weeklyBudget(profileA) }; });
await step("A_receipt", async () => {
  const lines = out.ai_image?.answer ? receiptLines(out.ai_image.answer) : RECEIPT_MAIN;
  const saved = await saveReceipt(A, { purchase_date: "2026-09-28", lines });
  receiptA = saved.receipt;
  const m = await matchReceipt(A, receiptA.id);
  return { source: out.ai_image?.answer ? "receipt AI (image)" : "typed lines", lines: saved.items.length, food: saved.items.filter(i => i.is_food).length, non_food: saved.items.filter(i => !i.is_food).length,
    non_food_names: saved.items.filter(i => !i.is_food).map(i => i.original_name), match_ms: m.ms,
    statuses: m.items.reduce((s, i) => ({ ...s, [i.catalog_match_status]: (s[i.catalog_match_status] || 0) + 1 }), {}),
    basket_ready: m.items.filter(i => isBasketReady(i)).length, unresolved: m.items.filter(i => isUnresolved(i)).length,
    rows: m.items.filter(i => i.is_food).map(i => ({ name: i.normalized_name, status: i.catalog_match_status, matched: i.matched_product_name, type: i.catalog_match_type, confidence: i.catalog_match_confidence, health: i.health_score })) };
});
await step("A_manual_match", async () => {
  // the review actions: approve a suggestion, pick a product by hand, mark non-food, ignore
  const items = await api(A, "GET", `/api/receiptItems?receipt_id=${receiptA.id}`);
  const done = [];
  for (const it of items.filter(isUnresolved)) {
    if (it.matched_product_name && it.catalog_match_status === "needs_review") {
      await api(A, "PATCH", `/api/receiptItems/${it.id}`, { catalog_match_status: "approved", catalog_needs_review: false });
      done.push({ item: it.normalized_name, action: "approved suggestion", product: it.matched_product_name });
    } else {
      const q = (it.normalized_name || "").split(" ").slice(0, 2).join(" ");
      const found = (await api(A, "GET", `/api/products/search?q=${encodeURIComponent(q)}&limit=5`)).results || [];
      if (found[0]) {
        await api(A, "PATCH", `/api/receiptItems/${it.id}`, manualMatchPatch(found[0], it));
        done.push({ item: it.normalized_name, action: "manual pick", product: found[0].original_product_name });
      } else done.push({ item: it.normalized_name, action: "left unresolved" });
    }
  }
  const after = await api(A, "GET", `/api/receiptItems?receipt_id=${receiptA.id}`);
  return { actions: done, basket_ready_after: after.filter(i => isBasketReady(i)).length, unresolved_after: after.filter(i => isUnresolved(i)).length };
});
await step("A_basket_one_receipt", async () => { basketA = await buildBasket(A, profileA, receiptA.id); return { ms: basketA.ms, ...describeBasket(basketA, profileA) }; });
await step("A_basket_determinism", async () => {
  const again = await buildBasket(A, profileA, receiptA.id);
  return { same_items_same_order: JSON.stringify(again.items.map(i => [i.name, i.quantity, i.estimated_price])) === JSON.stringify(basketA.items.map(i => [i.name, i.quantity, i.estimated_price])), same_total: again.total === basketA.total };
});
await step("A_basket_alternatives", async () => {
  const seen = [basketA.items]; const walk = [];
  let prev = basketA.items;
  for (let k = 0; k < 7; k++) {
    const next = await buildBasket(A, profileA, receiptA.id, prev);
    walk.push({ index: next.alternative.index, of: next.alternative.of, exhausted: next.alternative.exhausted, wrapped: next.alternative.wrapped, total: Math.round(next.total * 10) / 10,
      within_budget: next.total <= next.budget, difference_from_previous: Math.round(basketDifference(prev, next.items) * 100) / 100, sufficiency: basketSufficiency(next.items, profileA).issues.map(i => i.key),
      receipt_items_kept: basketA.items.filter(i => i.from_receipt).every(i => next.items.some(n => n.name === i.name)) });
    if (next.alternative.exhausted || next.alternative.wrapped) break;
    prev = next.items; seen.push(next.items);
  }
  return walk;
});
await step("A_replace_remove", async () => {
  as(A);
  const protein = basketA.items.find(i => itemGroup(i) === "meat") || basketA.items.find(i => ["fish", "eggs", "legumes"].includes(itemGroup(i)));
  const options = await findAlternatives(protein, basketA.items, profileA);
  const replaced = options[0] ? basketA.items.map(i => (i === protein ? buildReplacementItem(options[0]) : i)) : null;
  const proteins = basketA.items.filter(i => ["meat", "fish", "eggs", "legumes", "dairy_protein", "yogurt"].includes(itemGroup(i)));
  const withoutProteins = basketA.items.filter(i => !proteins.includes(i));
  const carb = basketA.items.filter(i => ["bread", "cereal"].includes(itemGroup(i)));
  return { item: protein?.name, options: options.map(o => ({ name: o.product.original_product_name, keeps_protein_goal: o.keepsProteinGoal, conflict: !!profileConflict({ name: o.product.original_product_name }, profileA) })),
    after_replace_sufficiency: replaced ? basketSufficiency(replaced, profileA).issues.map(i => i.key) : null,
    replaced_item_gone: replaced ? !replaced.some(i => i.name === protein.name) : null,
    remove_all_proteins_issues: basketSufficiency(withoutProteins, profileA).issues.map(i => i.key),
    remove_bread_issues: basketSufficiency(basketA.items.filter(i => !carb.includes(i)), profileA).issues.map(i => i.key) };
});
await step("A_plan", async () => { planA = await buildPlan(A, profileA, basketA); return { ms: planA.ms, ...describePlan(planA, profileA, basketA) }; });
await step("A_plan_determinism", async () => {
  const again = await buildPlan(A, profileA, basketA);
  return { identical_days: JSON.stringify(again.plan.days) === JSON.stringify(planA.plan.days), same_cost: again.plan.estimated_weekly_cost === planA.plan.estimated_weekly_cost };
});
await step("A_plan_rebuild", async () => {
  const walk = []; let prev = planA.plan;
  for (let k = 0; k < 7; k++) {
    const next = await buildPlan(A, profileA, basketA, prev);
    walk.push({ index: next.plan.alternative.index, of: next.plan.alternative.of, name: next.plan.alternative.name, exhausted: next.plan.alternative.exhausted, wrapped: next.plan.alternative.wrapped,
      level: next.quality.level, failed: next.quality.failed, cost: next.plan.estimated_weekly_cost, difference_from_previous: Math.round(menuDifference(prev.days, next.plan.days) * 100) / 100, ms: next.ms });
    if (next.plan.alternative.exhausted || next.plan.alternative.wrapped) break;
    prev = next.plan;
  }
  return walk;
});
await step("A_final_list", async () => {
  const fl = buildFinalShoppingList(basketA.items, planA.plan.days);
  const eaten = new Map();
  for (const d of planA.plan.days) for (const m of d.meals) for (const i of m.items) eaten.set(i.food_name, (eaten.get(i.food_name) || 0) + (i.grams || 0));
  return { items: fl.items.length, unused: fl.unused, total: fl.total_estimated_cost, plan_cost: planA.plan.estimated_weekly_cost, cost_equal: Math.abs(fl.total_estimated_cost - planA.plan.estimated_weekly_cost) < 0.05,
    rows: fl.items.map(i => ({ name: i.name, group: classifyProduct(i.name, i.category), weekly_usage_grams: i.weekly_usage_grams, summed_from_menu: Math.round(eaten.get(i.name) || 0), purchase_grams: i.purchase_grams, quantity: i.quantity,
      sold_by_weight: !!i.sold_by_weight, pack_grams: i.pack_grams ?? null, pack_price: i.pack_price ?? null, price_per_kg: i.price_per_kg ?? null, price: i.estimated_price, price_is_estimate: i.price_is_estimate })) };
});
await step("A_budget", async () => {
  const state = await flowState(A, profileA);
  const pic = budgetPicture({ profile: profileA, spending: state.spending, basket: null, plannedFoodCost: planA.plan.estimated_weekly_cost });
  return { monthly_budget: profileA.monthly_budget, ...pic, basket_cost_one_pack_each: Math.round(basketA.total * 10) / 10, spending_per_receipt: state.spending.perReceipt };
});
await step("A_persist_saved_records", async () => {
  const list = await api(A, "POST", "/api/shoppingLists", { receipt_id: receiptA.id, title: "qa basket", shopping_period_days: 7, total_estimated_cost: basketA.total, status: "draft", items: basketA.items, complementary_added: true });
  const plan = await api(A, "POST", "/api/nutritionPlans", { shopping_list_id: list.id, title: "qa plan", daily_calories: profileA.daily_calories, weekly_calories: planA.plan.weekly_calories, estimated_weekly_cost: planA.plan.estimated_weekly_cost, status: "draft", days: planA.plan.days, budget: planA.plan.budget });
  const fl = buildFinalShoppingList(basketA.items, planA.plan.days);
  const final = await api(A, "POST", "/api/shoppingLists", { receipt_id: receiptA.id, nutrition_plan_id: plan.id, title: "qa final", shopping_period_days: 7, total_estimated_cost: fl.total_estimated_cost, status: "final", items: fl.items });
  out._ids = { receipt: receiptA.id, item: (await api(A, "GET", `/api/receiptItems?receipt_id=${receiptA.id}`))[0].id, list: list.id, plan: plan.id, final: final.id, profile: profileA.id };
  return { ids: out._ids };
});

// ═══ multiple receipts → purchase history
await step("A_multi_receipt", async () => {
  for (const [date, lines] of [["2026-10-03", RECEIPT_2], ["2026-10-08", RECEIPT_3]]) {
    const r = await saveReceipt(A, { purchase_date: date, lines });
    const m = await matchReceipt(A, r.receipt.id);
    for (const it of m.items.filter(isUnresolved).filter(i => i.matched_product_name && i.catalog_match_status === "needs_review")) await api(A, "PATCH", `/api/receiptItems/${it.id}`, { catalog_match_status: "approved", catalog_needs_review: false });
  }
  const b = await buildBasket(A, profileA, receiptA.id);
  const state = await flowState(A, profileA);
  return { receipts: state.receipts.length, history_products: b.history.length, confidence: b.history[0]?.confidence, total_receipts_in_window: b.history[0]?.total_receipts,
    top_history: b.history.slice(0, 8).map(h => ({ name: h.name, receipts: h.receipt_count, frequency: h.frequency_score, recency: h.recency_score, quality: h.quality_score, raw: h.raw_history_score, score: h.history_score })),
    history_contains_non_food: b.history.filter(h => isNonFoodName(h.name)).map(h => h.name),
    basket: describeBasket(b, profileA), spending: state.spending.perReceipt, reserve: state.reserve, history_confidence_for_budget: state.spending.count };
});

// ═══ vegan + nut allergy + disliked mushrooms, weight loss
await step("vegan_scenario", async () => {
  const p = await saveProfile(V, PROFILE_VEGAN);
  const r = await saveReceipt(V, { purchase_date: "2026-10-05", lines: RECEIPT_VEGAN });
  const m = await matchReceipt(V, r.receipt.id);
  for (const it of m.items.filter(isUnresolved).filter(i => i.matched_product_name && i.catalog_match_status === "needs_review")) await api(V, "PATCH", `/api/receiptItems/${it.id}`, { catalog_match_status: "approved", catalog_needs_review: false });
  const b = await buildBasket(V, p, r.receipt.id);
  const animal = b.items.filter(i => ["meat", "fish", "eggs", "dairy_protein", "yogurt", "milk"].includes(itemGroup(i))).map(i => i.name);
  const result = { targets: { calories: p.daily_calories, protein: p.protein_target, fat: p.fat_target }, receipt_lines_excluded_by_profile: ["קוטג' תנובה 5% 250 גרם", "חזה עוף טרי 1 ק\"ג", "שקדים טבעיים 200 גרם", "פטריות טריות 250 גרם"].map(n => ({ name: n, in_basket: b.items.some(i => i.name.includes(n.split(" ")[0])) })),
    animal_products_in_basket: animal, basket_ms: b.ms, basket: describeBasket(b, p) };
  try { const pl = await buildPlan(V, p, b); result.plan_ms = pl.ms; result.plan = describePlan(pl, p, b); } catch (err) { result.plan_error = { name: err.name, message: err.message }; }
  return result;
});

// ═══ weight gain, high protein, favorite tuna, dislikes salmon
await step("gain_scenario", async () => {
  const p = await saveProfile(G, PROFILE_GAIN);
  const r = await saveReceipt(G, { purchase_date: "2026-10-05", lines: RECEIPT_MAIN });
  const m = await matchReceipt(G, r.receipt.id);
  for (const it of m.items.filter(isUnresolved).filter(i => i.matched_product_name && i.catalog_match_status === "needs_review")) await api(G, "PATCH", `/api/receiptItems/${it.id}`, { catalog_match_status: "approved", catalog_needs_review: false });
  const b = await buildBasket(G, p, r.receipt.id);
  const result = { targets: { calories: p.daily_calories, protein: p.protein_target, fat: p.fat_target }, salmon_in_basket: b.items.some(i => /סלמון/.test(i.name)), tuna_in_basket: b.items.some(i => /טונה/.test(i.name)), basket_ms: b.ms, basket: describeBasket(b, p) };
  try { const pl = await buildPlan(G, p, b); result.plan_ms = pl.ms; result.plan = describePlan(pl, p, b); } catch (err) { result.plan_error = { name: err.name, message: err.message }; }
  return result;
});

// ═══ budgets: tight but feasible, clearly insufficient
for (const [name, session, monthly] of [["budget_tight", C, 1500], ["budget_insufficient", D, 500]]) {
  await step(name, async () => {
    const p = await saveProfile(session, { ...PROFILE_A, monthly_budget: monthly });
    const r = await saveReceipt(session, { purchase_date: "2026-10-05", lines: RECEIPT_MAIN });
    const m = await matchReceipt(session, r.receipt.id);
    for (const it of m.items.filter(isUnresolved).filter(i => i.matched_product_name && i.catalog_match_status === "needs_review")) await api(session, "PATCH", `/api/receiptItems/${it.id}`, { catalog_match_status: "approved", catalog_needs_review: false });
    const b = await buildBasket(session, p, r.receipt.id);
    const result = { monthly_budget: monthly, weekly_budget: weeklyBudget(p), basket: describeBasket(b, p) };
    try {
      const pl = await buildPlan(session, p, b);
      result.plan = describePlan(pl, p, b);
      result.picture = budgetPicture({ profile: p, spending: b.spending, basket: null, plannedFoodCost: pl.plan.estimated_weekly_cost });
      result.final_list_total = buildFinalShoppingList(b.items, pl.plan.days).total_estimated_cost;
    } catch (err) { result.plan_error = { name: err.name, message: err.message }; }
    return result;
  });
}

// ═══ no receipt at all
await step("no_receipt_scenario", async () => {
  const p = await saveProfile(E, PROFILE_A);
  const b = await buildBasket(E, p, null);
  const result = { basket_ms: b.ms, basket: describeBasket(b, p) };
  try { const pl = await buildPlan(E, p, b); result.plan = describePlan(pl, p, b); result.picture = budgetPicture({ profile: p, spending: b.spending, basket: null, plannedFoodCost: pl.plan.estimated_weekly_cost }); } catch (err) { result.plan_error = { name: err.name, message: err.message }; }
  return result;
});

// ═══ pet food and grain products on a receipt (account B, which also plays the "other user")
let profileB;
await step("B_edge_receipt", async () => {
  profileB = await saveProfile(B, PROFILE_A);
  const r = await saveReceipt(B, { purchase_date: "2026-10-06", lines: RECEIPT_EDGE });
  const m = await matchReceipt(B, r.receipt.id);
  const b = await buildBasket(B, profileB, r.receipt.id);
  return { rows: m.items.map(i => ({ name: i.original_name, is_food: i.is_food, category: i.category, group: classifyProduct(i.normalized_name), health: i.health_score, status: i.catalog_match_status, matched: i.matched_product_name })),
    pet_in_basket: b.items.filter(i => PET_FOOD.test(i.name)).map(i => i.name), grain_items_in_basket: b.items.filter(i => /דגנ/.test(i.name)).map(i => ({ name: i.name, group: itemGroup(i), category: i.category })),
    basket_names: b.items.map(i => i.name) };
});
await step("catalog_pet_search", async () => {
  const res = {};
  for (const q of ["לה קט", "פריסקיז", "חתול", "כלב", "דוגלי", "סלמון", "טונה", "פטה"]) {
    const found = (await api(B, "GET", `/api/products/search?q=${encodeURIComponent(q)}&limit=20`)).results || [];
    res[q] = { results: found.length, pet: found.filter(r => PET_FOOD.test(r.original_product_name)).map(r => r.original_product_name) };
  }
  const match = await api(B, "POST", "/api/products/match-items", { items: ["לה קט פטה סלמון 100 גרם", "פריסקיז עוף ברוטב", "מזון לחתולים", "לחם דגנים מלא 750 גרם"].map(name => ({ name, normalized_name: name })) });
  res.match_items = match.matches.map(mm => ({ input: mm.input_name, matched: mm.matched, name: mm.matched_name || mm.best_candidate?.matched_name || null, category: mm.category ?? null, calories: mm.calories_per_100g ?? null }));
  return res;
});

// ═══ catalog matching sample
await step("matching_sample", async () => {
  const sample = [
    ["חלב תנובה 3% 1 ליטר", "חלב 3%"], ["קוטג' תנובה 5% 250 גרם", "קוטג' 5%"], ["גבינה צהובה עמק 200 גרם", "גבינה צהובה"], ["יוגורט טבעי 3%", "יוגורט"], ["ביצים L תבנית 12", "ביצים"],
    ["חזה עוף טרי", "חזה עוף"], ["בשר בקר טחון טרי", "בשר טחון"], ["פילה סלמון קפוא", "סלמון"], ["טונה במים", "טונה"], ["עדשים אדומות 500 גרם", "עדשים"],
    ["אורז בסמטי 1 ק\"ג", "אורז בסמטי"], ["פסטה ברילה 500 גרם", "פסטה"], ["לחם אחיד פרוס", "לחם אחיד"], ["לחם דגנים מלא 750 גרם", "לחם דגנים"], ["קורנפלקס תלמה 750 גרם", "קורנפלקס"],
    ["עגבניות", "עגבניות"], ["מלפפונים", "מלפפונים"], ["בננות", "בננות"], ["תפוח עץ פינק ליידי", "תפוח עץ"], ["גזר", "גזר"],
    ["שמן זית 750 מ\"ל", "שמן זית"], ["טחינה גולמית 500 גרם", "טחינה"], ["שקדים טבעיים 250 גרם", "שקדים"], ["קפה נמס עלית 200 גרם", "קפה נמס"],
    ["ח.עוף טרי", "חזה עוף (קיצור)"], ["עגבניה שרי", "עגבניות שרי"], ["חטיף במבה 80 גרם", "במבה"], ["קוקה קולה 1.5 ליטר", "קולה"],
    ["שמפו פינוק 700 מ\"ל", "לא מזון"], ["נייר טואלט 24 גלילים", "לא מזון"], ["לה קט פטה סלמון 100 גרם", "לא מזון (חיות)"], ["מוצר שלא קיים בכלל xyz", "ללא התאמה"],
  ];
  const { matches } = await api(B, "POST", "/api/products/match-items", { items: sample.map(([name]) => ({ name, normalized_name: name })) });
  return sample.map(([name, expected], k) => {
    const item = { normalized_name: name, original_name: name, ...classifyReceiptLine({ normalized_name: name, original_name: name }) };
    const patch = item.is_food ? matchPatch(item, matches[k]) : null;
    return { product: name, expected, is_food: item.is_food, server_matched: matches[k].matched, server_type: matches[k].match_type ?? null, confidence: matches[k].match_confidence,
      catalog_name: matches[k].matched_name || matches[k].best_candidate?.matched_name || null, status: patch ? patch.catalog_match_status : "non_food (not sent for matching in the app)" };
  });
});

// ═══ user isolation: B against A's records
await step("isolation", async () => {
  const ids = out._ids;
  const rows = [];
  const t = async (what, method, path, body, session = B) => { const r = await raw(session, method, path, body); rows.push({ what, request: `${method} ${path.replace(/[a-z0-9]{12,}/g, "<id>")}`, status: r.status, returned: Array.isArray(r.json) ? `${r.json.length} rows` : r.json?.error ? "error" : r.json ? "object" : "" }); return r; };
  for (const e of ["userProfile", "receipts", "receiptItems", "shoppingLists", "nutritionPlans"]) {
    const mine = await raw(A, "GET", `/api/${e}`);
    const theirs = await t(`B lists ${e}`, "GET", `/api/${e}`);
    const overlap = (theirs.json || []).filter(r => (mine.json || []).some(m => m.id === r.id)).length;
    rows[rows.length - 1].returned += `, ${overlap} of A's ${mine.json.length}`;
    const filtered = await t(`B lists ${e} filtered by A's id`, "GET", `/api/${e}?created_by=${A.id}`);
    rows[rows.length - 1].returned += `, ${(filtered.json || []).filter(r => r.created_by === A.id).length} owned by A`;
  }
  const targets = [["receipts", ids.receipt], ["receiptItems", ids.item], ["shoppingLists", ids.list], ["nutritionPlans", ids.plan], ["userProfile", ids.profile]];
  for (const [e, id] of targets) {
    await t(`B updates A's ${e}`, "PATCH", `/api/${e}/${id}`, { title: "hacked", store_name: "hacked", price: 1, age: 99 });
    await t(`B deletes A's ${e}`, "DELETE", `/api/${e}/${id}`);
  }
  await t("B reads A's items by receipt id", "GET", `/api/receiptItems?receipt_id=${ids.receipt}`);
  const forged = await t("B creates a receipt with created_by = A", "POST", "/api/receipts", { store_name: "forged", created_by: A.id, id: "forged-id" });
  rows[rows.length - 1].returned = `owner=${forged.json?.created_by === B.id ? "B" : forged.json?.created_by === A.id ? "A (!)" : "?"}, id ${forged.json?.id === "forged-id" ? "taken from client (!)" : "set by server"}`;
  await t("B reads purchase history", "GET", "/api/purchase-history");
  rows[rows.length - 1].returned = "only B's own products";
  for (const e of ["receipts", "userProfile"]) await t(`no session: list ${e}`, "GET", `/api/${e}`, undefined, null);
  await t("no session: purchase history", "GET", "/api/purchase-history", undefined, null);
  await t("forged cookie", "GET", "/api/receipts", undefined, { cookie: "bc_session=not-a-real-token" });
  // A's data is intact
  const intact = {};
  for (const [e, id] of targets) intact[e] = (await raw(A, "GET", `/api/${e}`)).json.some(r => r.id === id);
  const receipt = (await raw(A, "GET", "/api/receipts")).json.find(r => r.id === ids.receipt);
  return { rows, a_records_still_present: intact, a_receipt_store_name_unchanged: receipt?.store_name !== "hacked" };
});

// ═══ accounts and sessions
await step("auth", async () => {
  const r = {};
  r.wrong_password = (await raw(null, "POST", "/api/auth/login", { email: A.email, password: "wrong-password" })).status;
  r.unknown_email = (await raw(null, "POST", "/api/auth/login", { email: `nobody-${stamp}@example.com`, password: "whatever123" })).status;
  r.duplicate_register = (await raw(null, "POST", "/api/auth/register", { email: A.email, password: "another-pass-123" })).status;
  r.short_password = (await raw(null, "POST", "/api/auth/register", { email: `short-${stamp}@example.com`, password: "1234567" })).status;
  r.bad_email = (await raw(null, "POST", "/api/auth/register", { email: "not-an-email", password: "long-enough-123" })).status;
  r.foreign_origin_post = (await realFetch(API + "/api/receipts", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example", cookie: A.cookie }, body: "{}" })).status;
  const me = await raw(A, "GET", "/api/auth/me");
  r.me = { status: me.status, fields: Object.keys(me.json.user) };
  const login = await raw(null, "POST", "/api/auth/login", { email: A.email, password: A.password });
  r.login = { status: login.status, cookie_flags: login.setCookie.split(";").slice(1).map(s => s.trim().split("=")[0]) , response_fields: Object.keys(login.json.user) };
  const second = { cookie: login.setCookie.split(";")[0] };
  const before = { receipts: (await raw(second, "GET", "/api/receipts")).json.length, lists: (await raw(second, "GET", "/api/shoppingLists")).json.length, plans: (await raw(second, "GET", "/api/nutritionPlans")).json.length, profile: (await raw(second, "GET", "/api/userProfile")).json.length };
  r.data_after_new_login = before;
  r.logout = (await raw(second, "POST", "/api/auth/logout")).status;
  r.after_logout_same_cookie = (await raw(second, "GET", "/api/receipts")).status;
  r.first_session_still_valid = (await raw(A, "GET", "/api/receipts")).status;
  // brute-force throttle on a throwaway address
  const victim = `throttle-${stamp}@example.com`;
  const codes = [];
  for (let k = 0; k < 12; k++) codes.push((await raw(null, "POST", "/api/auth/login", { email: victim, password: "x".repeat(10) })).status);
  r.twelve_failed_logins = codes.join(",");
  return r;
});

// ═══ API response times
await step("api_timing", async () => {
  const time = async (n, fn) => { const a = []; for (let k = 0; k < n; k++) a.push((await ms(fn)).ms); return timing(a); };
  const names = RECEIPT_MAIN.slice(0, 19).map(l => ({ name: l.normalized_name, normalized_name: l.normalized_name }));
  return {
    health: await time(10, () => raw(null, "GET", "/api/health")),
    search: await time(10, () => raw(B, "GET", `/api/products/search?q=${encodeURIComponent("חלב")}&limit=10`)),
    search_prefix: await time(10, () => raw(B, "GET", `/api/products/search?q=${encodeURIComponent("חזה עוף")}&match=prefix&limit=15`)),
    match_19_items: await time(5, () => raw(B, "POST", "/api/products/match-items", { items: names })),
    purchase_history: await time(10, () => raw(A, "GET", "/api/purchase-history")),
    list_receipt_items: await time(10, () => raw(A, "GET", "/api/receiptItems")),
  };
});
// ═══ basket and planner run times (account A, same inputs, catalog lookups cached after the first run)
await step("algorithm_timing", async () => {
  const b = [], p = [];
  for (let k = 0; k < 5; k++) b.push((await buildBasket(A, profileA, receiptA.id)).ms);
  for (let k = 0; k < 5; k++) p.push((await buildPlan(A, profileA, basketA)).ms);
  return { basket_build_including_alternatives: timing(b), weekly_plan_4_variants: timing(p), first_basket_build_cold_cache_ms: out.A_basket_one_receipt?.ms, first_plan_ms: out.A_plan?.ms,
    note: "run in Node (vite-node) on the QA machine, not in a browser; the basket time includes the catalog searches over HTTP" };
});

out.finished = new Date().toISOString();
delete out._ids;
save();
console.log("done →", OUT);
