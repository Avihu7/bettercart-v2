/**
 * Deterministic product health score (0–10) from the product name alone.
 *
 * The same name always gets the same score — no AI involved. The score is a
 * base per food group (the groups used by the menu engine) plus fixed name
 * rules for processing, sugar and fat. Used for receipt items (computed on the
 * server on every save), basket items and purchase history.
 *
 * Which name: for a receipt item matched to the catalog, the catalog product
 * name (stable); otherwise the receipt text. See healthScoreName().
 */
import { classifyProduct } from "./mealPlanRules.js";

// Quotes/punctuation out, final letters kept (the rules below are written with them)
const norm = s => ` ${String(s || "").replace(/[׳'`´"״]/g, "").replace(/[-–—,()*+/]/g, " ").replace(/\s+/g, " ").trim().toLowerCase()} `;

// Base score per food group (classifyProduct)
const GROUP_BASE = {
  vegetable: 10, fruit: 9, legumes: 9, fish: 9, avocado: 9, starch_veg: 8,
  eggs: 8, yogurt: 8, nuts: 8, tahini: 8, tea: 8,
  dairy_protein: 7, milk: 7, plant_milk: 7, meat: 7, oil: 7,
  grain: 6, coffee: 6, bread: 5, cereal: 5, other: 5,
};

// Products whose score is fixed whatever their group (first match wins).
// Checked before the group, so "שוקולד חלב" is chocolate, not milk.
const FIXED = [
  [/^ סוכר( |$)|סוכר לבן|סוכר חום|סירופ|ריבה|ממרח שוקולד|נוטלה/, 1],
  [/קולה|ספרייט|פאנטה|משקה קל|משקה אנרגיה|אנרגיה|נקטר(?!ינ)|משקה בטעם|ענבים מוגז/, 2],
  [/סוכריות|סוכריה|מרשמלו|גומי|ממתק|טופי|מסטיק/, 2],
  [/(^| )(יין|בירה|וודקה|ויסקי|ליקר|ערק|קברנה|מרלו|שרדונה|מוסקטו)( |$)/, 2],
  [/במבה|ביסלי|צ'?יפס|דוריטוס|תפוצ'?יפס|חטיף|אפרופו|קרקר/, 3],
  [/גלידה|גלידת|ארטיק|קרטיב/, 3],
  [/עוגה|עוגת|עוגי|ביסקוו|ביסקוי|וופל|קרואסון|בורקס|רוגלך|מאפה|דונאט|סופגני|קרמבו|פחזני/, 3],
  [/מעדן|מילקי|פודינג|שוקו /, 3],
  [/נקניק|סלמי|פסטרמה|קבנוס|נקניקיות|פפרוני|מעובד/, 3],
  [/מיונז|קטשופ|רוטב ברביקיו|צ'?ילי מתוק/, 3],
  [/שוקולד מריר|מריר 70|מריר 85/, 5],
  [/שוקולד/, 3],
  [/מיץ/, 4],
  [/פיצה|המבורגר קפוא|נאגטס|שניצל/, 4],
  [/^ (מים|סודה)( |$)|מים מינרליים|מי עדן|נביעות/, 10],
  [/חמאה(?! בוטנים)|שמנת מתוקה|שמנת לבישול/, 3],
];

// Adjustments by name, applied to the group base
const RULES = [
  // whole grain
  [/מלא|מלאה|דגנים מלאים|כוסמין|שיפון|חום|מחיטה מלאה|100% מלא/, +2, ["bread", "grain", "cereal"]],
  [/אורז לבן|לחם לבן|לבן אחיד|קמח לבן/, -1, ["bread", "grain"]],
  [/קינואה|כוסמת|בורגול|שיבולת שועל|עדשים/, +2, ["grain", "cereal"]],
  // sugar / coating
  [/ללא תוספת סוכר|ללא סוכר|לא ממותק|טבעי/, +1, null],
  [/ממותק|מתוק|בטעם|מצופה|בציפוי|דבש|שוקו|קרמל|וניל/, -2, null],
  // fat in dairy
  [/(^|[^\d.])(0|0\.5|1|1\.5|3|5)%/, +1, ["dairy_protein", "yogurt", "milk"]],
  [/(^|[^\d.])(9|12|15|16|22|24|25|28|30|32|38)%|צהובה|שמנת|מסקרפונה/, -2, ["dairy_protein", "yogurt", "milk"]],
  // processing
  [/מטוגן|פריך|בפירורים|מצופה פירורים/, -2, null],
  [/מעושן|מלוח|כבוש|במלח/, -1, null],
  [/בשמן(?! זית)/, -1, ["fish"]],
  [/זית|כתית/, +1, ["oil"]],
  [/חזה|פילה/, +1, ["meat"]],
  [/טחון|כבד|שוקיים/, -1, ["meat"]],
];

// Fruit, vegetables and herbs the menu classifier has no group for
const EXTRA_GROUPS = [
  [/לימונ|אשכולית|קיווי|שזיפ|דובדבנ|רימונ|תאנ|פטל|אוכמני|פומל|ליצ'?י|פסיפלורה|נקטרינ|משמש|אפרסמונ/, "fruit"],
  [/שום|ג'?ינג'?ר|צנונית|שעועית ירוקה|פטרוזיליה|כוסברה|שמיר|נענע|בזיליקום|עירית|כרפס|סלרי|לפת|קולורבי|ארטישוק|אספרגוס|דלעת|במיה|נבטים/, "vegetable"],
];

const clamp = n => Math.max(0, Math.min(10, Math.round(n)));

/** Health score 0–10 for a product name. Same name → same score. */
export function productHealthScore(name) {
  const n = norm(name);
  if (!n.trim()) return null;
  for (const [re, score] of FIXED) if (re.test(n)) return score;
  let group = classifyProduct(name);
  if (group === "other") {
    const plain = n.replace(/[ךםןףץ]/g, c => ({ ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" })[c]); // lists use regular letters
    group = EXTRA_GROUPS.find(([re]) => re.test(plain))?.[1] ?? "other";
  }
  let score = GROUP_BASE[group] ?? GROUP_BASE.other;
  for (const [re, delta, groups] of RULES) {
    if ((!groups || groups.includes(group)) && re.test(n)) score += delta;
  }
  return clamp(score);
}

/**
 * The name a receipt item is scored by: the catalog product when the item is
 * matched or approved (stable whatever the receipt text said), else the
 * receipt's reading of it.
 */
export function healthScoreName(item) {
  if (item?.is_food === false || item?.is_food === 0) return ""; // non-food: no score
  const matched = ["matched", "approved"].includes(item?.catalog_match_status) && item?.matched_product_name;
  return matched || item?.normalized_name || item?.original_name || "";
}
