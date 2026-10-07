import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, Loader2, TrendingDown, Repeat2 } from "lucide-react";
import { basketBudgetPicture } from "@/lib/basketBudget";

const shekel = n => `₪${(Math.round(n * 10) / 10).toLocaleString("he-IL")}`;
const grams = g => (g >= 1000 ? `${Math.round(g / 100) / 10} ק"ג` : `${Math.round(g)} גרם`);

const IMPACT = {
  protein: ["חלבון דומה", "יותר חלבון", "פחות חלבון"],
  fat: ["שומן דומה", "יותר שומן", "פחות שומן"],
  kcal: ["קלוריות דומות", "יותר קלוריות", "פחות קלוריות"],
};
const impactText = impact => ["protein", "fat", "kcal"]
  .map(k => IMPACT[k][impact[k] === 0 ? 0 : impact[k] > 0 ? 1 : 2]).join(" · ");

/**
 * "השפעה על התקציב": the products that cost the most this week, why, what can
 * replace them (same kind of food) and how much each replacement saves at the
 * same nutrition — and whether the budget is reachable with such swaps at all.
 * All numbers come from src/lib/basketBudget.js (deterministic).
 */
export default function BudgetImpactCard({ basketItems, planDays, profile, budget, onReplace, saving, menuOutdated }) {
  const { data: pic, isLoading } = useQuery({
    queryKey: ["basketBudget", basketItems.map(i => `${i.name}:${i.estimated_price}`).join("|"), planDays ? JSON.stringify(planDays).length : 0, budget, profile?.id],
    queryFn: () => basketBudgetPicture({ basketItems, planDays, profile, budget }),
    enabled: basketItems.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading || !pic) {
    return (
      <Card id="budget" className="p-4 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> מחשבים את העלות השבועית ואת החלופות הזולות...
      </Card>
    );
  }

  const fromMenu = pic.source === "menu";
  const over = pic.over > 0;
  return (
    <Card id="budget" className={`p-4 space-y-3 ${over ? "border-amber-300 bg-amber-50/40" : ""}`}>
      <div>
        <h2 className="font-heading font-semibold flex items-center gap-2">
          {over ? <AlertCircle className="w-4 h-4 text-amber-600" /> : <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
          השפעה על התקציב
        </h2>
        <p className="text-sm mt-1">
          {fromMenu ? "עלות השבוע לפי התפריט" : "עלות המוצרים בסל"}: <strong>{shekel(pic.total)}</strong>
          {budget > 0 && <> · תקציב שבועי {shekel(budget)}</>}
          {over ? <> · <span className="text-amber-700 font-medium">חריגה של {shekel(pic.over)}</span></> : budget > 0 && <> · <span className="text-emerald-700">בתוך התקציב</span></>}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {fromMenu
            ? "העלות מחושבת לפי הכמות שהתפריט צריך מכל מוצר השבוע — אותו חישוב של סל הקניות הסופי."
            : menuOutdated
              ? "הסל השתנה מאז שהתפריט נבנה — אלה מחירי המוצרים עצמם. אחרי בניית התפריט מחדש נראה את העלות לפי הכמויות בפועל."
              : "אלה מחירי המוצרים עצמם. אחרי בניית התפריט נראה את העלות לפי הכמויות שהתפריט צריך."}
        </p>
      </div>

      {pic.drivers.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">{over ? "המוצרים שמגדילים את העלות הכי הרבה:" : "המוצרים היקרים ביותר בסל:"}</p>
          {pic.drivers.map(d => (
            <div key={d.index} className="rounded-lg border bg-background p-3 space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm">
                  <span className="font-medium">{d.item.name}</span> — {shekel(d.cost)} השבוע
                  <span className="text-muted-foreground"> ({Math.round(d.share * 100)}% מהעלות)</span>
                </p>
                {d.item.price_per_kg > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {shekel(d.item.price_per_kg)} {/ליטר|מ"ל/.test(String(d.item.quantity)) ? "לליטר" : "לק\"ג"}
                    {d.usedGrams > 0 && fromMenu && <> · התפריט צריך {grams(d.usedGrams)}</>}
                  </span>
                )}
              </div>
              {d.options.length > 0 ? (
                <ul className="space-y-1.5">
                  {d.options.map(o => (
                    <li key={o.option.product.product_id} className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-md bg-muted/50 p-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm">
                          {o.option.product.original_product_name}
                          <Badge variant="outline" className="mr-2 text-[10px] border-emerald-300 text-emerald-700">
                            <TrendingDown className="w-3 h-3 ml-1" /> חיסכון {shekel(o.saving)}
                          </Badge>
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {shekel(o.cost)} לאותה כמות תזונתית · {impactText(o.impact)}
                        </p>
                      </div>
                      <Button size="sm" variant="outline" className="min-h-8 shrink-0" disabled={saving}
                        onClick={() => onReplace(d.index, o.option)}>
                        <Repeat2 className="w-3.5 h-3.5 ml-1" /> להחליף
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">אין בקטלוג חלופה זולה יותר מאותו סוג שמתאימה לתזונה שלך.</p>
              )}
            </div>
          ))}
        </div>
      )}

      {over && (
        pic.reachable ? (
          <p className="text-sm text-emerald-800 bg-emerald-50 rounded-md p-2">
            עם ההחלפות המומלצות הסל יכול לרדת עד כ-{shekel(pic.bestTotal)} — בתוך התקציב השבועי.
          </p>
        ) : (
          <p className="text-sm text-amber-900 bg-amber-100/70 rounded-md p-2">
            הסל הנוכחי יכול לרדת לכל היותר בכ-{shekel(pic.maxSaving)} (לכ-{shekel(pic.bestTotal)}) בלי לפגוע ביעדים התזונתיים —
            עדיין {shekel(pic.bestTotal - budget)} מעל התקציב. כדי לרדת עוד צריך להוריד את יעד החלבון, להגדיל את התקציב,
            או להחליף מוצרים בסוג מזון אחר (למשל בשר בקטניות או בביצים).
          </p>
        )
      )}
    </Card>
  );
}
