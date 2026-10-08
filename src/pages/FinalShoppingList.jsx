import React, { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/localAPI";
import { useAuth } from "@/lib/AuthContext";
import { useFlowData, FLOW_QUERY_KEY } from "@/lib/flowData";
import { buildFinalShoppingList, weeklyUsageLabel } from "@/lib/shoppingOptimizer";
import { formatCurrency } from "@/lib/calculations";
import FlowSteps from "@/components/FlowSteps";
import StatCard from "@/components/dashboard/StatCard";
import BudgetNotice from "@/components/BudgetNotice";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, ShoppingCart, ChevronLeft, AlertCircle, UtensilsCrossed, Info } from "lucide-react";

const ShekelIcon = ({ className }) => (
  <span className={`${className} flex items-center justify-center font-bold`} style={{ fontSize: '0.9rem' }}>₪</span>
);

const CATEGORY_LABELS = {
  protein: "חלבון", carb: "פחמימה", fat: "שומן",
  vegetable: "ירק", fruit: "פרי", dairy: "חלבי",
  snack: "חטיף", drink: "שתייה", other: "אחר",
};

export default function FinalShoppingList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { plan, planOutdated, planIncomplete, planBasket, finalList, completed, isLoading } = useFlowData(user);

  const buildMutation = useMutation({
    mutationFn: async () => {
      const { items, total_estimated_cost } = buildFinalShoppingList(planBasket.items, plan.days);
      return api.entities.ShoppingList.create({
        receipt_id: planBasket.receipt_id || "",
        nutrition_plan_id: plan.id,
        title: `סל קניות סופי — ${new Date().toLocaleDateString("he-IL")}`,
        shopping_period_days: plan.days.length,
        total_estimated_cost,
        total_calories: plan.weekly_calories,
        status: "final",
        items,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [FLOW_QUERY_KEY] }),
  });

  // Step 4 runs automatically once per plan: no final list yet → calculate and save it
  const startedFor = useRef(null);
  useEffect(() => {
    if (isLoading || finalList || !plan?.days?.length || !planBasket?.items?.length) return;
    if (startedFor.current === plan.id) return;
    startedFor.current = plan.id;
    buildMutation.mutate();
  }, [isLoading, finalList, plan, planBasket, buildMutation]);

  const unused = finalList && planBasket
    ? planBasket.items.filter(b => !finalList.items?.some(i => i.name === b.name)).map(b => b.name)
    : [];

  return (
    <div className="space-y-6">
      <FlowSteps current={4} completed={completed} />

      <div>
        <h1 className="font-heading text-2xl font-bold">סל הקניות הסופי</h1>
        <p className="text-sm text-muted-foreground">הכמויות חושבו לפי התפריט השבועי שלך.</p>
      </div>

      {!isLoading && !plan?.days?.length && (
        <Card className="p-10 text-center">
          <UtensilsCrossed className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
          <h2 className="font-heading font-semibold text-lg mb-2">{planIncomplete ? "התפריט השמור לא שלם" : planOutdated ? "סל המוצרים עודכן" : "עדיין אין תפריט שבועי"}</h2>
          <p className="text-sm text-muted-foreground mb-6">
            {planIncomplete
              ? "בתפריט שנשמר חסרות ארוחות בחלק מהימים. קודם בונים את התפריט מחדש, ואז נחשב את סל הקניות."
              : planOutdated
              ? "החלפת או הסרת מוצרים מאז שהתפריט נבנה. קודם בונים את התפריט מחדש, ואז נחשב את סל הקניות."
              : "את סל הקניות הסופי מחשבים לפי התפריט. קודם בונים תפריט תזונה."}
          </p>
          <Button onClick={() => navigate(planOutdated || planIncomplete ? "/nutrition-plan?rebuild=1" : "/nutrition-plan")}>בניית תפריט תזונה</Button>
        </Card>
      )}

      {!isLoading && plan?.days?.length > 0 && !finalList && !planBasket?.items?.length && (
        <Card className="p-10 text-center">
          <ShoppingCart className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
          <h2 className="font-heading font-semibold text-lg mb-2">לא נמצא סל המוצרים של התפריט</h2>
          <p className="text-sm text-muted-foreground mb-6">בנו סל מוצרים חכם ותפריט חדש כדי לחשב את סל הקניות הסופי.</p>
          <Button onClick={() => navigate("/shopping-list")}>לסל המוצרים</Button>
        </Card>
      )}

      {(isLoading || buildMutation.isPending || (!finalList && plan?.days?.length > 0 && planBasket?.items?.length > 0 && !buildMutation.isError)) && (
        <Card className="p-10 text-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
          <h2 className="font-heading font-semibold text-lg">מחשבים את סל הקניות הסופי...</h2>
          <p className="text-sm text-muted-foreground">סוכמים את הכמויות של כל מוצר לאורך השבוע וממירים לכמויות קנייה</p>
        </Card>
      )}

      {buildMutation.isError && (
        <Card className="p-4 border-destructive/50 bg-destructive/5">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-sm">לא הצלחנו לחשב את סל הקניות הסופי</p>
              <p className="text-xs text-muted-foreground mt-1">{buildMutation.error?.message}</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => buildMutation.mutate()}>ניסיון נוסף</Button>
            </div>
          </div>
        </Card>
      )}

      {finalList && !buildMutation.isPending && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <StatCard title="עלות משוערת לשבוע" value={formatCurrency(finalList.total_estimated_cost)} icon={ShekelIcon} color="green" />
            <StatCard title="מוצרים לקנייה" value={finalList.items?.length || 0} icon={ShoppingCart} color="blue" />
          </div>

          {/* The same check the menu passed: this list is that menu's purchase cost */}
          <BudgetNotice
            budget={plan?.budget?.weekly_budget > 0 ? {
              ...plan.budget,
              estimated_cost: finalList.total_estimated_cost,
              fits: finalList.total_estimated_cost <= plan.budget.weekly_budget,
              over_by: Math.max(0, Math.round((finalList.total_estimated_cost - plan.budget.weekly_budget) * 10) / 10),
            } : null}
            onBasket={() => navigate("/shopping-list#budget")}
          />

          <Card className="overflow-hidden">
            <div className="p-4 border-b flex items-center justify-between">
              <h2 className="font-heading font-semibold">מה לקנות השבוע</h2>
              <Badge variant="secondary">ל-{finalList.shopping_period_days} ימים</Badge>
            </div>
            <p className="px-4 pt-3 text-xs text-muted-foreground">
              הסל מחושב לשבוע שלם, לפי התפריט השבועי. אם אתם קונים יותר מפעם בשבוע, אפשר לחלק אותו בין הביקורים.
            </p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>מוצר</TableHead>
                    <TableHead>קטגוריה</TableHead>
                    <TableHead>שימוש בתפריט</TableHead>
                    <TableHead>כמות לקנייה</TableHead>
                    <TableHead>מחיר משוער</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {finalList.items?.map((item, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium text-sm">{item.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{CATEGORY_LABELS[item.category] || item.category}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{weeklyUsageLabel(item)}</TableCell>
                      <TableCell className="text-sm font-semibold">{item.quantity}</TableCell>
                      <TableCell className="text-sm">{formatCurrency(item.estimated_price)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="p-4 border-t flex justify-between text-sm font-semibold">
              <span>סה״כ משוער</span>
              <span>{formatCurrency(finalList.total_estimated_cost)}</span>
            </div>
          </Card>

          {unused.length > 0 && (
            <Card className="p-4 bg-muted/50 border-0">
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <p>מוצרים מסל המוצרים שלא נכנסו לתפריט ולכן לא נוספו לסל הסופי: {unused.join(", ")}</p>
              </div>
            </Card>
          )}

          <div className="flex justify-start">
            <Button onClick={() => navigate("/results")} className="rounded-full">
              הצגת התוכנית הסופית <ChevronLeft className="w-4 h-4 mr-1" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
