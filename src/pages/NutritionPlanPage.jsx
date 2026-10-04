import React from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/localAPI";
import { useAuth } from "@/lib/AuthContext";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import StatCard from "@/components/dashboard/StatCard";

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
  const { profile, basket: sourceList, plan: latestPlan, finalList, completed } = useFlowData(user, { listId });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const list = sourceList;
      if (!list?.items?.length) return;

      const result = await generateNutritionPlan({ list, profile });

      // Calculate before_after from real user data
      const purchasesPerMonth = profile?.purchases_per_month || 4;
      const listCost = list.total_estimated_cost || 0;
      // "Before" = what they actually spend monthly (their stated monthly budget)
      const previousMonthlySpending = profile?.monthly_budget || (listCost * purchasesPerMonth);
      // "After" = the new optimized shopping list cost × purchases per month
      const estimatedNewMonthlySpending = listCost * purchasesPerMonth;
      const monthlySavings = Math.max(0, previousMonthlySpending - estimatedNewMonthlySpending);
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
        previous_monthly_spending: Math.round(previousMonthlySpending),
        estimated_new_monthly_spending: Math.round(estimatedNewMonthlySpending),
        monthly_savings: Math.round(monthlySavings),
        yearly_savings: Math.round(monthlySavings * 12),
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
      });

      return plan;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nutritionPlans"] });
      queryClient.invalidateQueries({ queryKey: [FLOW_QUERY_KEY] });
    },
  });

  const showPlan = latestPlan;
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
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending || !sourceList?.items?.length}
          >
            {generateMutation.isPending ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Sparkles className="w-4 h-4 ml-2" />}
            {showPlan ? "בנייה מחדש" : "בניית תפריט תזונה"}
          </Button>
        </div>
      </div>

      {generateMutation.isPending && (
        <Card className="p-10 text-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
          <h2 className="font-heading font-semibold text-lg">יוצרים את התפריט שלכם...</h2>
          <p className="text-sm text-muted-foreground">מייעלים ארוחות למטרות ולתקציב שלכם</p>
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
          <h2 className="font-heading font-semibold text-lg mb-2">עדיין אין תפריט</h2>
          <p className="text-sm text-muted-foreground mb-6">
            {sourceList?.items?.length
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