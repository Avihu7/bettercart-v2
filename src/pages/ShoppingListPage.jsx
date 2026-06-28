import React, { useState } from "react";
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
  Heart, AlertCircle, Upload, Zap, CheckCircle2
} from "lucide-react";
import { formatCurrency } from "@/lib/calculations";
import StatCard from "@/components/dashboard/StatCard";
import { optimizeShoppingQuantities, getOptimizationSummary } from "@/lib/shoppingOptimizer";

const MIN_FOOD_ITEMS = 3;

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

const ShekelIcon = ({ className }) => (
  <span className={`${className} flex items-center justify-center font-bold`} style={{ fontSize: '0.9rem' }}>₪</span>
);

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

  const { data: shoppingLists, isLoading: listsLoading } = useQuery({
    queryKey: ["shoppingLists", user?.email],
    queryFn: () => api.entities.ShoppingList.filter({ created_by: user.email }, "-created_date", 5),
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
      
      const restrictionWarning = dietaryRestrictions.length > 0 || allergies.length > 0
        ? `⚠️ CRITICAL DIETARY RESTRICTIONS - MUST BE STRICTLY FOLLOWED:
${dietaryRestrictions.includes("vegan") || dietaryRestrictions.includes("טבעוני") ? "- USER IS VEGAN: ABSOLUTELY NO meat, poultry, fish, dairy, eggs, or any animal products whatsoever." : ""}
${dietaryRestrictions.includes("vegetarian") || dietaryRestrictions.includes("צמחוני") ? "- USER IS VEGETARIAN: NO meat, poultry, or fish." : ""}
${dietaryRestrictions.includes("kosher") || dietaryRestrictions.includes("כשר") ? "- USER KEEPS KOSHER: No mixing of meat and dairy." : ""}
${allergies.length > 0 ? `- ALLERGIES (NEVER include): ${allergies.join(", ")}` : ""}
Any item violating these restrictions must be replaced with a compliant alternative.`
        : "";

      const prompt = `You are a smart shopping list generator. Create an optimized shopping list based on the user's profile and receipt history.

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

RECEIPT ITEMS (user's actual purchases - use only items that comply with dietary restrictions above):
${itemsList || "No receipt data available"}

RULES:
1. FIRST AND FOREMOST: strictly follow all dietary restrictions above - no exceptions.
2. Prefer compliant foods from the user's actual receipt history.
3. Give priority to favorite foods.
4. Add healthier alternatives where needed.
5. ⚠️ STRICT BUDGET LIMIT: The SUM of all estimated_price values MUST be under ₪${profile?.budget_per_purchase || 500}. No exceptions. Reduce quantities or item count if needed.
6. Ensure enough calories for ${daysPerPurchase} days (${totalCaloriesNeeded} cal total).
7. Balance protein, carbs, and fats.
8. Each item needs: name, category, quantity, estimated_price, calories (total for quantity), protein, carbs, fat, health_score (0-10), and reason.
9. Before returning, verify: sum of all estimated_price < ₪${profile?.budget_per_purchase || 500}.

Generate a practical, realistic shopping list with 12-18 items. Use Israeli supermarket product names. MAX BUDGET: ₪${profile?.budget_per_purchase || 500}.`;

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
                  category: { type: "string" },
                  quantity: { type: "string" },
                  estimated_price: { type: "number" },
                  calories: { type: "number" },
                  protein: { type: "number" },
                  carbs: { type: "number" },
                  fat: { type: "number" },
                  health_score: { type: "number" },
                  reason: { type: "string" },
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
      let finalItems = result.items || [];
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
      });

      return list;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shoppingLists"] });
    },
  });

  const { data: nutritionPlans } = useQuery({
    queryKey: ["nutritionPlans", user?.email],
    queryFn: () => api.entities.NutritionPlan.filter({ created_by: user.email }, "-created_date", 1),
    initialData: [],
    enabled: !!user,
  });

  const [optimizeDone, setOptimizeDone] = useState(false);

  const optimizeMutation = useMutation({
    mutationFn: async () => {
      const list = shoppingLists?.[0];
      const plan = nutritionPlans?.[0];
      if (!list?.items?.length || !plan?.days?.length) {
        throw new Error("נדרש סל קניות ותפריט תזונה קיימים");
      }
      const optimizedItems = optimizeShoppingQuantities(list.items, plan.days);
      const summary = getOptimizationSummary(list.items, optimizedItems);
      const cleanedItems = optimizedItems.map(({ _optimized, _gramsNeeded, ...rest }) => rest);
      await api.entities.ShoppingList.update(list.id, { items: cleanedItems });
      return summary;
    },
    onSuccess: (summary) => {
      queryClient.invalidateQueries({ queryKey: ["shoppingLists"] });
      setOptimizeDone(true);
      setTimeout(() => setOptimizeDone(false), 4000);
    },
  });

  const latestList = shoppingLists?.[0];
  const latestPlan = nutritionPlans?.[0];
  const showList = latestList || null;
  const canOptimize = !!(latestList?.items?.length && latestPlan?.days?.length);

  const catalogMatchCount = receiptItems.filter(
    i => i.catalog_match_status === "matched" && !i.catalog_needs_review
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold">סל קניות חכם</h1>
          <p className="text-sm text-muted-foreground">מותאם למטרות ולתקציב שלכם באמצעות AI</p>
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
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending || optimizeMutation.isPending}
          >
            {generateMutation.isPending ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <RefreshCw className="w-4 h-4 ml-2" />}
            {showList ? "יצירה מחדש" : "יצירת רשימה"}
          </Button>
          {canOptimize && (
            <Button
              variant="outline"
              onClick={() => optimizeMutation.mutate()}
              disabled={optimizeMutation.isPending || generateMutation.isPending}
              className={optimizeDone ? "border-green-500 text-green-700" : ""}
            >
              {optimizeMutation.isPending
                ? <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                : optimizeDone
                  ? <CheckCircle2 className="w-4 h-4 ml-2 text-green-600" />
                  : <Zap className="w-4 h-4 ml-2" />
              }
              {optimizeDone ? "הכמויות עודכנו!" : "כיוון כמויות"}
            </Button>
          )}
          {showList && (
            <Button onClick={() => navigate(`/nutrition-plan?list_id=${showList.id}`)} className="rounded-full">
              יצירת תפריט <ChevronLeft className="w-4 h-4 mr-1" />
            </Button>
          )}
        </div>
      </div>

      {generateMutation.isError && !generateMutation.isPending && (
        <Card className="p-4 border-destructive/50 bg-destructive/5">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-sm">לא הצלחנו ליצור את סל הקניות</p>
              <p className="text-xs text-muted-foreground mt-1">
                בדקו שה-API key מוגדר, או נסו שוב בעוד רגע.
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 font-mono">{generateMutation.error?.message}</p>
            </div>
          </div>
        </Card>
      )}

      {optimizeMutation.isError && !optimizeMutation.isPending && (
        <Card className="p-4 border-amber-200 bg-amber-50">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-sm text-amber-800">לא הצלחנו לייעל את הכמויות</p>
              <p className="text-xs text-amber-700 mt-1">{optimizeMutation.error?.message}</p>
            </div>
          </div>
        </Card>
      )}

      {canOptimize && !optimizeMutation.isPending && !generateMutation.isPending && showList && (
        <Card className="p-4 bg-blue-50 border-blue-200">
          <div className="flex items-start gap-3">
            <Zap className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-blue-800">כיוון כמויות אוטומטי זמין</p>
              <p className="text-xs text-blue-700 mt-0.5">
                לאחר יצירת תפריט תזונה, לחצו "כיוון כמויות" כדי לחשב אוטומטית את הכמויות הנדרשות לפי השימוש הממשי בתפריט השבועי.
              </p>
            </div>
          </div>
        </Card>
      )}

      {generateMutation.isPending && (
        <Card className="p-10 text-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
          <h2 className="font-heading font-semibold text-lg">יוצרים את סל הקניות החכם שלכם...</h2>
          <p className="text-sm text-muted-foreground">מנתחים העדפות, תקציב וצרכים תזונתיים</p>
        </Card>
      )}

      {optimizeMutation.isPending && (
        <Card className="p-10 text-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
          <h2 className="font-heading font-semibold text-lg">מחשבים כמויות מהתפריט השבועי...</h2>
          <p className="text-sm text-muted-foreground">מצרפים גרמים לפי ימי התפריט ומחשבים כמויות קנייה</p>
        </Card>
      )}

      {!generateMutation.isPending && !optimizeMutation.isPending && !showList && (
        <Card className="p-10 text-center">
          <ShoppingCart className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
          <h2 className="font-heading font-semibold text-lg mb-2">עדיין לא נוצר סל קניות</h2>
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
                ניצור עבורכם סל קניות חכם לפי הפרופיל, התקציב והקבלות שהעליתם.
              </p>
              <Button onClick={() => generateMutation.mutate()}>
                <Sparkles className="w-4 h-4 ml-2" /> צור סל קניות חכם
              </Button>
            </>
          )}
        </Card>
      )}

      {showList && !generateMutation.isPending && !optimizeMutation.isPending && (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 gap-4">
            <StatCard title="עלות כוללת" value={formatCurrency(showList.total_estimated_cost)} icon={ShekelIcon} color="green" />
            <StatCard title="מוצרים" value={showList.items?.length || 0} icon={ShoppingCart} color="blue" />
          </div>

          {/* Items Table */}
          <Card className="overflow-hidden">
            <div className="p-4 border-b flex items-center justify-between">
              <h2 className="font-heading font-semibold">מוצרים לקנייה</h2>
              <Badge variant="secondary">תקופה של {showList.shopping_period_days} ימים</Badge>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>מוצר</TableHead>
                    <TableHead>קטגוריה</TableHead>
                    <TableHead>כמות</TableHead>
                    <TableHead>מחיר</TableHead>
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
                      <TableCell className="text-sm">{item.quantity}</TableCell>
                      <TableCell className="text-sm">{formatCurrency(item.estimated_price)}</TableCell>
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
                        {item.reason}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}