import React from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2, ShoppingCart, Wallet } from "lucide-react";
import { formatCurrency } from "@/lib/calculations";
import { historyNote } from "@/lib/budgetModel";

const STATUS = {
  within: { card: "border-emerald-200", icon: CheckCircle2, color: "text-emerald-600" },
  over: { card: "border-amber-300 bg-amber-50/40", icon: AlertCircle, color: "text-amber-600" },
  unrealistic: { card: "border-red-300 bg-red-50/40", icon: AlertCircle, color: "text-red-600" },
};

/**
 * The week's budget, the same everywhere (src/lib/budgetModel.js budgetPicture):
 * the supermarket budget from the profile, the household reserve from receipt
 * history, the food budget left, the week's food cost and the status — then the
 * receipt history as context only. basketCost: the basket page's own number
 * (one pack of each product), explained beside the week's cost.
 */
export default function BudgetSummaryCard({ pic, costLabel = "עלות המזון לשבוע לפי התפריט", basketCost = null, onBasket }) {
  if (!pic || pic.planned_food_cost == null) return null;
  const s = STATUS[pic.status] || STATUS.within;
  const Icon = s.icon;
  const h = pic.history;
  // One big number per box, the way the old before / after card showed them
  const box = (label, value, note, tone = "bg-muted/60 border-border", valueColor = "") => (
    <div className={`p-3 rounded-xl border text-center ${tone}`}>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-xl font-heading font-bold ${valueColor}`}>{value}</p>
      {note && <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{note}</p>}
    </div>
  );
  const statusBox = pic.status === "within"
    ? box("נשאר בתקציב המזון", formatCurrency(pic.left), "לשבוע", "bg-emerald-50 border-emerald-200", "text-emerald-600")
    : pic.status === "over"
      ? box("מעל תקציב המזון", formatCurrency(pic.over_by), "לשבוע", "bg-amber-50 border-amber-300", "text-amber-700")
      : box("תקציב למזון", "אין", "השמירה למוצרים שאינם מזון גדולה מהתקציב", "bg-red-50 border-red-300", "text-red-600");
  return (
    <Card className={`p-4 space-y-4 ${s.card}`} data-testid="budget-summary">
      <h2 className="font-heading font-semibold flex items-center gap-2">
        <Wallet className="w-4 h-4 text-primary" /> תקציב השבוע
      </h2>

      {/* The key numbers, at a glance */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {box("תקציב הסופר השבועי", formatCurrency(pic.weekly_total_budget), "מהפרופיל — כל הקנייה בסופר")}
        {box("שמור למוצרים שאינם מזון", pic.household_reserve > 0 ? `− ${formatCurrency(pic.household_reserve)}` : formatCurrency(0),
          pic.household_reserve > 0 ? "ניקיון, היגיינה ובית" : h.receipts_counted ? "לא נמצאו בקבלות" : "אין עדיין קבלות")}
        {box("תקציב המזון לשבוע", formatCurrency(pic.available_food_budget),
          pic.accepted_override ? "סכום שאישרת לסל הזה" : "תקציב הסופר פחות השמירה", "bg-primary/5 border-primary/30", "text-primary")}
        {box(costLabel, formatCurrency(pic.planned_food_cost), null, "bg-sky-50 border-sky-200", "text-sky-700")}
        <div className="col-span-2 sm:col-span-1">{statusBox}</div>
      </div>

      {/* What the numbers mean */}
      <div className="space-y-1.5 text-xs text-muted-foreground">
        <p>
          {pic.household_reserve > 0
            ? "מוצרי ניקיון, היגיינה ובית מהקבלות שלך לא נכנסים לתפריט ולרשימת הקניות — שמרנו להם מקום בתקציב, ולכן התפריט נמדד מול תקציב המזון."
            : h.receipts_counted
              ? "בקבלות לא נמצאו מוצרים שאינם מזון, ולכן לא הופחתה שמירה — התפריט נמדד מול כל תקציב הסופר."
              : "עדיין אין קבלות, ולכן לא הופחתה שמירה למוצרים שאינם מזון — התפריט נמדד מול כל תקציב הסופר."}
        </p>
      </div>

      <p className={`text-sm font-medium flex items-start gap-2 ${s.color}`}>
        <Icon className="w-4 h-4 mt-0.5 shrink-0" />
        {pic.status === "within" && <>בתוך תקציב המזון — נשארו {formatCurrency(pic.left)} לשבוע.</>}
        {pic.status === "over" && <>{formatCurrency(pic.over_by)} מעל תקציב המזון ({formatCurrency(pic.available_food_budget)})
          {pic.household_reserve > 0 ? `, שהוא תקציב הסופר (${formatCurrency(pic.weekly_total_budget)}) פחות השמירה למוצרים שאינם מזון.` : "."}</>}
        {pic.status === "unrealistic" && <>אחרי השמירה למוצרים שאינם מזון לא נשאר תקציב למזון — כדאי לעדכן את התקציב בפרופיל.</>}
      </p>
      {pic.status === "over" && onBasket && (
        <Button variant="outline" size="sm" onClick={onBasket}><ShoppingCart className="w-4 h-4 ml-2" /> לחלופות זולות יותר בסל</Button>
      )}
      {basketCost != null && (
        <p className="text-xs text-muted-foreground">
          בעמוד הסל מוצגת עלות המוצרים בסל ({formatCurrency(basketCost)}): מחיר אריזה אחת מכל מוצר שנבחר. כאן העלות היא מה שצריך לקנות
          כדי לבשל את כל ארוחות השבוע לפי התפריט — לכן שני המספרים שונים.
        </p>
      )}
      <div className="rounded-md bg-muted/50 p-2.5 text-xs space-y-1" data-testid="receipt-history">
        <p className="font-medium">היסטוריית הקבלות — לעיון בלבד, לא יעד התקציב</p>
        {h.receipts_counted > 0 ? (
          <p className="text-muted-foreground">
            בשבוע, בממוצע: מזון שמתאים לתפריט {formatCurrency(h.food_plannable)}, מזון אחר (חטיפים, משקאות, תבלינים) {formatCurrency(h.food_non_plannable)},
            מוצרים שאינם מזון {formatCurrency(h.non_food)} — סה״כ {formatCurrency(h.total)}.
          </p>
        ) : null}
        <p className="text-muted-foreground">{historyNote(h)}</p>
      </div>
    </Card>
  );
}
