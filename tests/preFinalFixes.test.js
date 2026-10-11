/**
 * Pre-final QA fixes:
 *   A. "דג" is a fish only as a word — never the letters inside "דגנים"
 *   B. pet food is never food
 *   C. receipt AI goes through the BetterCart server; the browser holds no API key
 *   D. the upload accepts exactly the file types the server can read (images and PDF)
 *   E. a receipt line with a Hebrew unit ("750 מ"ל") no longer breaks the reading
 *   F. a history regular the receipt already has (worded differently) is not added again
 *   G. a pickled / honey variant is never accepted as the plain product without the user
 *   H. a multipack written with a capital X ("150X3ג") is 450 g, not 3 g
 *   I. one carton of eggs on the final list costs one carton
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { classifyProduct } from "@/lib/mealPlanRules";
import { productHealthScore } from "@/lib/healthScore";
import { isNonFoodName } from "@/lib/nonFood";
import { classifyReceiptLine, categoryOf } from "@/lib/receiptClassifier";
import { profileConflict } from "@/lib/basketAlternatives";
import { buildBasket } from "@/lib/basketBuilder";
import { matchPatch } from "@/lib/receiptReview";
import { parseQuantityGrams } from "@/lib/mealPlanCalories";
import { receiptToBasketItem } from "@/lib/basketBuilder";
import { buildFinalShoppingList } from "@/lib/shoppingOptimizer";
import { fileContentBlock, SUPPORTED_MEDIA_TYPES, AiError, readReceiptText as serverReadReceiptText, transcribeReceipt } from "../server/ai.js";

describe("A. fish vs grains", () => {
  it.each(["דג", "דג סלמון", "פילה דג", "דגים טריים", "קציצות דגים", "דגי ים", "פילה דג בקלה 400 גרם", "הדג הטרי", "טונה בשמן", "סלמון טרי"])(
    "%s is fish", name => expect(classifyProduct(name)).toBe("fish"));

  it.each([
    ["דגנים", "other"], ["לחם דגנים", "bread"], ["לחם דגנים מלאים", "bread"], ["חלה דגנים קלועה 500 גרם", "bread"],
    ["פריכיות דגנים", "bread"], ["דגני בוקר", "cereal"], ["פסטה מדגנים מלאים", "grain"],
  ])("%s is %s, not fish", (name, group) => expect(classifyProduct(name)).toBe(group));

  it.each(["חטיף דגנים", "מרק דגש", "מטאטא דגם 6 יחידה", "גלידה וניל מדגסקר", "מיני קרקר דגיגונים"])(
    "%s is not fish", name => expect(classifyProduct(name)).not.toBe("fish"));

  it("catalog names that were fish only through the letters stay fish", () => {
    expect(classifyProduct("דגקרפיון פרוס טרי שופר")).toBe("fish");
    expect(classifyProduct("פילה לברק 5-7 דלידג")).toBe("fish");
  });

  it("a multigrain bread is a carb with a bread health score, and is not a fish allergen", () => {
    expect(categoryOf("לחם דגנים מלאים")).toBe("carb");
    expect(productHealthScore("לחם דגנים מלאים")).toBe(7); // bread 5 + whole grain 2 (was 9: the fish base)
    expect(profileConflict({ name: "לחם דגנים מלאים" }, { allergies: ["דגים"] })).toBeNull();
    expect(profileConflict({ name: "לחם דגנים מלאים" }, { dietary_preferences: ["צמחוני"] })).toBeNull();
    expect(profileConflict({ name: "פילה דג בקלה" }, { allergies: ["דגים"] })).toMatchObject({ kind: "allergy" });
    expect(profileConflict({ name: "פילה דג בקלה" }, { dietary_preferences: ["צמחוני"] })).toMatchObject({ kind: "diet" });
  });
});

describe("B. pet food is never food", () => {
  // real names from the catalog (Shufersal / Rami Levy)
  it.each([
    "לה קט פטה סלמון 100 גרם", "לה קט עוף 2.85 ק\"ג", "סופר קט טונה 3 ק\"ג", "פריסקיז פטה דג 156גרם", "פריסקיז עוף ברוטב 156גרם",
    "דוגלי בוגר בקר 3 ק\"ג", "פיין דוג 415 גרם עוף", "גורמה גולד פטה עוף 85גרם", "פנסיפיסט גורמה עוף 85גרם",
    "וונפי שימורי חתול פטה טונה 375 גר", "ונפי מוס בשר עוף וגזרלחתול 90 גר", "חטיף כלבים ברונו פילה סלמון 80 גרם",
    "מזון חתולים לה קט דגים 2.85 ק\"ג", "דנטלייף חתול עוף 40 גרם", "נייטיב ווי פטה סלמון", "מונג פרש פטה ונתחי עוף", "פנסי פיטס פטה בקר 85 גרם", "נטוראה מזון יבש כלב 2ק\"ג", "תערובת  לדגים במיכל90ג", "מזון לכלבים",
  ])("%s is not food", name => {
    expect(isNonFoodName(name)).toBe(true);
    expect(classifyReceiptLine({ normalized_name: name, original_name: name })).toMatchObject({ is_food: false, is_approved_for_menu: false });
  });

  it.each(["החתול המחייך גבינה מותכת 14% מון בלאן 120 גרם", "כדורי מוצרלה קטן 19%  גד", "פילה סלמון טרי", "טונה בשמן זית", "חזה עוף טרי", "קונפיטורה תות 340 גרם", "תפוח אדמה לבן גורמה", "נקניקיות עוף", "פטה כבשים 20% 250 גרם", "קיט קט צ'אנקי פאנקי 40 ג"])(
    "%s is still food", name => expect(isNonFoodName(name)).toBe(false));
});

describe("C. receipt AI goes through the server", () => {
  const sourceFiles = dir => readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.(js|jsx|ts|tsx)$/.test(f) ? [p] : [];
  });

  it("no browser code names the AI provider, its key, or a VITE_ key variable", () => {
    const hits = sourceFiles(join(process.cwd(), "src")).filter(p =>
      /api\.anthropic\.com|x-api-key|VITE_ANTHROPIC|anthropic-dangerous-direct-browser-access|sk-ant-/.test(readFileSync(p, "utf8")));
    expect(hits).toEqual([]);
  });

  it("the server reads the key from ANTHROPIC_API_KEY only, and never returns or logs it", () => {
    const server = readFileSync(join(process.cwd(), "server", "ai.js"), "utf8");
    expect(server).toMatch(/process\.env\.ANTHROPIC_API_KEY/);
    expect(server).not.toMatch(/VITE_/);
    // the key appears only in the request header to the provider
    expect(server.match(/apiKey\(\)/g)).toHaveLength(2); // isAiConfigured and the x-api-key header
    expect(server).not.toMatch(/console\.[a-z]+\([^)]*apiKey/);
    expect(readFileSync(join(process.cwd(), ".env.example"), "utf8")).not.toMatch(/VITE_ANTHROPIC/);
  });

  describe("client", () => {
    let calls;
    beforeEach(() => {
      vi.resetModules();
      calls = [];
    });
    afterEach(() => vi.unstubAllGlobals());
    const stubFetch = (configured, answer = { store_name: "שופרסל", items: [] }) => vi.stubGlobal("fetch", async (url, options = {}) => {
      calls.push({ url: String(url), options });
      const body = String(url).endsWith("/api/ai/status") ? { configured } : { text: JSON.stringify(answer) };
      return { ok: true, status: 200, json: async () => body };
    });

    it("reads receipt text through /api/ai/receipt-text, with the session cookie and no key", async () => {
      stubFetch(true);
      const { readReceiptText } = await import("@/lib/ai");
      expect(await readReceiptText("חלב 6.90")).toEqual({ store_name: "שופרסל", items: [] });
      expect(calls.map(c => c.url)).toEqual(["/api/ai/status", "/api/ai/receipt-text"]);
      const post = calls[1].options;
      expect(post.method).toBe("POST");
      expect(post.credentials).toBe("include");
      expect(JSON.parse(post.body)).toEqual({ receipt_text: "חלב 6.90" });
      expect(Object.keys(post.headers).map(h => h.toLowerCase())).toEqual(["content-type"]);
      expect(calls.some(c => /anthropic/.test(c.url))).toBe(false);
    });

    it("demo mode when the server has no key: no AI request at all", async () => {
      stubFetch(false);
      const { readReceiptText } = await import("@/lib/ai");
      const { DEMO_AI_RESPONSE } = await import("@/lib/demoData");
      expect(await readReceiptText("anything")).toBe(DEMO_AI_RESPONSE);
      expect(calls.map(c => c.url)).toEqual(["/api/ai/status"]);
    });

    it("a server error keeps its code for the upload page", async () => {
      vi.stubGlobal("fetch", async url => (String(url).endsWith("/status")
        ? { ok: true, status: 200, json: async () => ({ configured: true }) }
        : { ok: false, status: 415, json: async () => ({ error: "סוג הקובץ אינו נתמך", code: "unsupported_media" }) }));
      const { readReceiptText } = await import("@/lib/ai");
      await expect(readReceiptText("x")).rejects.toMatchObject({ code: "unsupported_media", status: 415 });
    });
  });
});

describe("D. supported upload types", () => {
  it("images go as image blocks, a PDF as a document block", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/gif"]) {
      expect(fileContentBlock(type, "AAAA")).toEqual({ type: "image", source: { type: "base64", media_type: type, data: "AAAA" } });
    }
    expect(fileContentBlock("application/pdf", "AAAA")).toEqual({ type: "document", source: { type: "base64", media_type: "application/pdf", data: "AAAA" } });
  });

  it.each(["", "text/plain", "image/heic", "image/svg+xml", "application/zip", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"])(
    "%s is refused with a clear code", type => {
      expect(() => fileContentBlock(type, "AAAA")).toThrow(AiError);
      try { fileContentBlock(type, "AAAA"); } catch (err) { expect(err).toMatchObject({ code: "unsupported_media", status: 415 }); }
    });

  it("the upload control offers exactly the types the server reads", () => {
    const page = readFileSync(join(process.cwd(), "src", "pages", "ReceiptUpload.jsx"), "utf8");
    const accept = page.match(/accept="([^"]+)"/)[1].split(",").filter(t => t.includes("/"));
    expect(accept.sort()).toEqual([...SUPPORTED_MEDIA_TYPES].sort());
  });
});

describe("E. the receipt answer is always valid JSON", () => {
  // Written as text, the model left the quote in מ"ל / ק"ג unescaped and JSON.parse failed
  // on every such receipt; the answer now comes through a required tool call (an object).
  const answer = { store_name: "שופרסל", purchase_date: "2026-09-28", total_amount: 49.8, items: [
    { original_name: 'שמן זית 750 מ"ל', normalized_name: 'שמן זית 750 מ"ל', quantity: '750 מ"ל', price: 29.9 },
    { original_name: 'אורז בסמטי 1 ק"ג', normalized_name: 'אורז בסמטי 1 ק"ג', quantity: '1 ק"ג', price: 19.9 },
  ] };
  let sent;
  beforeEach(() => {
    sent = [];
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    vi.stubGlobal("fetch", async (url, options) => {
      sent.push({ url: String(url), headers: options.headers, body: JSON.parse(options.body) });
      const input = sent.at(-1).body.model.includes("haiku") ? answer : { receipt_text: 'שמן זית 750 מ"ל 29.90' };
      return { ok: true, status: 200, json: async () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "record_receipt", input }] }) };
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("receipt text is read through a required tool call, and the result parses with the quotes intact", async () => {
    const text = await serverReadReceiptText('שמן זית 750 מ"ל 29.90\nאורז בסמטי 1 ק"ג 19.90');
    expect(JSON.parse(text)).toEqual(answer);
    const { url, headers, body } = sent[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(headers["x-api-key"]).toBe("test-key-not-real");
    expect(body.tool_choice).toEqual({ type: "tool", name: "record_receipt" });
    expect(body.tools[0].strict).toBe(true);
    expect(body.tools[0].input_schema).toMatchObject({ additionalProperties: false, required: ["store_name", "purchase_date", "total_amount", "items"] });
    expect(body.tools[0].input_schema.properties.items.items.properties).toHaveProperty("original_name");
    expect(body.messages[0].content).toContain('750 מ"ל');
  });

  it("a file is transcribed the same way (image block, or document block for a PDF)", async () => {
    expect(JSON.parse(await transcribeReceipt("image/png", "AAAA"))).toEqual({ receipt_text: 'שמן זית 750 מ"ל 29.90' });
    await transcribeReceipt("application/pdf", "AAAA");
    expect(sent.map(s => s.body.messages[0].content[0].type)).toEqual(["image", "document"]);
    expect(sent.every(s => s.body.tool_choice?.name === "record_receipt")).toBe(true);
  });

  it("without a key on the server nothing is sent", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expect(serverReadReceiptText("x")).rejects.toMatchObject({ code: "not_configured", status: 503 });
    expect(sent).toEqual([]);
  });
});

describe("F. history regulars already in the receipt", () => {
  const profile = { onboarding_complete: true, daily_calories: 2400, protein_target: 120, fat_target: 80, carbs_target: 300, dietary_preferences: [], allergies: [], disliked_foods: [], favorite_foods: [] };
  const receiptItem = (name, productId, extra = {}) => ({
    id: `r-${productId}`, receipt_id: "now", original_name: name, normalized_name: name, category: "dairy", is_food: true, is_approved_for_menu: true,
    quantity: "", price: 7.9, matched_product_id: String(productId), matched_product_name: name, catalog_match_status: "matched", catalog_needs_review: false,
    catalog_price: 7.9, catalog_pack_grams: 1000, ...extra,
  });
  const regular = (name, productId, category) => ({
    name, history_score: 0.76, quality_score: 0.8, confidence: 0.6, receipt_count: 3, total_receipts: 3,
    latest_item: { ...receiptItem(name, productId), id: `h-${productId}`, receipt_id: "older", category },
  });
  const build = history => buildBasket({
    receiptItems: [receiptItem("חלב תנובה 1 ליטר 3% x 2", 101), receiptItem("קוטג' תנובה 250 גרם 5% x 2", 102, { catalog_pack_grams: 250 }), receiptItem("חזה עוף טרי 1 קילוגרם", 103, { category: "protein" })],
    history, profile, weeklyBudget: 900, additions: async () => [], staples: async () => [],
  });

  it("the same catalog product worded differently on an older receipt is not added again", async () => {
    const { items } = await build([regular("חלב תנובה 3% 1 ליטר", 101, "dairy"), regular("קוטג' תנובה 5% 250 גרם", 102, "dairy"), regular("חזה עוף טרי 1 ק\"ג", 103, "protein")]);
    expect(items.map(i => i.name)).toEqual(["חלב תנובה 1 ליטר 3% x 2", "קוטג' תנובה 250 גרם 5% x 2", "חזה עוף טרי 1 קילוגרם"]);
    expect(items.some(i => i.from_history)).toBe(false);
  });

  it("the same product type under another catalog row is not added again either", async () => {
    const { items } = await build([regular("קוטג' תנובה 3% 250 גרם", 999, "dairy")]);
    expect(items.filter(i => /קוטג/.test(i.name))).toHaveLength(1);
  });

  it("a regular the receipt does not have is still added", async () => {
    const { items } = await build([regular("עדשים אדומות 500 גרם", 555, "protein")]);
    expect(items.find(i => i.from_history)?.name).toBe("עדשים אדומות 500 גרם");
  });
});

describe("G. a different product is never a confident match", () => {
  const match = (matched_name, extra = {}) => ({ matched: true, matched_product_id: "1", matched_name, category: "vegetable", match_type: "token", match_confidence: 0.83, ...extra });
  const item = (name, category = "vegetable") => ({ normalized_name: name, original_name: name, category, is_food: true });

  it("pickled cucumbers are only suggested for plain cucumbers", () => {
    expect(matchPatch(item("מלפפונים 1.5 קילוגרם"), match("מלפפונים בחומץ צנצנת680ג"))).toMatchObject({ catalog_match_status: "needs_review", catalog_needs_review: true });
    expect(matchPatch(item("מלפפונים בחומץ"), match("מלפפונים בחומץ צנצנת680ג"))).toMatchObject({ catalog_match_status: "matched" });
  });

  it("honey cornflakes are only suggested for plain cornflakes", () => {
    expect(matchPatch(item("קורנפלקס תלמה 750 גרם", "carb"), match("קורנפלקס דבש 448ג תלמה", { category: "carb", match_confidence: 0.8 }))).toMatchObject({ catalog_match_status: "needs_review" });
  });

  it("a plain product is still matched", () => {
    expect(matchPatch(item("עגבניות 1.5 קילוגרם"), match("עגבניות שרי 500 גרם"))).toMatchObject({ catalog_match_status: "matched", catalog_needs_review: false });
  });
});

describe("H. multipack weight with a capital X", () => {
  it.each([["טונה במים 150X3ג", 450], ["טונה במים 150x3ג", 450], ["טונה במי מלח 140*4 גרם", 560], ["2 × 500 ג", 1000], ["טונה במים סטארקיסט 160 גרם", 160]])(
    "%s → %i g", (text, grams) => expect(parseQuantityGrams(text, "fish")).toBe(grams));

  it("a receipt tuna matched to the 3-can pack keeps a sane price per kg", () => {
    const item = receiptToBasketItem({
      id: "t1", original_name: "טונה במים מארז 4", normalized_name: "טונה במים מארז 4", category: "protein", is_food: true, is_approved_for_menu: true,
      quantity: "", price: 21.9, matched_product_id: "77", matched_product_name: "טונה במים 150X3ג", catalog_match_status: "matched", catalog_needs_review: false,
      catalog_price: 14.9, catalog_pack_grams: 450, catalog_sold_by_weight: false,
    });
    expect(item.pack_grams).toBe(450);
    expect(item.price_per_kg).toBeCloseTo(33.11, 1);
    expect(item.price_per_kg).toBeLessThan(100);
  });
});

describe("I. eggs on the final list", () => {
  const eggs = { name: "ביצים L קרטון 12", category: "protein", quantity: "500 גרם", estimated_price: 34.9, pack_grams: 500, pack_price: 34.9, price_per_kg: 69.8, sold_by_weight: false };
  const week = grams => [{ day_name: "Sunday", meals: [{ meal_type: "Breakfast", items: [{ food_name: eggs.name, grams }] }] }];

  it("7 eggs → one carton, at the price of one carton", () => {
    const { items, total_estimated_cost } = buildFinalShoppingList([eggs], week(350));
    expect(items[0].quantity).toBe("תבנית 12 ביצים");
    expect(items[0].estimated_price).toBe(34.9);
    expect(total_estimated_cost).toBe(34.9);
  });

  it("14 eggs → two cartons, at the price of two", () => {
    const { items } = buildFinalShoppingList([eggs], week(760));
    expect(items[0].quantity).toBe("תבנית 12 ביצים × 2");
    expect(items[0].estimated_price).toBe(69.8);
  });

  it("eggs without a pack keep the 12 × 60 g carton", () => {
    const { items } = buildFinalShoppingList([{ name: "ביצים", category: "protein", quantity: "12 יחידות", estimated_price: 14.9 }], week(350));
    expect(items[0].purchase_grams).toBe(720);
  });
});
