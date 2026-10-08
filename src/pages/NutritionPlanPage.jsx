import React, { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/localAPI";
import { useAuth } from "@/lib/AuthContext";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  UtensilsCrossed, Loader2, Sparkles, ChevronLeft,
  Sun, CloudSun, Moon, Cookie, Flame, Beef, Wheat, ShoppingCart, AlertCircle
} from "lucide-react";

const ShekelIcon = ({ className }) => (
  <span className={`${className} flex items-center justify-center font-bold`} style={{ fontSize: '0.9rem' }}>₪</span>
);
import { formatCurrency } from "@/lib/calculations";
import { generateNutritionPlan } from "@/lib/nutritionPlanGenerator";
import { sortDays, dayLabel } from "@/lib/weekDays";
import { useFlowData, FLOW_QUERY_KEY } from "@/lib/flowData";
import FlowSteps from "@/components/FlowSteps";
import { basketSufficiency } from "@/lib/basketAlternatives";
import { basketBudget } from "@/lib/pricing";
import StatCard from "@/components/dashboard/StatCard";
import MenuQualityCard from "@/components/MenuQualityCard";
import { validateMenu } from "@/lib/validateMenu";
import { explainMenu } from "@/lib/explainMenu";
import { basketBudgetPicture } from "@/lib/basketBudget";
import { receiptSpending, spendingComparison } from "@/lib/receiptClassifier";

const mealIcons = {
  Breakfast: Sun,
  Lunch: CloudSun,
  Dinner: Moon,
  Snacks: Cookie,
};

const MEAL_LABELS = {
  Breakfast: "ארוחת בוקר",
  Lunch: "ארוחת צהריים",
  Dinner: "ארוחת ערב",
  Snacks: "חטיפים",
};

// What each alternative menu ("בנייה מחדש") puts first (src/lib/nutritionPlanGenerator.js)
const ALTERNATIVE_LABELS = {
  variety: "עם דגש על מגוון", budget: "עם דגש על חיסכון", protein: "עם דגש על חלבון",
  balanced: "מאוזן", fresh: "שונה ככל האפשר מהתפריט הקודם",
};

// Daily total vs target: within ±10% counts as on target
function targetStatus(total, target) {
  if (!target || !total) return null;
  const dev = (total - target) / target;
  if (Math.abs(dev) <= 0.1) return { label: "במסגרת היעד", className: "text-emerald-600" };
  return dev > 0
    ? { label: "מעל היעד", className: "text-amber-600" }
    : { label: "מתחת ליעד", className: "text-amber-600" };
}

export default function NutritionPlanPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const urlParams = new URLSearchParams(window.location.search);
  const listId = urlParams.get("list_id");

  // Basket (step 2) this plan is built from, latest plan, and its final list (step 4)
  const { profile, basket: sourceList, plan: latestPlan, planBasket, planOutdated, finalList, completed, isLoading: flowLoading } = useFlowData(user, { listId });

  const generateMutation = useMutation({
    // previous: the menu on screen when the user asks for a different one ("בנייה מחדש")
    mutationFn: async ({ previous = null } = {}) => {
      const list = sourceList;
      if (!list?.items?.length) return;

      // The menu is fitted to the weekly budget (or a higher amount the user
      // accepted for this basket) before it is saved
      const result = await generateNutritionPlan({ list, profile, budget: basketBudget(profile, list), previous });
      // Nothing meaningfully different from the current menu: keep it, and say why
      if (result.alternative?.exhausted) return { exhausted: true };

      // Before / after, food against food: what all the user's receipts show they spend
      // on the food the menu replaces vs. the menu's purchase cost (src/lib/receiptClassifier.js)
      const [receipts, receiptItems] = await Promise.all([
        api.entities.Receipt.filter({ created_by: user.email }),
        api.entities.ReceiptItem.filter({ created_by: user.email }),
      ]);
      const spending = receiptSpending(receipts, receiptItems, { purchasesPerMonth: profile?.purchases_per_month || 4 });
      const comparison = spendingComparison({
        spending, monthlyBudget: profile?.monthly_budget,
        weeklyMenuCost: result.estimated_weekly_cost ?? list.total_estimated_cost ?? 0,
      });
      const previousHealthScore = profile?.health_score || 50;
      // New health score: based on avg health_score of shopping list items (scale 0-10 → 0-100)
      const itemHealthScores = list.items?.filter(i => i.health_score != null).map(i => i.health_score) || [];
      const avgItemHealth = itemHealthScores.length > 0
        ? itemHealthScores.reduce((a, b) => a + b, 0) / itemHealthScores.length
        : null;
      const newHealthScore = avgItemHealth != null
        ? Math.min(100, Math.round(avgItemHealth * 10))
        : Math.min(100, previousHealthScore + 10);

      const before_after = {
        ...comparison,
        previous_health_score: previousHealthScore,
        new_health_score: newHealthScore,
      };

      const plan = await api.entities.NutritionPlan.create({
        shopping_list_id: list.id,
        title: `תפריט תזונה — ${new Date().toLocaleDateString("he-IL")}`,
        daily_calories: profile?.daily_calories || 2000,
        weekly_calories: result.weekly_calories,
        estimated_weekly_cost: result.estimated_weekly_cost,
        status: "draft",
        days: result.days,
        before_after,
        budget: result.budget || {},
      });

      return { plan, alternative: result.alternative };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nutritionPlans"] });
      queryClient.invalidateQueries({ queryKey: [FLOW_QUERY_KEY] });
    },
  });

  // A plan that still uses products removed/replaced in step 2 is not shown —
  // it is rebuilt from the updated basket (automatically when coming from step 2)
  const showPlan = latestPlan;
  // The basket cannot meet the profile's targets — say so, and say why
  const sufficiency = sourceList?.items?.length && profile ? basketSufficiency(sourceList.items, profile) : { ok: true, issues: [] };
  const userWarnings = sourceList?.basket_warnings || [];
  const changedItems = [...new Set(userWarnings.map(w => w.item).filter(Boolean))];
  // Days the menu could not bring to every target with the basket as it is
  const shortDays = (showPlan?.days || []).filter(d => d.target_warnings?.length);
  // Menu quality: one validation of the whole week (src/lib/validateMenu.js) and its explanation
  const planItems = (planBasket || sourceList)?.items;
  const quality = showPlan?.days?.length && planItems?.length && profile
    ? explainMenu(validateMenu({ plan: showPlan, basketItems: planItems, profile, budget: basketBudget(profile, planBasket || sourceList) }),
      { plan: showPlan, basketItems: planItems, profile })
    : null;
  // Over budget: the basket's recommended cheaper swaps (the same calculation as the basket's budget card)
  const { data: savings } = useQuery({
    queryKey: ["menuSavings", showPlan?.id, planItems?.map(i => i.name).join("|")],
    queryFn: () => basketBudgetPicture({ basketItems: planItems, planDays: showPlan.days, profile, budget: basketBudget(profile, planBasket || sourceList) }),
    enabled: !!quality?.budgetAction,
    staleTime: 5 * 60 * 1000,
  });
  const planProtein = showPlan?.days?.length
    ? Math.round(showPlan.days.reduce((s, d) => s + (Number(d.total_protein) || 0), 0) / showPlan.days.length)
    : null;
  // One click from the basket: arriving with ?build=1 builds the menu right
  // away, unless the current menu was already built from this basket and is
  // still up to date. Runs once; the flag is dropped from the address.
  const autoBuilt = useRef(false);
  useEffect(() => {
    const flag = urlParams.get("build") === "1" || urlParams.get("rebuild") === "1";
    if (autoBuilt.current || !flag || flowLoading || !sourceList?.items?.length || !profile || generateMutation.isPending) return;
    autoBuilt.current = true;
    window.history.replaceState(null, "", window.location.pathname + (listId ? `?list_id=${listId}` : ""));
    if (planOutdated || !latestPlan || latestPlan.shopping_list_id !== sourceList.id) generateMutation.mutate();
  });
  const planDays = sortDays(showPlan?.days);
  const dailyTarget = showPlan?.daily_calories || profile?.daily_calories;
  const proteinTarget = profile?.protein_target;

  return (
    <div className="space-y-6">
      <FlowSteps current={3} completed={completed} />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold">תפריט תזונה שבועי</h1>
          <p className="text-sm text-muted-foreground">תפריט אישי מהמוצרים שבסל המוצרים החכם שלכם</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => generateMutation.mutate({ previous: showPlan && !planOutdated && showPlan.shopping_list_id === sourceList?.id ? showPlan : null })}
            disabled={generateMutation.isPending || !sourceList?.items?.length}
          >
            {generateMutation.isPending ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Sparkles className="w-4 h-4 ml-2" />}
            {showPlan ? "בנייה מחדש" : "בניית תפריט תזונה"}
          </Button>
        </div>
      </div>

      {!generateMutation.isPending && generateMutation.data?.exhausted && (
        <Card className="p-4 border-amber-200 bg-amber-50/60 text-sm text-amber-900">
          אין תפריט אחר ששונה באמת מהתפריט הנוכחי ועומד באותם יעדים — בסל אין מספיק מוצרים שונים.
          כדי לקבל תפריט אחר, הוסיפו לסל עוד מקור חלבון (ביצים, טונה, קטניות, עוף) או עוד סוג פחמימה.
        </Card>
      )}
      {!generateMutation.isPending && generateMutation.data?.alternative && (() => {
        const { index, of, name, wrapped } = generateMutation.data.alternative;
        return (
          <p className="text-xs text-muted-foreground">
            {wrapped
              ? `חזרנו לתפריט הראשון — עברת על כל ${of} התפריטים השונים שאפשר לבנות מהסל הזה.`
              : index > 0
                ? `תפריט חלופי ${index + 1} מתוך ${of} — ${ALTERNATIVE_LABELS[name] || "תפריט אחר"}.`
                : of > 1 ? `התפריט המומלץ (1 מתוך ${of}). "בנייה מחדש" תציג תפריט חלופי.` : null}
          </p>
        );
      })()}

      {generateMutation.isPending && (
        <Card className="p-10 text-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
          <h2 className="font-heading font-semibold text-lg">יוצרים את התפריט שלכם...</h2>
          <p className="text-sm text-muted-foreground">מייעלים ארוחות למטרות ולתקציב שלכם</p>
        </Card>
      )}

      {!showPlan && !sufficiency.ok && !generateMutation.isPending && (
        <Card className="p-4 border-amber-300 bg-amber-50/60 space-y-2">
          <p className="font-medium text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" />
            {shortDays.length > 0
              ? (sufficiency.ok && !changedItems.length
                ? `ב-${shortDays.length} מתוך ${showPlan.days.length} הימים התפריט יצא קרוב ליעדים, אבל לא בתוכם`
                : `התפריט נבנה מהמוצרים שיש בסל, אבל ב-${shortDays.length} מתוך ${showPlan.days.length} הימים לא הצלחנו לעמוד בכל היעדים`)
              : changedItems.length
                ? "התפריט לא יעמוד בכל היעדים שלך, כי לפי בחירתך הוסרו או הוחלפו מוצרים בסל"
                : "סל המוצרים הנוכחי לא מספיק כדי לבנות תפריט שעומד בכל היעדים שלך"}
          </p>
          {shortDays.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {changedItems.length
                ? "הסיבה: לפי בחירתך הוסרו או הוחלפו מוצרים בסל, ולכן חסרים בו מוצרים מסוגים מסוימים."
                : !sufficiency.ok
                  ? "הסיבה: בסל אין מספיק מזון מכל הסוגים לשבוע. הימים האלה מסומנים בתפריט, עם המספרים בפועל."
                  : "יש בסל מספיק מזון לשבוע — בימים האלה האיזון פשוט לא יצא מדויק. הימים מסומנים בתפריט עם המספרים בפועל, ואפשר לבנות את התפריט מחדש."}
            </p>
          )}
          {changedItems.length > 0 && (
            <p className="text-sm text-muted-foreground">שינויים שבחרת: {changedItems.join(", ")}</p>
          )}
          <ul className="text-sm text-muted-foreground list-disc pr-5 space-y-0.5">
            {sufficiency.issues.map(i => <li key={i.key}>{i.text}</li>)}
          </ul>
          {planProtein != null && proteinTarget && planProtein < proteinTarget * 0.9 && (
            <p className="text-sm text-muted-foreground">בתפריט הנוכחי: בממוצע {planProtein} גרם חלבון ביום, מתוך יעד של {proteinTarget} גרם.</p>
          )}
          {(!sufficiency.ok || changedItems.length > 0) && (
            <Button size="sm" variant="outline" onClick={() => navigate("/shopping-list")}>
              <ShoppingCart className="w-4 h-4 ml-2" /> חזרה לסל המוצרים להשלמה
            </Button>
          )}
        </Card>
      )}

      {generateMutation.isError && (
        <Card className="p-4 border-destructive/50 bg-destructive/5">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive mt-0.5" />
            <div>
              <p className="font-medium text-sm">יצירת התפריט נכשלה</p>
              <p className="text-xs text-muted-foreground mt-1">{generateMutation.error?.message}</p>
            </div>
          </div>
        </Card>
      )}

      {!generateMutation.isPending && !showPlan && (
        <Card className="p-10 text-center">
          <UtensilsCrossed className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
          <h2 className="font-heading font-semibold text-lg mb-2">{planOutdated ? "סל המוצרים עודכן" : "עדיין אין תפריט"}</h2>
          <p className="text-sm text-muted-foreground mb-6">
            {planOutdated
              ? "החלפת או הסרת מוצרים מאז שהתפריט נבנה. נבנה תפריט חדש מהמוצרים המעודכנים."
              : sourceList?.items?.length
              ? "נבנה תפריט שבועי אישי מהמוצרים שבסל המוצרים שלכם"
              : "כדי לבנות תפריט תזונה, קודם בונים סל מוצרים חכם."}
          </p>
          {sourceList?.items?.length ? (
            <Button onClick={() => generateMutation.mutate()}>
              <Sparkles className="w-4 h-4 ml-2" /> בניית תפריט תזונה
            </Button>
          ) : (
            <Button onClick={() => navigate("/shopping-list")}>
              <ShoppingCart className="w-4 h-4 ml-2" /> בניית סל מוצרים חכם
            </Button>
          )}
        </Card>
      )}

      {showPlan && !generateMutation.isPending && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title="יעד יומי" value={`${Number(dailyTarget || 0).toLocaleString()} קלוריות`} icon={Flame} color="orange" />
            <StatCard title="קלוריות שבועיות" value={showPlan.weekly_calories?.toLocaleString()} icon={Flame} color="red" />
            <StatCard title="עלות שבועית" value={formatCurrency(showPlan.estimated_weekly_cost)} icon={ShekelIcon} color="green" />
            <StatCard title="ימים מתוכננים" value={showPlan.days?.length || 0} icon={UtensilsCrossed} color="blue" />
          </div>

          <MenuQualityCard explanation={quality} savings={savings} onBasket={budget => navigate(budget ? "/shopping-list#budget" : "/shopping-list")} />

          {/* Day Tabs */}
          <Tabs key={showPlan.id} defaultValue={planDays[0]?.day_name} dir="rtl" className="w-full">
            <TabsList className="w-full flex overflow-x-auto">
              {planDays.map(day => (
                <TabsTrigger key={day.day_name} value={day.day_name} className="flex-1 text-xs sm:text-sm">
                  {dayLabel(day.day_name)}
                </TabsTrigger>
              ))}
            </TabsList>

            {planDays.map(day => {
              const status = targetStatus(day.total_calories, dailyTarget);
              return (
              <TabsContent key={day.day_name} value={day.day_name} className="mt-4 space-y-4">
                {day.target_warnings?.length > 0 && (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-50 text-amber-800 text-sm p-3">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium">ביום הזה לא הצלחנו לעמוד בכל היעדים עם המוצרים שבסל</p>
                      <ul className="list-disc pr-5 mt-1 space-y-0.5">
                        {day.target_warnings.map(w => <li key={w}>{w}</li>)}
                      </ul>
                    </div>
                  </div>
                )}
                {/* Day Summary */}
                <div className="grid grid-cols-4 gap-2">
                  <div className="p-3 rounded-lg bg-muted text-center">
                    <p className="text-xs text-muted-foreground">סה״כ</p>
                    <p className="font-heading font-bold">{Number(day.total_calories || 0).toLocaleString()} קלוריות</p>
                    {status && <p className={`text-[11px] mt-0.5 ${status.className}`}>{status.label}</p>}
                  </div>
                  <div className="p-3 rounded-lg bg-muted text-center">
                    <p className="text-xs text-muted-foreground">חלבון</p>
                    <p className="font-heading font-bold">{day.total_protein}ג</p>
                    {proteinTarget > 0 && (
                      <p className={`text-[11px] mt-0.5 ${day.total_protein < proteinTarget * 0.85 ? "text-amber-600" : "text-muted-foreground"}`}>
                        יעד {proteinTarget}ג{day.total_protein < proteinTarget * 0.85 ? " · מתחת ליעד" : ""}
                      </p>
                    )}
                  </div>
                  <div className="p-3 rounded-lg bg-muted text-center">
                    <p className="text-xs text-muted-foreground">פחמימות</p>
                    <p className="font-heading font-bold">{day.total_carbs}ג</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted text-center">
                    <p className="text-xs text-muted-foreground">שומן</p>
                    <p className="font-heading font-bold">{day.total_fat}ג</p>
                  </div>
                </div>

                {/* Meals */}
                {day.meals?.map(meal => {
                  const MealIcon = mealIcons[meal.meal_type] || UtensilsCrossed;
                  return (
                    <Card key={meal.meal_type} className="overflow-hidden">
                      <div className="p-4 border-b flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <MealIcon className="w-4 h-4 text-primary" />
                          <div>
                            <h3 className="font-heading font-semibold">{MEAL_LABELS[meal.meal_type] || meal.meal_type}</h3>
                            {meal.meal_name && <p className="text-sm text-muted-foreground">{meal.meal_name}</p>}
                          </div>
                        </div>
                        <div className="flex gap-3 text-xs text-muted-foreground">
                          <span>{meal.total_calories} קל'</span>
                          <span>ח:{meal.total_protein}ג</span>
                          <span>{formatCurrency(meal.estimated_cost)}</span>
                        </div>
                      </div>
                      <div className="p-4 space-y-2">
                        {meal.items?.map((item, i) => (
                          <div key={i} className="flex items-center justify-between py-1.5">
                            <div>
                              <p className="text-sm font-medium">{item.food_name}</p>
                              <p className="text-xs text-muted-foreground">{item.grams}ג</p>
                            </div>
                            <div className="text-left text-xs text-muted-foreground">
                              <p>{item.calories} קל'</p>
                              <p>ח:{item.protein}ג פ:{item.carbs}ג ש:{item.fat}ג</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  );
                })}
              </TabsContent>
              );
            })}
          </Tabs>

          <Card className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {finalList
                ? "סל הקניות הסופי כבר חושב לפי התפריט הזה."
                : "נחשב את הכמויות המדויקות הדרושות לכל השבוע לפי התפריט שבנינו."}
            </p>
            <Button onClick={() => navigate("/final-list")} className="rounded-full">
              {finalList ? "צפייה בסל הקניות הסופי" : "בניית סל קניות סופי"} <ChevronLeft className="w-4 h-4 mr-1" />
            </Button>
          </Card>
        </>
      )}
    </div>
  );
}