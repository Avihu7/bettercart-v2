import React from "react";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";

const STEPS = [
  { label: "קבלה", path: "/upload" },
  { label: "סל מוצרים", path: "/shopping-list" },
  { label: "תפריט שבועי", path: "/nutrition-plan" },
  { label: "סל סופי", path: "/final-list" },
];

/**
 * Lightweight RTL step indicator for the 4-step flow.
 * `current` is 1–4; `completed` marks steps already done (e.g. after a refresh).
 */
export default function FlowSteps({ current, completed = {} }) {
  const done = [true, completed.basket, completed.plan, completed.final];
  return (
    <nav aria-label="שלבי התהליך" className="flex items-center gap-1.5 sm:gap-2 text-xs overflow-x-auto pb-1">
      {STEPS.map((step, i) => {
        const n = i + 1;
        const isCurrent = n === current;
        const isDone = !isCurrent && (done[i] || n < current);
        const circle = isCurrent
          ? "bg-primary text-primary-foreground"
          : isDone ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground";
        const content = (
          <span className={`flex items-center gap-1.5 whitespace-nowrap ${isCurrent ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${circle}`}>
              {isDone ? <Check className="w-3 h-3" /> : n}
            </span>
            {step.label}
          </span>
        );
        return (
          <React.Fragment key={step.path}>
            {i > 0 && <span className={`h-px w-4 sm:w-8 shrink-0 ${n <= current || isDone ? "bg-primary/40" : "bg-border"}`} />}
            {isCurrent || !isDone
              ? <span aria-current={isCurrent ? "step" : undefined}>{content}</span>
              : <Link to={step.path} className="hover:opacity-80">{content}</Link>}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
