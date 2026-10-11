/**
 * Additional receipt verification run (qualitative evidence, not a benchmark).
 *
 * Sends one receipt file through the production pipeline exactly as the app does:
 *   POST /api/ai/receipt-file  -> transcription
 *   POST /api/ai/receipt-text  -> structured lines
 *   receiptLines / classifyReceiptLine (client rules) -> saved receipt + items
 *   POST /api/products/match-items + matchPatch (client acceptance rule)
 * Nothing is asserted; the raw outcome is written to a JSON file.
 *
 *   npm run server
 *   npx vite-node docs/project-book/qa/scripts/receipt2-qa.mjs <out.json> <receipt file> <media type>
 *
 * The throwaway account (qa-r2-*@example.com) stays in the local server/bettercart.db.
 */
import { readFileSync, writeFileSync } from "fs";
import { randomBytes } from "crypto";
import { classifyReceiptLine, receiptLines } from "@/lib/receiptClassifier";
import { matchPatch, isBasketReady } from "@/lib/receiptReview";
import { parseJsonAnswer } from "@/lib/ai";

const [OUT, FILE, MEDIA = "image/jpeg"] = process.argv.slice(2);
const API = process.env.BETTERCART_API || "http://localhost:3001";
const ORIGIN = "http://localhost:5173";
const raw = async (session, method, path, body) => {
  const res = await fetch(API + path, { method, headers: { "content-type": "application/json", origin: ORIGIN, ...(session?.cookie ? { cookie: session.cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, json, setCookie: res.headers.get("set-cookie") };
};
const timed = async fn => { const t = performance.now(); const value = await fn(); return { value, ms: Math.round(performance.now() - t) }; };

const reg = await raw(null, "POST", "/api/auth/register", { email: `qa-r2-${Date.now().toString(36)}@example.com`, password: randomBytes(12).toString("base64url") });
if (reg.status !== 201) throw new Error("register: " + reg.status);
const S = { cookie: reg.setCookie.split(";")[0] };
const out = { started: new Date().toISOString(), node: process.version, file: FILE.split("/").pop(), media_type: MEDIA, bytes: readFileSync(FILE).length };
out.ai_status = (await raw(S, "GET", "/api/ai/status")).json;

const t1 = await timed(() => raw(S, "POST", "/api/ai/receipt-file", { media_type: MEDIA, data: readFileSync(FILE).toString("base64") }));
out.transcribe = { status: t1.value.status, ms: t1.ms };
if (t1.value.status !== 200) { out.transcribe.body = t1.value.json; writeFileSync(OUT, JSON.stringify(out, null, 1)); throw new Error("receipt-file " + t1.value.status); }
const text = parseJsonAnswer(t1.value.json.text).receipt_text;
out.transcribe.chars = text.length; out.transcribe.lines = text.split("\n").length;

const t2 = await timed(() => raw(S, "POST", "/api/ai/receipt-text", { receipt_text: text }));
out.extract = { status: t2.value.status, ms: t2.ms };
if (t2.value.status !== 200) { out.extract.body = t2.value.json; writeFileSync(OUT, JSON.stringify(out, null, 1)); throw new Error("receipt-text " + t2.value.status); }
const answer = parseJsonAnswer(t2.value.json.text);
out.header = { store_name: answer.store_name, purchase_date: answer.purchase_date, total_amount: answer.total_amount };
out.model_items = (answer.items || []).map(i => ({ original_name: i.original_name, normalized_name: i.normalized_name, quantity: i.quantity, price: i.price }));

// deterministic part, as ReceiptUpload does: discount lines merged, lines classified by rules, saved through the API
const lines = receiptLines(answer);
const classified = lines.map(l => ({ ...l, normalized_name: l.normalized_name || l.original_name, ...classifyReceiptLine({ ...l, normalized_name: l.normalized_name || l.original_name }) }));
out.lines_after_rules = classified.length;
out.discounts_merged = classified.filter(l => l.discount).map(l => ({ name: l.original_name, discount: l.discount, price: l.price }));
out.sum_of_lines = Math.round(classified.reduce((s, l) => s + (l.price || 0), 0) * 100) / 100;
const receipt = (await raw(S, "POST", "/api/receipts", { store_name: answer.store_name, purchase_date: answer.purchase_date, total_amount: answer.total_amount, raw_text: "(qa receipt_example2)", status: "analyzed",
  food_item_count: classified.filter(l => l.is_food).length, non_food_item_count: classified.filter(l => !l.is_food).length })).json;
await raw(S, "POST", "/api/receiptItems/bulk", classified.map(l => ({ receipt_id: receipt.id, original_name: l.original_name, normalized_name: l.normalized_name, category: l.category,
  is_food: l.is_food, is_approved_for_menu: l.is_approved_for_menu, quantity: l.quantity || "", price: l.price, reasoning: l.reasoning })));
let items = (await raw(S, "GET", `/api/receiptItems?receipt_id=${receipt.id}`)).json;
const food = items.filter(i => i.is_food);
const tm = await timed(() => raw(S, "POST", "/api/products/match-items", { items: food.map(i => ({ name: i.normalized_name || i.original_name, normalized_name: i.normalized_name })) }));
const matches = tm.value.json.matches;
for (let k = 0; k < food.length; k++) if (matches[k]) await raw(S, "PATCH", `/api/receiptItems/${food[k].id}`, matchPatch(food[k], matches[k]));
items = (await raw(S, "GET", `/api/receiptItems?receipt_id=${receipt.id}`)).json;
out.match_ms = tm.ms;
out.items = items.map(i => ({ original_name: i.original_name, normalized_name: i.normalized_name, quantity: i.quantity, price: i.price, is_food: !!i.is_food, category: i.category,
  menu: !!i.is_approved_for_menu, health_score: i.health_score, match_status: i.catalog_match_status, needs_review: !!i.catalog_needs_review, match_type: i.catalog_match_type, match_confidence: i.catalog_match_confidence,
  matched_product: i.matched_product_name || null, basket_ready: isBasketReady(i) }));
const count = f => out.items.filter(f).length;
out.summary = { lines: out.items.length, food: count(i => i.is_food), non_food: count(i => !i.is_food),
  by_status: Object.fromEntries([...new Set(out.items.map(i => i.match_status))].map(s => [s, count(i => i.match_status === s)])), basket_ready: count(i => i.basket_ready) };
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ header: out.header, transcribe: out.transcribe, extract: out.extract, summary: out.summary }, null, 1));
