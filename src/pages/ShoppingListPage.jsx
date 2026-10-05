import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/localAPI";
import { useAuth } from "@/lib/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ShoppingCart, Loader2, ChevronLeft, Sparkles, RefreshCw,
  Heart, AlertCircle, Upload, Repeat2, Trash2, Info, Plus
} from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import StatCard from "@/components/dashboard/StatCard";
import { useFlowData, FLOW_QUERY_KEY } from "@/lib/flowData";
import FlowSteps from "@/components/FlowSteps";
import { isBasketReady, isUnresolved } from "@/lib/receiptReview";
import { classifyProduct, normalizeHebrew } from "@/lib/mealPlanRules";
import { parseQuantityGrams } from "@/lib/mealPlanCalories";
import { findAlternatives, buildReplacementItem, isDisliked, itemRole, familyLabel, missingStaples, basketSufficiency, profileConflict, isSupplement } from "@/lib/basketAlternatives";

const MIN_FOOD_ITEMS = 3;

// ─── Protein source diversity ────────────────────────────────────────────────
// Receipts tend to be dominated by 1-2 "safe" proteins (chicken, eggs). To keep
// the shopping list from narrowing the whole week's menu to just those, we
// detect which of these groups are already represented in the receipt and, for
// groups that are missing (and not excluded by dietary restrictions/allergies),
// fetch a couple of real complementary candidates from the active Shufersal
// catalog to suggest to the AI generator.
const PROTEIN_SOURCE_GROUPS = {
  poultry:       { label: "עוף/הודו",     terms: ["עוף", "הודו"],                    searchTerm: "חזה עוף" },
  eggs:          { label: "ביצים",         terms: ["ביצים", "ביצה"],                  searchTerm: "ביצים" },
  dairy_protein: { label: "חלבון חלבי",    terms: ["קוטג", "יוגורט", "לבנה", "גבינה"], searchTerm: "קוטג" },
  fish:          { label: "דגים",          terms: ["טונה", "סלמון", "דג"],            searchTerm: "טונה בשמן" },
  legumes:       { label: "קטניות",        terms: ["עדש", "חומוס", "שעועית"],         searchTerm: "עדשים" },
  plant_protein: { label: "חלבון צמחי",    terms: ["טופו", "סייטן"],                  searchTerm: "טופו" },
};

function excludedProteinGroups(dietaryRestrictions, allergies) {
  const has = (arr, ...vals) => vals.some(v => arr.includes(v));
  const excluded = new Set();
  if (has(dietaryRestrictions, "vegan", "טבעוני")) {
    ["poultry", "eggs", "dairy_protein", "fish"].forEach(g => excluded.add(g));
  }
  if (has(dietaryRestrictions, "vegetarian", "צמחוני")) {
    ["poultry", "fish"].forEach(g => excluded.add(g));
  }
  if (has(allergies, "דגים", "פירות ים")) excluded.add("fish");
  if (has(allergies, "ביצים")) excluded.add("eggs");
  if (has(allergies, "חלב") || has(dietaryRestrictions, "ללא לקטוז")) excluded.add("dairy_protein");
  if (has(allergies, "סויה")) excluded.add("plant_protein");
  return excluded;
}

function presentProteinGroups(itemNames) {
  const present = new Set();
  for (const [group, cfg] of Object.entries(PROTEIN_SOURCE_GROUPS)) {
    if (cfg.terms.some(t => itemNames.some(n => n.includes(t)))) present.add(group);
  }
  return present;
}

// Best-effort: fetch a couple of real Shufersal catalog candidates per missing
// protein group. Failures are swallowed — this is a suggestion layer only, the
// AI prompt still works fine without it.
async function fetchComplementaryCandidates(missingGroups) {
  const candidates = [];
  for (const group of missingGroups.slice(0, 3)) {
    try {
      const res = await fetch(`/api/products/search?q=${encodeURIComponent(PROTEIN_SOURCE_GROUPS[group].searchTerm)}&limit=2`);
      if (!res.ok) continue;
      const data = await res.json();
      for (const p of (data.results || []).slice(0, 2)) {
        candidates.push({ group, ...p });
      }
    } catch { /* best-effort — skip this group on failure */ }
  }
  return candidates;
}

// Pack size assumed when a receipt line has no readable quantity
const DEFAULT_PACK_GRAMS = 500;

/**
 * A recognized receipt item as a basket item: the receipt is the basis of the
 * basket, so these go in directly (catalog values when the match is confirmed).
 */
function receiptToBasketItem(raw) {
  const i = getEffectiveItemData(raw);
  const name = i.normalized_name || i.original_name;
  const category = normalizeCategory(i.category);
  const group = classifyProduct(name, category);
  const parsed = parseQuantityGrams(i.quantity, group) || parseQuantityGrams(i.matched_product_name, group);
  const grams = parsed || DEFAULT_PACK_GRAMS;
  const f = grams / 100;
  const per = v => (v == null ? null : Math.round(Number(v) * f * 10) / 10);
  return {
    name,
    category,
    quantity: parsed && i.quantity ? i.quantity : `${grams} גרם`,
    estimated_price: Number(i.effective_price ?? i.price ?? 0) || 0,
    calories: Math.round((Number(i.effective_calories_per_100g) || 0) * f),
    protein: per(i.effective_protein_per_100g),
    carbs: per(i.effective_carbs_per_100g),
    fat: per(i.effective_fat_per_100g),
    health_score: i.health_score ?? null,
    reason: "נמצא בקבלה שלך, ולכן נשאר בסל.",
    from_receipt: true,
    receipt_item_id: i.id,
    ...(i.data_source === "catalog" ? {
      catalog_product_id: i.matched_product_id ?? null,
      catalog_chain: i.catalog_chain ?? null,
      catalog_name: i.matched_product_name ?? null,
      catalog_price: i.catalog_price ?? null,
    } : {}),
  };
}

const sameFood = (a, b) => {
  const [x, y] = [normalizeHebrew(a), normalizeHebrew(b)];
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

function getEffectiveItemData(item) {
  const hasStrongCatalogMatch =
    ["matched", "approved"].includes(item.catalog_match_status) && !item.catalog_needs_review;

  return {
    ...item,
    effective_price:
      hasStrongCatalogMatch && item.catalog_price != null
        ? item.catalog_price
        : item.price,
    effective_calories_per_100g:
      hasStrongCatalogMatch && item.catalog_calories_per_100g != null
        ? item.catalog_calories_per_100g
        : item.calories_per_100g,
    effective_protein_per_100g:
      hasStrongCatalogMatch && item.catalog_protein_per_100g != null
        ? item.catalog_protein_per_100g
        : item.protein_per_100g,
    effective_carbs_per_100g:
      hasStrongCatalogMatch && item.catalog_carbs_per_100g != null
        ? item.catalog_carbs_per_100g
        : item.carbs_per_100g,
    effective_fat_per_100g:
      hasStrongCatalogMatch && item.catalog_fat_per_100g != null
        ? item.catalog_fat_per_100g
        : item.fat_per_100g,
    data_source: hasStrongCatalogMatch ? "catalog" : "receipt_ai",
  };
}


const categoryColors = {
  protein: "bg-red-50 text-red-700",
  carb: "bg-amber-50 text-amber-700",
  fat: "bg-purple-50 text-purple-700",
  vegetable: "bg-green-50 text-green-700",
  fruit: "bg-orange-50 text-orange-700",
  dairy: "bg-blue-50 text-blue-700",
  snack: "bg-pink-50 text-pink-700",
  drink: "bg-cyan-50 text-cyan-700",
  other: "bg-gray-50 text-gray-700",
};

const CATEGORY_LABELS = {
  protein: "חלבון", carb: "פחמימה", fat: "שומן",
  vegetable: "ירק", fruit: "פרי", dairy: "חלבי",
  snack: "חטיף", drink: "שתייה", other: "אחר",
};

const SHOPPING_CATEGORIES = Object.keys(CATEGORY_LABELS);

// Maps AI category variants ("carbs", "legumes", "מוצרי חלב", …) onto the category keys above
const CATEGORY_ALIASES = [
  [/^(carbs?|grains?|bread|pasta|rice|cereals?)$|פחמימ|דגנ|לחם|כוללי/i, "carb"],
  [/^(legumes?|plant_protein|meat|poultry|fish|eggs?|proteins?)$|חלבון|קטני|עו[פף]|בשר|דג/i, "protein"],
  [/^(dairy_products|milk)$|חלב/i, "dairy"],
  [/^(fats?|oils?|healthy_fats?|nuts?)$|שומנ|שמן|אגוז|שקד/i, "fat"],
  [/^vegetables?$|ירק/i, "vegetable"],
  [/^fruits?$|פרי|פירות|פרות/i, "fruit"],
  [/^(snacks?|sweets?|favorite)$|חטי[פף]|מתוק/i, "snack"],
  [/^(drinks?|beverages?)$|משק[הא]|שתי/i, "drink"],
];

function normalizeCategory(category) {
  const c = String(category || "").trim();
  if (SHOPPING_CATEGORIES.includes(c)) return c;
  return CATEGORY_ALIASES.find(([re]) => re.test(c))?.[1] || "other";
}

// A reason is shown only if it is Hebrew text, not predominantly Latin/English
function isHebrewReason(text) {
  const hebrew = (String(text || "").match(/[\u05D0-\u05EA]/g) || []).length;
  const latin = (String(text || "").match(/[A-Za-z]/g) || []).length;
  return hebrew > 0 && hebrew >= latin;
}

// Rewrites only the non-Hebrew reasons in Hebrew; unrepaired ones are cleared
async function ensureHebrewReasons(items) {
  const bad = items.map((item, index) => ({ index, item })).filter(({ item }) => item.reason && !isHebrewReason(item.reason));
  if (!bad.length) return items;
  console.warn(`[shopping list] rewriting ${bad.length} non-Hebrew reasons`);
  let fixes = [];
  try {
    const res = await api.integrations.Core.InvokeLLM({
      prompt: `Rewrite each shopping-list item explanation below as one short, natural Hebrew sentence with the same meaning. Hebrew only — no English words.

ITEMS:
${JSON.stringify(bad.map(({ index, item }) => ({ index, name: item.name, reason: item.reason })), null, 1)}`,
      response_json_schema: {
        type: "object",
        properties: {
          reasons: { type: "array", items: { type: "object", properties: { index: { type: "number" }, reason: { type: "string" } } } },
        },
      },
    });
    fixes = res.reasons || [];
  } catch (err) {
    console.error("[shopping list] reason rewrite failed", err);
  }
  return items.map((item, index) => {
    if (!item.reason || isHebrewReason(item.reason)) return item;
    const fixed = fixes.find(f => f.index === index)?.reason;
    return { ...item, reason: isHebrewReason(fixed) ? fixed : "" };
  });
}

// Basket totals after an item was removed or replaced
function basketTotals(items) {
  return {
    total_estimated_cost: Math.round(items.reduce((s, i) => s + (Number(i.estimated_price) || 0), 0) * 100) / 100,
    total_calories: Math.round(items.reduce((s, i) => s + (Number(i.calories) || 0), 0)),
  };
}

// A basket this small, or without a protein, carb or vegetable, limits the weekly menu
const MIN_VARIED_BASKET = 8;
function basketLooksThin(items) {
  const roles = new Set(items.map(itemRole));
  return items.length < MIN_VARIED_BASKET || !["protein", "carb", "vegetable"].every(r => roles.has(r) || (r === "protein" && roles.has("dairy")));
}

function ReplaceDialog({ item, basketItems, profile, onClose, onSelect, saving }) {
  const { data: options = [], isLoading, isError } = useQuery({
    queryKey: ["basketAlternatives", item?.name, basketItems.map(i => i.name).join("|"), profile?.id],
    queryFn: () => findAlternatives(item, basketItems, profile),
    enabled: !!item,
    staleTime: 5 * 60 * 1000,
  });
  const looksFor = item && familyLabel(item);

  return (
    <Dialog open={!!item} onOpenChange={open => !open && !saving && onClose()}>
      <DialogContent
        dir="rtl"
        className="w-[calc(100%-2rem)] max-w-md max-h-[85vh] overflow-y-auto rounded-xl p-5 text-right [&>button:last-child]:right-auto [&>button:last-child]:left-4"
      >
        <DialogHeader className="text-right sm:text-right space-y-1">
          <DialogTitle className="font-heading">החלפת מוצר</DialogTitle>
          <DialogDescription>
            במקום: <span className="font-medium text-foreground">{item?.name}</span>
            {looksFor && <span className="block text-xs mt-1">נחפש {looksFor}, עם ערכים תזונתיים קרובים, מקטלוג שופרסל.</span>}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto mb-2" />
            מחפשים חלופות מתאימות...
          </div>
        )}

        {!isLoading && (isError || options.length === 0) && (
          <p className="py-6 text-center text-sm text-muted-foreground">לא מצאנו כרגע חלופה דומה מספיק למוצר הזה.</p>
        )}

        {!isLoading && options.length > 0 && (
          <ul className="space-y-2">
            {options.map(o => (
              <li key={o.product.product_id}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => onSelect(o)}
                  className="w-full text-right rounded-lg border p-3 hover:border-primary hover:bg-primary/5 transition-colors disabled:opacity-50 flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{o.candidate.label}</p>
                    <p className="text-xs text-muted-foreground truncate">{o.product.original_product_name}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      ל-100 גרם: {Math.round(o.per100.kcal)} קלוריות · {Math.round(o.per100.protein)} ג׳ חלבון
                    </p>
                    {o.keepsProteinGoal === true && (
                      <p className="text-[11px] text-emerald-700 mt-0.5">שומר על יעד החלבון שלך</p>
                    )}
                    {o.keepsProteinGoal === false && (
                      <p className="text-[11px] text-amber-700 mt-0.5">
                        עם ההחלפה הסל יגיע לכ-{o.proteinAfter} ג׳ חלבון ביום (יעד {profile?.protein_target} ג׳)
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-left">
                    <p className="text-sm font-semibold">₪{Number(o.product.price).toFixed(2)}</p>
                    <p className="text-[11px] text-muted-foreground">{o.grams >= 1000 && o.grams % 1000 === 0 ? `${o.grams / 1000} ק"ג` : `${Math.round(o.grams)} גרם`}</p>
                    <span className="text-xs text-primary font-medium">בחירה</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {saving && <p className="text-xs text-center text-muted-foreground">שומרים את הבחירה...</p>}
      </DialogContent>
    </Dialog>
  );
}

export default function ShoppingListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const urlParams = new URLSearchParams(window.location.search);
  const receiptId = urlParams.get("receipt_id");

  const { data: profiles } = useQuery({
    queryKey: ["userProfile", user?.email],
    queryFn: () => api.entities.UserProfile.filter({ created_by: user.email }),
    initialData: [],
    enabled: !!user,
  });


  // Fetch latest receipt for this user (used when no receipt_id in URL)
  const { data: latestReceipts = [] } = useQuery({
    queryKey: ["latestReceipt", user?.email],
    queryFn: () => api.entities.Receipt.filter({ created_by: user.email }, "-created_date", 1),
    initialData: [],
    enabled: !!user && !receiptId,
  });

  const latestReceipt = latestReceipts?.[0];
  // Use explicit receipt_id from URL; fall back to latest receipt for current user only
  const effectiveReceiptId = receiptId || latestReceipt?.id || null;

  const { data: foodReceiptItems = [], isLoading: itemsLoading } = useQuery({
    queryKey: ["approvedItems", effectiveReceiptId, user?.email],
    queryFn: () => effectiveReceiptId
      ? api.entities.ReceiptItem.filter({ receipt_id: effectiveReceiptId, created_by: user.email, is_food: true })
      : Promise.resolve([]),
    enabled: !!user,
  });
  // Only confidently recognized or user-approved food items feed the basket;
  // items still awaiting review (or ignored / not food) never reach the AI
  const receiptItems = foodReceiptItems.filter(isBasketReady);
  const pendingReview = foodReceiptItems.filter(isUnresolved).length;

  const profile = profiles?.[0];

  const generateMutation = useMutation({
    mutationFn: async () => {
      // Receipt items that break the diet or allergies never reach the AI or the basket
      const receiptName = i => ({ name: i.normalized_name || i.original_name, category: i.category });
      const enrichedItems = receiptItems
        .filter(i => !profileConflict(receiptName(i), profile) && !isSupplement(receiptName(i)))
        .map(getEffectiveItemData);
      const itemsList = enrichedItems.map(i =>
        `${i.normalized_name || i.original_name} (${i.category}, ${i.effective_calories_per_100g} cal/100g, protein:${i.effective_protein_per_100g}g, carbs:${i.effective_carbs_per_100g}g, fat:${i.effective_fat_per_100g}g, ₪${i.effective_price}, source:${i.data_source})`
      ).join("\n");
      // BetterCart plans a full week: one weekly menu and one weekly basket,
      // whatever the shopping frequency (which only splits the budget)
      const daysPerPurchase = 7;
      const totalCaloriesNeeded = (profile?.daily_calories || 2000) * daysPerPurchase;
      const weeklyBudget = Math.round(profile?.monthly_budget
        ? profile.monthly_budget * 7 / 30
        : (profile?.budget_per_purchase || 500) * Math.max(1, (profile?.purchases_per_month || 4) / 4.3));
      // The receipt is the basis of the basket: its recognized, menu-fit food
      // items (not disliked) go in as they are; the AI only adds around them
      const receiptBasket = [];
      for (const item of receiptItems.map(receiptToBasketItem)) {
        if (isDisliked(item.name, profile?.disliked_foods || [])) continue;
        if (profileConflict(item, profile) || isSupplement(item)) continue;
        if (receiptBasket.some(b => sameFood(b.name, item.name))) continue;
        receiptBasket.push(item);
      }
      const receiptCost = receiptBasket.reduce((s, i) => s + (i.estimated_price || 0), 0);
      const addBudget = Math.max(Math.round(weeklyBudget * 0.3), Math.round(weeklyBudget - receiptCost));

      const dietaryRestrictions = profile?.dietary_preferences || [];
      const allergies = profile?.allergies || [];

      // Diversity: figure out which protein source groups the receipt is
      // already covering, and fetch real Shufersal candidates for the ones
      // that are missing (and not excluded by diet/allergies) so the AI has
      // concrete, real-priced options to diversify beyond chicken/eggs.
      const itemNames = enrichedItems.map(i => (i.normalized_name || i.original_name || ""));
      const excludedGroups = excludedProteinGroups(dietaryRestrictions, allergies);
      const eligibleGroups = Object.keys(PROTEIN_SOURCE_GROUPS).filter(g => !excludedGroups.has(g));
      const presentGroups = presentProteinGroups(itemNames);
      const missingGroups = eligibleGroups.filter(g => !presentGroups.has(g));
      const complementaryCandidates = missingGroups.length > 0
        ? await fetchComplementaryCandidates(missingGroups)
        : [];
      const complementaryList = complementaryCandidates.length > 0
        ? complementaryCandidates.map(c =>
            `${c.original_product_name} (קבוצת חלבון: ${PROTEIN_SOURCE_GROUPS[c.group].label}, ${c.calories_per_100g ?? "?"} cal/100g, protein:${c.protein_per_100g ?? "?"}g, ₪${c.price ?? "?"}, מקור: קטלוג שופרסל)`
          ).join("\n")
        : null;
      const eligibleGroupLabels = eligibleGroups.map(g => PROTEIN_SOURCE_GROUPS[g].label).join(", ");

      const restrictionWarning = dietaryRestrictions.length > 0 || allergies.length > 0
        ? `⚠️ CRITICAL DIETARY RESTRICTIONS - MUST BE STRICTLY FOLLOWED:
${dietaryRestrictions.includes("vegan") || dietaryRestrictions.includes("טבעוני") ? "- USER IS VEGAN: ABSOLUTELY NO meat, poultry, fish, dairy, eggs, or any animal products whatsoever." : ""}
${dietaryRestrictions.includes("vegetarian") || dietaryRestrictions.includes("צמחוני") ? "- USER IS VEGETARIAN: NO meat, poultry, or fish." : ""}
${dietaryRestrictions.includes("kosher") || dietaryRestrictions.includes("כשר") ? "- USER KEEPS KOSHER: Never combine meat/poultry items with dairy items in the same meal — keep meat-based and dairy-based items usable as separate meals." : ""}
${allergies.length > 0 ? `- ALLERGIES (NEVER include): ${allergies.join(", ")}` : ""}
Any item violating these restrictions must be replaced with a compliant alternative.`
        : "";

      const prompt = `You are a smart shopping list generator. Create an optimized, VARIED shopping list based on the user's profile and receipt history.

The basket is built around the user's receipt: the RECEIPT ITEMS below are ALREADY IN THE BASKET. Your job is to ADD the items that complete a balanced, varied week around them, using realistic Israeli Shufersal products (the CATALOG COMPLEMENTARY OPTIONS below, if given, are real catalog products you can draw from or use as inspiration).

${restrictionWarning}

USER PROFILE:
- Daily calories: ${profile?.daily_calories || 2000}
- Protein target: ${profile?.protein_target || 150}g/day
- Carbs target: ${profile?.carbs_target || 200}g/day
- Fat target: ${profile?.fat_target || 67}g/day
- Goal: ${profile?.goal || "maintenance"}
- Weekly budget: ₪${weeklyBudget}
- Shopping period: ${daysPerPurchase} days (one weekly basket)
- Total calories needed: ${totalCaloriesNeeded}
- Dietary preferences: ${dietaryRestrictions.join(", ") || "None"}
- Allergies: ${allergies.join(", ") || "None"}
- Favorite foods: ${(profile?.favorite_foods || []).join(", ") || "None"}
- Disliked foods (NEVER include): ${(profile?.disliked_foods || []).join(", ") || "None"}

RECEIPT ITEMS — ALREADY IN THE BASKET (do NOT list them again):
${itemsList || "No receipt data available"}

CATALOG COMPLEMENTARY OPTIONS (real products from the active Shufersal catalog, offered to fill protein-group gaps the receipt is missing — use some of these, or similar realistic Shufersal products, to diversify):
${complementaryList || "None needed — receipt already covers enough protein variety"}

RULES:
1. FIRST AND FOREMOST: strictly follow all dietary restrictions above - no exceptions.
2. Only ADD items: never repeat a receipt item. Add what the week still needs around it — do NOT build around chicken/poultry and eggs as the only protein sources.
3. Protein source diversity (REQUIRED): include items from AT LEAST 3 different protein source groups among: ${eligibleGroupLabels}. Use the CATALOG COMPLEMENTARY OPTIONS above (or similar real Shufersal products) to cover groups missing from the receipt.
4. Category variety targets for a ${daysPerPurchase}-day list: at least 4 different vegetables, 2+ fruits, 2+ healthy fat sources, 2-3 different carb sources.
5. Give priority to favorite foods and to products that go well with the receipt items.
6. Add healthier alternatives where needed.
7. ⚠️ STRICT BUDGET LIMIT: The SUM of the estimated_price values of the items you ADD MUST be under ₪${addBudget}. No exceptions. Reduce quantities or item count if needed — prefer trimming duplicate/overlapping items over dropping an entire protein group.
8. Ensure enough calories for ${daysPerPurchase} days (${totalCaloriesNeeded} cal total).
9. Balance protein, carbs, and fats.
9b. Only regular groceries that are cooked or eaten in meals. NEVER supplements, protein powders, superfood powders (e.g. spirulina), vitamins, capsules or tablets.
10. If the user keeps kosher, keep meat/poultry items and dairy-protein items as distinct shopping items (they must be usable in separate meals, never combined).
11. Each item needs: name, category, quantity, estimated_price, calories (total for quantity), protein, carbs, fat, health_score (0-10), and reason.
12. LANGUAGE (strict): "name" is the Hebrew product name as sold in Israeli supermarkets. "category" is exactly one of: ${SHOPPING_CATEGORIES.join(", ")}. "reason" is one short, natural Hebrew sentence explaining why the item is on the list — Hebrew only, never English.
13. Before returning, verify: sum of the added items' estimated_price < ₪${addBudget}.

Generate ${receiptBasket.length ? "6-12 additional items" : "a practical, realistic, VARIED shopping list with 12-18 items"}. Use Israeli supermarket product names. MAX BUDGET FOR THESE ITEMS: ₪${addBudget}.`;

      const result = await api.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  category: { type: "string", enum: SHOPPING_CATEGORIES },
                  quantity: { type: "string" },
                  estimated_price: { type: "number" },
                  calories: { type: "number" },
                  protein: { type: "number" },
                  carbs: { type: "number" },
                  fat: { type: "number" },
                  health_score: { type: "number" },
                  reason: { type: "string", description: "One short sentence in Hebrew" },
                },
              },
            },
            total_estimated_cost: { type: "number" },
            total_calories: { type: "number" },
          },
        },
      });

      // Enforce budget hard cap - trim items if AI exceeded budget
      const budget = weeklyBudget;
      // Disliked foods never enter the basket, even if the AI suggested them
      const disliked = profile?.disliked_foods || [];
      const aiItems = await ensureHebrewReasons(
        (result.items || [])
          .filter(item => !isDisliked(item.name, disliked))
          // the AI must follow the diet too — anything that breaks it is dropped
          .filter(item => !profileConflict(item, profile))
          // regular groceries only — supplements and powders are not meal food
          .filter(item => !isSupplement(item))
          // never a second copy of something the receipt already put in
          .filter(item => !receiptBasket.some(r => sameFood(r.name, item.name)))
          .map(item => ({ ...item, category: normalizeCategory(item.category) }))
      );
      let finalItems = [...receiptBasket, ...aiItems];
      // Bread/grains and a healthy fat are what lets the weekly menu reach the
      // calorie target — complete them from the Shufersal catalog if missing
      finalItems = [...finalItems, ...await missingStaples(finalItems, profile)];
      let runningTotal = finalItems.reduce((sum, i) => sum + (i.estimated_price || 0), 0);
      // Over budget: drop the most expensive AI addition first, receipt items
      // only as a last resort, added staples never
      const trimRank = i => (i.added_staple ? 0 : i.from_receipt ? 1 : 2);
      while (runningTotal > budget && finalItems.some(i => !i.added_staple)) {
        const maxIdx = finalItems.reduce((mi, item, idx, arr) =>
          trimRank(item) > trimRank(arr[mi]) || (trimRank(item) === trimRank(arr[mi]) && item.estimated_price > arr[mi].estimated_price) ? idx : mi, 0);
        runningTotal -= finalItems[maxIdx].estimated_price || 0;
        finalItems = finalItems.filter((_, idx) => idx !== maxIdx);
      }

      const list = await api.entities.ShoppingList.create({
        receipt_id: effectiveReceiptId || "",
        title: `סל קניות — ${new Date().toLocaleDateString("he-IL")}`,
        shopping_period_days: daysPerPurchase,
        total_estimated_cost: runningTotal,
        total_calories: result.total_calories,
        status: "draft",
        items: finalItems,
        complementary_added: missingGroups.length > 0,
      });

      return list;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shoppingLists"] });
      queryClient.invalidateQueries({ queryKey: [FLOW_QUERY_KEY] });
    },
  });

  // Baskets only — a final shopping list (step 4) is never shown here
  const { basket: showList, planBasket, planOutdated, completed, isLoading: flowLoading } = useFlowData(user);

  // One click from the receipt: arriving with ?build=1 builds the basket right
  // away, unless a basket for this receipt already exists. Runs once; the flag
  // is dropped from the address so a refresh does not build again.
  const autoBuilt = useRef(false);
  useEffect(() => {
    if (autoBuilt.current || urlParams.get("build") !== "1") return;
    if (flowLoading || itemsLoading || !profile || generateMutation.isPending) return;
    autoBuilt.current = true;
    window.history.replaceState(null, "", window.location.pathname + (receiptId ? `?receipt_id=${receiptId}` : ""));
    if (!showList || (effectiveReceiptId && showList.receipt_id !== effectiveReceiptId)) generateMutation.mutate();
  });

  // Remove / replace a single basket item — the rest of the basket stays as is
  const [replacing, setReplacing] = useState(null); // index of the item being replaced
  const [removedSome, setRemovedSome] = useState(false);
  const saveItemsMutation = useMutation({
    mutationFn: ({ items, warnings }) => api.entities.ShoppingList.update(showList.id, {
      items, ...basketTotals(items), ...(warnings ? { basket_warnings: warnings } : {}),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [FLOW_QUERY_KEY] }),
    onError: () => toast({ title: "השינוי לא נשמר", description: "נסו שוב בעוד רגע.", variant: "destructive" }),
  });

  // Can the basket still feed a good weekly menu for this profile?
  const sufficiency = showList?.items && profile ? basketSufficiency(showList.items, profile) : { ok: true, issues: [] };
  const savedWarnings = showList?.basket_warnings || [];
  // A change that would leave the basket short waits for the user's confirmation
  const [pendingChange, setPendingChange] = useState(null); // { items, issues, item, done, title }

  // Receipt food the user bought that is not in the basket (less healthy,
  // disliked, removed or trimmed for budget) — one tap puts it back
  const leftOutFromReceipt = showList?.items ? (() => {
    const seen = [];
    return foodReceiptItems
      .filter(i => ["matched", "approved"].includes(i.catalog_match_status))
      .filter(i => {
        const name = i.normalized_name || i.original_name;
        if (showList.items.some(b => sameFood(b.name, name)) || seen.some(n => sameFood(n, name))) return false;
        seen.push(name);
        return true;
      });
  })() : [];
  const conflictOf = i => profileConflict({ name: i.normalized_name || i.original_name, category: i.category }, profile);
  const leftOutReason = i => {
    const name = i.normalized_name || i.original_name;
    const conflict = conflictOf(i);
    if (conflict) return conflict.text;
    if (isSupplement({ name })) return "תוסף תזונה — לא חלק מהתפריט";
    if (!i.is_approved_for_menu) return "פחות מתאים לתפריט בריא";
    if (isDisliked(name, profile?.disliked_foods || [])) return "ברשימת המאכלים שציינת שאינך אוהב/ת";
    return "לא נכנס לסל";
  };
  const addFromReceipt = raw => {
    const item = { ...receiptToBasketItem(raw), reason: "הוספת מהקבלה שלך.", user_added: true };
    applyChange({
      items: [...showList.items, item],
      done: () => toast({ title: `${item.name} נוסף לסל`, description: "כדי שייכנס לתפריט, בנו את התפריט מחדש." }),
    });
  };

  const applyChange = ({ items, issues = [], item, done }) => {
    const warnings = issues.length ? [...savedWarnings, ...issues.map(i => ({ ...i, item }))] : undefined;
    saveItemsMutation.mutate({ items, warnings }, { onSuccess: done });
  };
  const requestChange = change => {
    const before = new Set(sufficiency.issues.map(i => i.key));
    const issues = basketSufficiency(change.items, profile).issues.filter(i => !before.has(i.key));
    if (issues.length) setPendingChange({ ...change, issues });
    else applyChange(change);
  };

  const removeItem = index => {
    const item = showList.items[index];
    requestChange({
      items: showList.items.filter((_, i) => i !== index),
      item: item.name,
      title: `הסרת ${item.name}`,
      done: () => {
        setRemovedSome(true);
        toast({ title: `${item.name} הוסר מהסל` });
      },
    });
  };

  const replaceItem = option => {
    const index = replacing;
    const old = showList.items[index];
    const items = showList.items.map((it, i) => (i === index ? buildReplacementItem(option) : it));
    setReplacing(null);
    requestChange({
      items,
      item: old.name,
      title: `החלפת ${old.name}`,
      done: () => toast({ title: `${old.name} הוחלף ב${option.candidate.label}` }),
    });
  };

  // "השלמת הסל": add only what is missing (no new basket), and clear old warnings
  const completeMutation = useMutation({
    mutationFn: async () => {
      const added = await missingStaples(showList.items, profile);
      const items = [...showList.items, ...added];
      await api.entities.ShoppingList.update(showList.id, { items, ...basketTotals(items), basket_warnings: [] });
      return added;
    },
    onSuccess: added => {
      queryClient.invalidateQueries({ queryKey: [FLOW_QUERY_KEY] });
      toast({ title: added.length ? `נוספו לסל ${added.length} מוצרים` : "לא נמצאו מוצרים מתאימים להשלמה" });
    },
  });

  const disliked = profile?.disliked_foods || [];
  // The weekly plan was built from an earlier version of this basket
  const basketChangedSincePlan = planOutdated && planBasket?.id === showList?.id;

  const catalogMatchCount = receiptItems.filter(
    i => ["matched", "approved"].includes(i.catalog_match_status) && !i.catalog_needs_review
  ).length;

  return (
    <div className="space-y-6">
      <FlowSteps current={2} completed={completed} />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold">סל מוצרים חכם</h1>
          <p className="text-sm text-muted-foreground">בחרנו עבורך מוצרים שמהם נבנה את התפריט השבועי</p>
          {showList?.items?.length > 0 && (
            <p className="text-sm text-muted-foreground">לא מתאים לך מוצר מסוים? אפשר להחליף או להסיר אותו לפני בניית התפריט.</p>
          )}
          {effectiveReceiptId && (
            <p className="text-xs text-muted-foreground/70 mt-0.5">
              מבוסס על קבלה מ-{latestReceipt?.store_name || (receiptId ? "הקבלה שנבחרה" : "הקבלה האחרונה שהועלתה")}
            </p>
          )}
          {effectiveReceiptId && pendingReview > 0 && (
            <p className="text-xs text-amber-700 mt-0.5">
              {pendingReview} פריטים מהקבלה עדיין דורשים בדיקה ולא ייכנסו לסל.{" "}
              <button type="button" className="underline" onClick={() => navigate(`/receipt-results?id=${effectiveReceiptId}`)}>
                לבדיקת הפריטים
              </button>
            </p>
          )}
          {!effectiveReceiptId && !itemsLoading && (
            <p className="text-xs text-amber-600 mt-0.5">
              לא נמצאה קבלה — העלו קבלה כדי לבסס את הסל
            </p>
          )}
          {effectiveReceiptId && receiptItems.length > 0 && (
            <p className="text-xs text-muted-foreground/60 mt-0.5">
              {catalogMatchCount > 0
                ? `הסל משתמש בנתוני קטלוג מאומתים עבור ${catalogMatchCount} מוצרים`
                : "הסל מבוסס על נתוני הקבלה והערכת AI"}
            </p>
          )}
          {effectiveReceiptId && catalogMatchCount > 0 && (
            <p className="text-[11px] text-muted-foreground/50 mt-0.5">
              נתוני הקטלוג מבוססים כרגע על שופרסל
            </p>
          )}
          {showList?.items?.some(i => i.from_receipt) && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {showList.items.filter(i => i.from_receipt).length} מוצרים בסל הגיעו מהקבלה שלך, והשאר נוספו כדי להשלים שבוע מאוזן
            </p>
          )}
          {showList?.complementary_added && (
            <p className="text-[11px] text-muted-foreground/50 mt-0.5">
              הסל מבוסס על הקבלה, אך הושלמו מוצרים חסרים כדי ליצור תפריט מגוון ומאוזן יותר
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
          >
            {generateMutation.isPending ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <RefreshCw className="w-4 h-4 ml-2" />}
            {showList ? "בחירה מחדש" : "בניית סל מוצרים חכם"}
          </Button>
        </div>
      </div>

      {generateMutation.isError && !generateMutation.isPending && (
        <Card className="p-4 border-destructive/50 bg-destructive/5">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-sm">לא הצלחנו לבנות את סל המוצרים</p>
              <p className="text-xs text-muted-foreground mt-1">
                בדקו שה-API key מוגדר, או נסו שוב בעוד רגע.
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 font-mono">{generateMutation.error?.message}</p>
            </div>
          </div>
        </Card>
      )}

      {generateMutation.isPending && (
        <Card className="p-10 text-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
          <h2 className="font-heading font-semibold text-lg">בוחרים עבורכם מוצרים...</h2>
          <p className="text-sm text-muted-foreground">מנתחים העדפות, תקציב וצרכים תזונתיים</p>
        </Card>
      )}

      {!generateMutation.isPending && !showList && (
        <Card className="p-10 text-center">
          <ShoppingCart className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
          <h2 className="font-heading font-semibold text-lg mb-2">עדיין לא נבחרו מוצרים</h2>
          {!itemsLoading && receiptItems.length < MIN_FOOD_ITEMS ? (
            <>
              <p className="text-sm text-muted-foreground mb-6">
                מצאנו מעט מדי מוצרי מזון בקבלות שלך כדי לבנות סל מדויק.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button variant="outline" onClick={() => navigate("/upload")}>
                  <Upload className="w-4 h-4 ml-2" /> להעלות קבלות נוספות
                </Button>
                <Button onClick={() => generateMutation.mutate()}>
                  <Sparkles className="w-4 h-4 ml-2" /> ליצור סל ראשוני לפי הפרופיל שלי
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-6">
                נבחר עבורכם מוצרים לפי הפרופיל, התקציב והקבלות שהעליתם — מהם נבנה את התפריט השבועי.
              </p>
              <Button onClick={() => generateMutation.mutate()}>
                <Sparkles className="w-4 h-4 ml-2" /> בניית סל מוצרים חכם
              </Button>
            </>
          )}
        </Card>
      )}

      {showList && !generateMutation.isPending && (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 gap-4">
            <StatCard title="מוצרים שנבחרו" value={showList.items?.length || 0} icon={ShoppingCart} color="blue" />
            <StatCard title="קטגוריות" value={new Set((showList.items || []).map(i => i.category)).size} icon={Heart} color="green" />
          </div>

          {/* Items Table */}
          <Card className="overflow-hidden">
            <div className="p-4 border-b flex items-center justify-between">
              <h2 className="font-heading font-semibold">המוצרים שנבחרו</h2>
              <span className="text-xs text-muted-foreground">הכמויות והעלות לקנייה יחושבו בסוף, לפי התפריט השבועי</span>
            </div>
            <ul className="divide-y">
              {showList.items?.map((item, i) => (
                <li key={`${i}-${item.name}`} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${
                      item.health_score >= 7 ? "bg-green-50 text-green-700" :
                      item.health_score >= 4 ? "bg-amber-50 text-amber-700" :
                      "bg-red-50 text-red-700"
                    }`} title="ציון בריאות">
                      {item.health_score ?? "–"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-sm break-words">{item.name}</span>
                        {item.from_receipt && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">מהקבלה</Badge>
                        )}
                        <Badge className={`text-xs ${categoryColors[item.category] || categoryColors.other}`}>
                          {CATEGORY_LABELS[item.category] || item.category}
                        </Badge>
                      </div>
                      {isHebrewReason(item.reason) && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.reason}</p>
                      )}
                      {profileConflict(item, profile) && (
                        <p className="text-xs text-destructive mt-1">{profileConflict(item, profile).text} — מומלץ להסיר מהסל</p>
                      )}
                      {isDisliked(item.name, disliked) && (
                        <p className="text-xs text-amber-700 mt-1">מופיע ברשימת המאכלים שציינת שאינך אוהב/ת</p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0 sm:mr-auto">
                    <Button
                      variant="outline" size="sm" className="flex-1 sm:flex-none min-h-9"
                      onClick={() => setReplacing(i)}
                      disabled={saveItemsMutation.isPending}
                    >
                      <Repeat2 className="w-4 h-4 ml-1.5" /> החלפה
                    </Button>
                    <Button
                      variant="ghost" size="sm" className="flex-1 sm:flex-none min-h-9 text-muted-foreground hover:text-destructive"
                      onClick={() => removeItem(i)}
                      disabled={saveItemsMutation.isPending}
                    >
                      <Trash2 className="w-4 h-4 ml-1.5" /> הסרה
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {leftOutFromReceipt.length > 0 && (
            <Card className="overflow-hidden">
              <div className="p-4 border-b">
                <h2 className="font-heading font-semibold">מהקבלה שלך — לא נכנסו לסל</h2>
                <p className="text-xs text-muted-foreground mt-0.5">ליד כל מוצר כתוב למה הוא לא נכנס. מוצר שמתאים לתזונה שלך אפשר להוסיף לסל בלחיצה.</p>
              </div>
              <ul className="divide-y">
                {leftOutFromReceipt.map(i => (
                  <li key={i.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-sm break-words">{i.normalized_name || i.original_name}</span>
                      <p className="text-xs text-muted-foreground mt-0.5">{leftOutReason(i)}</p>
                    </div>
                    {conflictOf(i) || isSupplement({ name: i.normalized_name || i.original_name }) ? (
                      <span className="text-xs text-muted-foreground shrink-0">לא ניתן להוסיף</span>
                    ) : (
                      <Button variant="outline" size="sm" className="min-h-9 shrink-0" disabled={saveItemsMutation.isPending}
                        onClick={() => addFromReceipt(i)}>
                        <Plus className="w-4 h-4 ml-1.5" /> הוספה לסל
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {!sufficiency.ok && (
            <Card className="p-4 border-amber-300 bg-amber-50/60 space-y-2">
              <p className="font-medium text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" /> עם הסל הנוכחי לא נוכל לבנות תפריט שעומד ביעדים שלך
              </p>
              <ul className="text-sm text-muted-foreground list-disc pr-5 space-y-0.5">
                {sufficiency.issues.map(i => <li key={i.key}>{i.text}</li>)}
              </ul>
              <Button size="sm" variant="outline" onClick={() => completeMutation.mutate()} disabled={completeMutation.isPending}>
                {completeMutation.isPending ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Sparkles className="w-4 h-4 ml-2" />}
                השלמת הסל
              </Button>
            </Card>
          )}

          {removedSome && sufficiency.ok && basketLooksThin(showList.items || []) && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 text-amber-800 text-sm p-3">
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              <span>הסרת מוצר עשויה להשפיע על מגוון התפריט.</span>
            </div>
          )}

          <Card className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {basketChangedSincePlan
                ? "עדכנת את הסל — התפריט ייבנה מחדש מהמוצרים המעודכנים."
                : "מהמוצרים האלה נבנה עבורכם תפריט תזונה שבועי מותאם."}
            </p>
            <Button
              onClick={() => navigate(`/nutrition-plan?list_id=${showList.id}&build=1`)}
              className="rounded-full"
              disabled={!showList.items?.length || saveItemsMutation.isPending}
            >
              בניית תפריט תזונה <ChevronLeft className="w-4 h-4 mr-1" />
            </Button>
          </Card>

          <AlertDialog open={!!pendingChange} onOpenChange={open => !open && setPendingChange(null)}>
            <AlertDialogContent dir="rtl" className="w-[calc(100%-2rem)] max-w-md rounded-xl text-right">
              <AlertDialogHeader className="text-right sm:text-right">
                <AlertDialogTitle>{pendingChange?.title}</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>אחרי השינוי הזה לא נוכל לבנות תפריט שבועי שעומד ביעדים שלך:</p>
                    <ul className="list-disc pr-5 space-y-0.5">
                      {pendingChange?.issues.map(i => <li key={i.key}>{i.text}</li>)}
                    </ul>
                    <p>אפשר להמשיך בכל זאת — התפריט ייבנה מהמוצרים שיישארו, וזה יצוין בו.</p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2 sm:gap-2 sm:justify-start">
                <AlertDialogCancel className="mt-0">ביטול</AlertDialogCancel>
                <AlertDialogAction onClick={() => { const c = pendingChange; setPendingChange(null); applyChange(c); }}>
                  להמשיך בכל זאת
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <ReplaceDialog
            item={replacing != null ? showList.items?.[replacing] : null}
            basketItems={showList.items || []}
            profile={profile}
            saving={saveItemsMutation.isPending}
            onClose={() => setReplacing(null)}
            onSelect={replaceItem}
          />
        </>
      )}
    </div>
  );
}