import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, Loader2, TrendingDown, Repeat2, X, Sparkles } from "lucide-react";
import { basketBudgetPicture, replacementNote } from "@/lib/basketBudget";

const shekel = n => `₪${(Math.round(n * 10) / 10).toLocaleString("he-IL")}`;
const grams = g => (g >= 1000 ? `${Math.round(g / 100) / 10} ק"ג` : `${Math.round(g)} גרם`);

const IMPACT = {
  protein: ["חלבון דומה", "יותר חלבון", "פחות חלבון"],
  fat: ["שומן דומה", "יותר שומן", "פחות שומן"],
  kcal: ["קלוריות דומות", "יותר קלוריות", "פחות קלוריות"],
};
const impactText = impact => ["protein", "fat", "kcal"]
  .map(k => IMPACT[k][impact[k] === 0 ? 0 : impact[k] > 0 ? 1 : 2]).join(" · ");
const optionKey = (index, o) => `${index}:${o.option.product.product_id}`;

function OptionRow({ index, o, broad, saving, onReplace, onDismiss }) {
  return (
    <li className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-md bg-muted/50 p-2">
      <div className="flex-1 min-w-0">
        <p className="text-sm">
          {o.option.product.original_product_name}
          <Badge variant="outline" className="mr-2 text-[10px] border-emerald-300 text-emerald-700">
            <TrendingDown className="w-3 h-3 ml-1" /> חיסכון {shekel(o.saving)}
          </Badge>
          {broad && <Badge variant="outline" className="mr-1 text-[10px]">סוג מזון אחר</Badge>}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {shekel(o.cost)} לאותה כמות תזונתית · {impactText(o.impact)}
        </p>
      </div>
      <div className="flex gap-1.5 shrink-0">
        <Button size="sm" variant="outline" className="min-h-8" disabled={saving} onClick={() => onReplace(index, o.option)}>
          <Repeat2 className="w-3.5 h-3.5 ml-1" /> להחליף
        </Button>
        <Button size="sm" variant="ghost" className="min-h-8 text-muted-foreground" onClick={onDismiss} title="לא מתאים לי">
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    </li>
  );
}

/**
 * "השפעה על התקציב": finds the products that drive the cost this week, says
 * why each matters, suggests cheaper alternatives of the same kind (and, on
 * request, of another kind in the same role) with the weekly saving at the same
 * nutrition and the nutrition change — to approve one by one, all at once, or
 * reject — and says whether the budget can be reached with such swaps.
 * All numbers come from src/lib/basketBudget.js (deterministic).
 */
export default function BudgetImpactCard({ basketItems, planDays, profile, budget, onReplace, onReplaceMany, saving, menuOutdated }) {
  const [dismissed, setDismissed] = useState(() => new Set());
  const [showBroad, setShowBroad] = useState(false);
  const { data: pic, isLoading } = useQuery({
    queryKey: ["basketBudget", basketItems.map(i => `${i.name}:${i.estimated_price}`).join("|"), planDays ? JSON.stringify(planDays).length : 0, budget, profile?.id],
    queryFn: () => basketBudgetPicture({ basketItems, planDays, profile, budget }),
    enabled: basketItems.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading || !pic) {
    return (
      <Card id="budget" className="p-4 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> מחשבים את העלות השבועית ומחפשים חלופות זולות...
      </Card>
    );
  }

  const fromMenu = pic.source === "menu";
  const over = pic.over > 0;
  const dismiss = key => setDismissed(prev => new Set(prev).add(key));
  const visible = (index, list) => list.filter(o => !dismissed.has(optionKey(index, o)));
  // "Apply all": the recommended swaps the user has not rejected
  const recommended = pic.recommended.swaps.filter(s => !dismissed.has(optionKey(s.index, s.choice)));
  const recommendedSaving = recommended.reduce((s, r) => s + r.choice.saving, 0);

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

      {over && recommended.length > 0 && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 space-y-2">
          <p className="text-sm font-medium text-emerald-900 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4" /> ההמלצה שלנו: {recommended.length === 1 ? "החלפה אחת" : `${recommended.length} החלפות`} שחוסכות כ-{shekel(recommendedSaving)} בשבוע
          </p>
          <ul className="text-xs text-emerald-900 list-disc pr-5 space-y-0.5">
            {recommended.map(r => (
              <li key={r.index}>{r.name} ← {r.choice.option.product.original_product_name} (חיסכון {shekel(r.choice.saving)}, {impactText(r.choice.impact)})</li>
            ))}
          </ul>
          <Button size="sm" disabled={saving} onClick={() => onReplaceMany(recommended.map(r => ({ index: r.index, option: r.choice.option })))}>
            לאשר את ההחלפות
          </Button>
        </div>
      )}

      {pic.drivers.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">{over ? "המוצרים שמגדילים את העלות הכי הרבה:" : "המוצרים היקרים ביותר בסל:"}</p>
          {pic.drivers.map(d => {
            const safe = visible(d.index, d.options);
            const note = replacementNote(d);
            // no cheaper product of the same kind → the cheaper ones of another kind are shown right away
            const broad = showBroad || note.kind === "broad_only" ? visible(d.index, d.broadOptions) : [];
            return (
              <div key={d.index} className="rounded-lg border bg-background p-3 space-y-2">
                <div>
                  <p className="text-sm">
                    <span className="font-medium">{d.item.name}</span> — {shekel(d.cost)} השבוע
                    {d.usedGrams > 0 && fromMenu && <span className="text-muted-foreground"> (התפריט צריך {grams(d.usedGrams)})</span>}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">למה זה משמעותי: {d.reasons.join(" · ")}</p>
                </div>
                {note.kind === "broad_only" && broad.length > 0 && <p className="text-xs text-muted-foreground">{note.text}</p>}
                {safe.length > 0 || broad.length > 0 ? (
                  <ul className="space-y-1.5">
                    {safe.map(o => (
                      <OptionRow key={optionKey(d.index, o)} index={d.index} o={o} saving={saving}
                        onReplace={onReplace} onDismiss={() => dismiss(optionKey(d.index, o))} />
                    ))}
                    {broad.map(o => (
                      <OptionRow key={optionKey(d.index, o)} index={d.index} o={o} broad saving={saving}
                        onReplace={onReplace} onDismiss={() => dismiss(optionKey(d.index, o))} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {note.kind === "none" ? note.text : "החלופות שהוצגו הוסתרו."}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {over && (
        pic.reachable ? (
          <p className="text-sm text-emerald-800 bg-emerald-50 rounded-md p-2">
            בהחלפות בטוחות (אותו סוג מזון) הסל יכול לרדת עד כ-{shekel(pic.bestTotal)} — בתוך התקציב השבועי.
          </p>
        ) : (
          <div className="text-sm text-amber-900 bg-amber-100/70 rounded-md p-2 space-y-2">
            <p>
              בהחלפות בטוחות אפשר לחסוך רק כ-{shekel(pic.maxSaving)} (לכ-{shekel(pic.bestTotal)}, עדיין {shekel(pic.bestTotal - budget)} מעל התקציב).
              כדי לחסוך יותר: להוריד את יעד החלבון, להגדיל את התקציב, או לאפשר החלפות נרחבות יותר — מוצר מסוג מזון אחר באותו תפקיד (למשל בשר בקטניות או בביצים).
            </p>
            {!showBroad && pic.drivers.some(d => d.broadOptions.length) && (
              <Button size="sm" variant="outline" onClick={() => setShowBroad(true)}>להציג החלפות נרחבות יותר</Button>
            )}
            {showBroad && (
              <p className="text-xs">
                {pic.reachableBroad
                  ? `עם החלפות נרחבות הסל יכול לרדת עד כ-${shekel(pic.bestBroadTotal)} — בתוך התקציב.`
                  : `גם עם החלפות נרחבות הסל יורד לכ-${shekel(pic.bestBroadTotal)} בלבד — כדי לעמוד בתקציב צריך להוריד את יעד החלבון או להגדיל את התקציב.`}
              </p>
            )}
          </div>
        )
      )}
    </Card>
  );
}
