import React from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2, ShoppingCart } from "lucide-react";
import { formatCurrency } from "@/lib/calculations";

/**
 * The menu's budget check (plan.budget, from src/lib/mealPlanBudget.js):
 * within budget — one line (and the cheaper swaps made to get there);
 * over budget — what it costs, by how much, and the products that cost the most.
 * Plans built before the check have no budget and show nothing.
 */
export default function BudgetNotice({ budget, onBasket }) {
  if (!budget || !(budget.weekly_budget > 0) || budget.estimated_cost == null) return null;
  const swapped = [...new Map((budget.swaps || []).map(s => [`${s.from}>${s.to}`, s])).values()];

  if (budget.fits) {
    return (
      <div className="flex items-start gap-2 rounded-lg bg-emerald-50 text-emerald-800 text-sm p-3">
        <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          <p>
            עלות התפריט לשבוע: <strong>{formatCurrency(budget.estimated_cost)}</strong> — בתוך התקציב השבועי שלך ({formatCurrency(budget.weekly_budget)}).
          </p>
          {swapped.length > 0 && (
            <p className="text-xs mt-1">
              כדי לעמוד בתקציב, {budget.swaps.length === 1 ? "מנה אחת הוחלפה" : `${budget.swaps.length} מנות הוחלפו`} במוצר זול יותר מהסל
              {" "}({swapped.slice(0, 3).map(s => `${s.from} ← ${s.to}`).join(", ")}).
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card className="p-4 border-amber-300 bg-amber-50/60 space-y-2">
      <p className="font-medium text-sm flex items-start gap-2">
        <AlertCircle className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" />
        עלות התפריט לשבוע: {formatCurrency(budget.estimated_cost)} — {formatCurrency(budget.over_by)} מעל התקציב השבועי שלך ({formatCurrency(budget.weekly_budget)})
      </p>
      <p className="text-sm text-muted-foreground">
        {swapped.length
          ? "החלפנו מנות במוצרים הזולים שבסל, ועדיין המוצרים בסל יקרים מדי כדי לעמוד ביעדים התזונתיים בתקציב הזה."
          : "בסל אין מוצרים זולים יותר מאותו סוג שיכולים להחליף את היקרים בלי לפגוע ביעדים התזונתיים."}
      </p>
      {budget.top_costs?.length > 0 && (
        <p className="text-sm text-muted-foreground">
          המוצרים היקרים ביותר השבוע: {budget.top_costs.map(c => `${c.name} (${formatCurrency(c.cost)})`).join(", ")}
        </p>
      )}
      {onBasket && (
        <Button size="sm" variant="outline" onClick={onBasket}>
          <ShoppingCart className="w-4 h-4 ml-2" /> החלפת מוצרים יקרים בסל
        </Button>
      )}
    </Card>
  );
}
