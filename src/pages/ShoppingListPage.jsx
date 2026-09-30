import React from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/localAPI";
import { useAuth } from "@/lib/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ShoppingCart, Loader2, ChevronLeft, Sparkles, RefreshCw,
  Heart, AlertCircle, Upload
} from "lucide-react";
import StatCard from "@/components/dashboard/StatCard";
import { useFlowData, FLOW_QUERY_KEY } from "@/lib/flowData";
import FlowSteps from "@/components/FlowSteps";

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

function getEffectiveItemData(item) {
  const hasStrongCatalogMatch =
    item.catalog_match_status === "matched" && !item.catalog_needs_review;

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

  const { data: receiptItems = [], isLoading: itemsLoading } = useQuery({
    queryKey: ["approvedItems", effectiveReceiptId, user?.email],
    queryFn: () => effectiveReceiptId
      ? api.entities.ReceiptItem.filter({ receipt_id: effectiveReceiptId, created_by: user.email, is_food: true, is_approved_for_menu: true })
      : Promise.resolve([]),
    enabled: !!user,
  });

  const profile = profiles?.[0];

  const generateMutation = useMutation({
    mutationFn: async () => {
      const enrichedItems = receiptItems.map(getEffectiveItemData);
      const itemsList = enrichedItems.map(i =>
        `${i.normalized_name || i.original_name} (${i.category}, ${i.effective_calories_per_100g} cal/100g, protein:${i.effective_protein_per_100g}g, carbs:${i.effective_carbs_per_100g}g, fat:${i.effective_fat_per_100g}g, ₪${i.effective_price}, source:${i.data_source})`
      ).join("\n");
      const daysPerPurchase = profile?.purchases_per_month ? Math.round(30 / profile.purchases_per_month) : 7;
      const totalCaloriesNeeded = (profile?.daily_calories || 2000) * daysPerPurchase;

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

The RECEIPT ITEMS below are a signal of the user's habits and preferences — they are a STARTING POINT, not a strict limit. You must actively diversify beyond them using realistic Israeli Shufersal products (the CATALOG COMPLEMENTARY OPTIONS below, if given, are real catalog products you can draw from or use as inspiration).

${restrictionWarning}

USER PROFILE:
- Daily calories: ${profile?.daily_calories || 2000}
- Protein target: ${profile?.protein_target || 150}g/day
- Carbs target: ${profile?.carbs_target || 200}g/day
- Fat target: ${profile?.fat_target || 67}g/day
- Goal: ${profile?.goal || "maintenance"}
- Budget per purchase: ₪${profile?.budget_per_purchase || 500}
- Shopping period: ${daysPerPurchase} days
- Total calories needed: ${totalCaloriesNeeded}
- Dietary preferences: ${dietaryRestrictions.join(", ") || "None"}
- Allergies: ${allergies.join(", ") || "None"}
- Favorite foods: ${(profile?.favorite_foods || []).join(", ") || "None"}
- Disliked foods: ${(profile?.disliked_foods || []).join(", ") || "None"}

RECEIPT ITEMS (user's actual purchases — a preference signal, not a strict limit; use items that comply with dietary restrictions above):
${itemsList || "No receipt data available"}

CATALOG COMPLEMENTARY OPTIONS (real products from the active Shufersal catalog, offered to fill protein-group gaps the receipt is missing — use some of these, or similar realistic Shufersal products, to diversify):
${complementaryList || "None needed — receipt already covers enough protein variety"}

RULES:
1. FIRST AND FOREMOST: strictly follow all dietary restrictions above - no exceptions.
2. The receipt reflects habits, not a ceiling — actively diversify beyond it. Do NOT build the list around chicken/poultry and eggs as the only protein sources.
3. Protein source diversity (REQUIRED): include items from AT LEAST 3 different protein source groups among: ${eligibleGroupLabels}. Use the CATALOG COMPLEMENTARY OPTIONS above (or similar real Shufersal products) to cover groups missing from the receipt.
4. Category variety targets for a ${daysPerPurchase}-day list: at least 4 different vegetables, 2+ fruits, 2+ healthy fat sources, 2-3 different carb sources.
5. Give priority to favorite foods and compliant receipt items, but do not let them crowd out the diversity requirements above.
6. Add healthier alternatives where needed.
7. ⚠️ STRICT BUDGET LIMIT: The SUM of all estimated_price values MUST be under ₪${profile?.budget_per_purchase || 500}. No exceptions. Reduce quantities or item count if needed — prefer trimming duplicate/overlapping items over dropping an entire protein group.
8. Ensure enough calories for ${daysPerPurchase} days (${totalCaloriesNeeded} cal total).
9. Balance protein, carbs, and fats.
10. If the user keeps kosher, keep meat/poultry items and dairy-protein items as distinct shopping items (they must be usable in separate meals, never combined).
11. Each item needs: name, category, quantity, estimated_price, calories (total for quantity), protein, carbs, fat, health_score (0-10), and reason.
12. LANGUAGE (strict): "name" is the Hebrew product name as sold in Israeli supermarkets. "category" is exactly one of: ${SHOPPING_CATEGORIES.join(", ")}. "reason" is one short, natural Hebrew sentence explaining why the item is on the list — Hebrew only, never English.
13. Before returning, verify: sum of all estimated_price < ₪${profile?.budget_per_purchase || 500}.

Generate a practical, realistic, VARIED shopping list with 12-18 items. Use Israeli supermarket product names. MAX BUDGET: ₪${profile?.budget_per_purchase || 500}.`;

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
      const budget = profile?.budget_per_purchase || 500;
      let finalItems = await ensureHebrewReasons(
        (result.items || []).map(item => ({ ...item, category: normalizeCategory(item.category) }))
      );
      let runningTotal = finalItems.reduce((sum, i) => sum + (i.estimated_price || 0), 0);
      while (runningTotal > budget && finalItems.length > 1) {
        // Remove the most expensive item
        const maxIdx = finalItems.reduce((mi, item, idx, arr) => item.estimated_price > arr[mi].estimated_price ? idx : mi, 0);
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
  const { basket: showList, completed } = useFlowData(user);

  const catalogMatchCount = receiptItems.filter(
    i => i.catalog_match_status === "matched" && !i.catalog_needs_review
  ).length;

  return (
    <div className="space-y-6">
      <FlowSteps current={2} completed={completed} />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold">סל מוצרים חכם</h1>
          <p className="text-sm text-muted-foreground">בחרנו עבורך מוצרים שמהם נבנה את התפריט השבועי</p>
          {effectiveReceiptId && (
            <p className="text-xs text-muted-foreground/70 mt-0.5">
              מבוסס על קבלה מ-{latestReceipt?.store_name || (receiptId ? "הקבלה שנבחרה" : "הקבלה האחרונה שהועלתה")}
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
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>מוצר</TableHead>
                    <TableHead>קטגוריה</TableHead>
                    <TableHead>ציון</TableHead>
                    <TableHead>סיבה</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {showList.items?.map((item, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium text-sm">{item.name}</TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${categoryColors[item.category] || categoryColors.other}`}>
                          {CATEGORY_LABELS[item.category] || item.category}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                          item.health_score >= 7 ? "bg-green-50 text-green-700" :
                          item.health_score >= 4 ? "bg-amber-50 text-amber-700" :
                          "bg-red-50 text-red-700"
                        }`}>
                          {item.health_score}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                        {isHebrewReason(item.reason) ? item.reason : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          <Card className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm text-muted-foreground">מהמוצרים האלה נבנה עבורכם תפריט תזונה שבועי מותאם.</p>
            <Button onClick={() => navigate(`/nutrition-plan?list_id=${showList.id}`)} className="rounded-full">
              בניית תפריט תזונה <ChevronLeft className="w-4 h-4 mr-1" />
            </Button>
          </Card>
        </>
      )}
    </div>
  );
}