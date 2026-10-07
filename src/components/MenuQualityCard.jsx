import React from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Info, AlertCircle, XCircle, ShoppingCart, Plus } from "lucide-react";

const STYLE = {
  good: { card: "border-emerald-300 bg-emerald-50/50", icon: CheckCircle2, color: "text-emerald-600", badge: "bg-emerald-100 text-emerald-800" },
  info: { card: "border-sky-300 bg-sky-50/50", icon: Info, color: "text-sky-600", badge: "bg-sky-100 text-sky-800" },
  warn: { card: "border-amber-300 bg-amber-50/60", icon: AlertCircle, color: "text-amber-600", badge: "bg-amber-100 text-amber-800" },
  bad: { card: "border-red-300 bg-red-50/60", icon: XCircle, color: "text-red-600", badge: "bg-red-100 text-red-800" },
};
const AREA_LABELS = {
  coverage: "מה חסר בסל", safety: "בטיחות", realism: "ארוחות", budget: "תקציב",
  nutrition: "תזונה", variety: "מגוון", summary: "סיכום",
};

/**
 * One card that says how good the week's menu is and why — the output of
 * explainMenu(validateMenu(...)): level, headline, the reasons by area, what
 * to add to the basket, and the way to the basket's budget card.
 */
export default function MenuQualityCard({ explanation, onBasket }) {
  if (!explanation) return null;
  const s = STYLE[explanation.tone] || STYLE.info;
  const Icon = s.icon;
  return (
    <Card className={`p-4 space-y-3 ${s.card}`}>
      <div className="flex items-start gap-2">
        <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${s.color}`} />
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading font-semibold">{explanation.title}</h2>
            <Badge className={`text-[11px] ${s.badge}`}>רמה {explanation.level} מתוך 4</Badge>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            1 — מגוון, בתקציב ועומד ביעדים · 2 — מגוון מוגבל · 3 — חסר ביעדים או בתקציב · 4 — חסרים מוצרים בסיסיים
          </p>
        </div>
      </div>

      {explanation.points.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {explanation.points.map((p, i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 text-xs font-medium text-muted-foreground w-16">{AREA_LABELS[p.area] || ""}</span>
              <span>{p.text}</span>
            </li>
          ))}
        </ul>
      )}

      {explanation.add.length > 0 && (
        <div className="text-sm">
          <p className="font-medium mb-1">כדי לשפר את התפריט, כדאי להוסיף לסל:</p>
          <div className="flex flex-wrap gap-1.5">
            {explanation.add.map(a => (
              <Badge key={a} variant="outline" className="text-xs bg-background"><Plus className="w-3 h-3 ml-1" />{a}</Badge>
            ))}
          </div>
        </div>
      )}

      {onBasket && (explanation.budgetAction || explanation.add.length > 0) && (
        <Button size="sm" variant="outline" onClick={() => onBasket(explanation.budgetAction)}>
          <ShoppingCart className="w-4 h-4 ml-2" />
          {explanation.budgetAction ? "לסל — חלופות זולות יותר" : "לסל המוצרים"}
        </Button>
      )}
    </Card>
  );
}
