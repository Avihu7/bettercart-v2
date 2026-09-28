import React, { useEffect } from "react";
import { api } from "@/api/localAPI";
import { useAuth } from "@/lib/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency } from "@/lib/calculations";

const CATEGORY_LABELS = {
  protein: "חלבון", carb: "פחמימה", fat: "שומן",
  vegetable: "ירק", fruit: "פרי", dairy: "חלבי",
  snack: "חטיף", drink: "שתייה", other: "אחר",
};

const MEAL_LABELS = {
  Breakfast: "ארוחת בוקר",
  Lunch: "ארוחת צהריים",
  Dinner: "ארוחת ערב",
  Snacks: "חטיפים",
};

const DAY_LABELS = {
  Monday: "שני", Tuesday: "שלישי", Wednesday: "רביעי",
  Thursday: "חמישי", Friday: "שישי", Saturday: "שבת", Sunday: "ראשון",
};

const GOAL_LABELS = {
  weight_loss: "ירידה במשקל",
  maintenance: "שמירה על משקל",
  weight_gain: "עלייה במשקל",
};

export default function PrintExport() {
  const { user } = useAuth();
  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get("mode") || "both"; // "shopping" | "nutrition" | "both"

  const { data: profiles } = useQuery({
    queryKey: ["userProfile", user?.email],
    queryFn: () => api.entities.UserProfile.filter({ created_by: user.email }),
    initialData: [],
    enabled: !!user,
  });

  const { data: shoppingLists } = useQuery({
    queryKey: ["shoppingLists", user?.email],
    queryFn: () => api.entities.ShoppingList.filter({ created_by: user.email }, "-created_date", 1),
    initialData: [],
    enabled: !!user,
  });

  const { data: plans } = useQuery({
    queryKey: ["nutritionPlans", user?.email],
    queryFn: () => api.entities.NutritionPlan.filter({ created_by: user.email }, "-created_date", 1),
    initialData: [],
    enabled: !!user,
  });

  const profile = profiles?.[0];
  const list = shoppingLists?.[0];
  const plan = plans?.[0];
  const ba = plan?.before_after;

  const isLoading = !profile && !list && !plan;

  return (
    <div className="print-page" dir="rtl">
      {/* Print-only stylesheet injected inline */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .page-break { page-break-before: always; }
          body { font-family: Arial, sans-serif; }
        }
        .print-page {
          max-width: 800px;
          margin: 0 auto;
          padding: 24px;
          font-family: Arial, sans-serif;
          direction: rtl;
          color: #1a1a1a;
        }
        .section-title {
          font-size: 22px;
          font-weight: bold;
          border-bottom: 2px solid #333;
          padding-bottom: 6px;
          margin-bottom: 16px;
        }
        .sub-title {
          font-size: 16px;
          font-weight: bold;
          margin: 14px 0 8px;
          color: #444;
        }
        table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 13px; }
        th { background: #f0f0f0; padding: 6px 8px; text-align: right; font-weight: bold; border: 1px solid #ddd; }
        td { padding: 5px 8px; border: 1px solid #ddd; text-align: right; }
        tr:nth-child(even) { background: #fafafa; }
        .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px; }
        .meta-box { border: 1px solid #ddd; border-radius: 6px; padding: 10px; text-align: center; }
        .meta-box .label { font-size: 11px; color: #666; }
        .meta-box .value { font-size: 18px; font-weight: bold; }
        .before-after { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 12px 0; }
        .ba-box { border: 1px solid #ddd; border-radius: 6px; padding: 12px; text-align: center; }
        .ba-box.before { border-color: #fca5a5; background: #fff5f5; }
        .ba-box.saving { border-color: #6ee7b7; background: #f0fdf4; }
        .ba-box.after { border-color: #86efac; background: #f0fdf4; }
        .ba-box .label { font-size: 11px; color: #666; }
        .ba-box .value { font-size: 18px; font-weight: bold; }
        .meal-card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; margin-bottom: 10px; }
        .meal-header { font-weight: bold; font-size: 13px; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-bottom: 6px; display: flex; justify-content: space-between; }
        .meal-item { display: flex; justify-content: space-between; font-size: 12px; padding: 2px 0; }
        .day-header { background: #f8fafc; border-radius: 6px; padding: 10px 14px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
        .day-name { font-size: 16px; font-weight: bold; }
        .day-stats { font-size: 11px; color: #666; }
        .print-btn { position: fixed; bottom: 24px; left: 24px; padding: 10px 22px; background: #1a1a1a; color: white; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; }
        .print-btn:hover { background: #333; }
        .page-break-div { margin-top: 32px; }
      `}</style>

      {/* Print button */}
      <button className="print-btn no-print" onClick={() => window.print()}>
        🖨 הדפסה / שמירה כ-PDF
      </button>
      <div className="no-print" style={{ position: 'fixed', bottom: 70, left: 24, fontSize: 12, color: '#888', maxWidth: 220, lineHeight: 1.5 }}>
        לשמירת PDF:<br />Cmd+P (Mac) / Ctrl+P (PC)<br />ובחרו "Save as PDF"
      </div>

      {/* Header */}
      <div style={{ marginBottom: 24, textAlign: 'center' }}>
        <h1 style={{ fontSize: 28, fontWeight: 'bold', margin: '0 0 4px' }}>BetterCart</h1>
        <p style={{ fontSize: 13, color: '#666' }}>
          תוכנית תזונה ורשימת קניות אישית · {new Date().toLocaleDateString("he-IL")}
        </p>
      </div>

      {/* Profile summary */}
      {profile && (
        <div style={{ marginBottom: 24 }}>
          <div className="section-title">פרופיל המשתמש</div>
          <div className="meta-grid">
            <div className="meta-box">
              <div className="label">מטרה</div>
              <div className="value" style={{ fontSize: 14 }}>{GOAL_LABELS[profile.goal] || profile.goal}</div>
            </div>
            <div className="meta-box">
              <div className="label">קלוריות יומיות</div>
              <div className="value">{profile.daily_calories}</div>
            </div>
            <div className="meta-box">
              <div className="label">BMI</div>
              <div className="value">{profile.bmi?.toFixed(1)}</div>
            </div>
            <div className="meta-box">
              <div className="label">חלבון יומי</div>
              <div className="value">{profile.protein_target}ג'</div>
            </div>
            <div className="meta-box">
              <div className="label">תקציב לביקור</div>
              <div className="value">{formatCurrency(profile.budget_per_purchase)}</div>
            </div>
            <div className="meta-box">
              <div className="label">ציון בריאות</div>
              <div className="value">{profile.health_score}/100</div>
            </div>
          </div>
        </div>
      )}

      {/* Before / After */}
      {ba && (
        <div style={{ marginBottom: 24 }}>
          <div className="section-title">לפני ואחרי</div>
          <div className="before-after">
            <div className="ba-box before">
              <div className="label">הוצאה חודשית לפני</div>
              <div className="value" style={{ color: '#dc2626' }}>{formatCurrency(ba.previous_monthly_spending)}</div>
              <div className="label" style={{ marginTop: 8 }}>ציון בריאות לפני</div>
              <div className="value" style={{ color: '#dc2626', fontSize: 14 }}>{ba.previous_health_score}/100</div>
            </div>
            <div className="ba-box saving">
              <div className="label">חיסכון חודשי</div>
              <div className="value" style={{ color: '#059669' }}>{formatCurrency(ba.monthly_savings)}</div>
              <div className="label" style={{ marginTop: 8 }}>חיסכון שנתי</div>
              <div className="value" style={{ color: '#059669', fontSize: 14 }}>{formatCurrency(ba.yearly_savings)}</div>
            </div>
            <div className="ba-box after">
              <div className="label">הוצאה חודשית אחרי</div>
              <div className="value" style={{ color: '#16a34a' }}>{formatCurrency(ba.estimated_new_monthly_spending)}</div>
              <div className="label" style={{ marginTop: 8 }}>ציון בריאות אחרי</div>
              <div className="value" style={{ color: '#16a34a', fontSize: 14 }}>{ba.new_health_score}/100</div>
            </div>
          </div>
        </div>
      )}

      {/* Shopping List */}
      {list && (mode === "shopping" || mode === "both") && (
        <div style={{ marginBottom: 28 }}>
          <div className="section-title">סל קניות</div>
          <p style={{ fontSize: 12, color: '#666', marginBottom: 10 }}>
            תקופה: {list.shopping_period_days} ימים · סה"כ: {formatCurrency(list.total_estimated_cost)} · קלוריות: {list.total_calories?.toLocaleString()}
          </p>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>מוצר</th>
                <th>קטגוריה</th>
                <th>כמות</th>
                <th>מחיר</th>
                <th>קל'</th>
                <th>ח/פ/ש (ג')</th>
                <th>ציון</th>
              </tr>
            </thead>
            <tbody>
              {list.items?.map((item, i) => (
                <tr key={i}>
                  <td style={{ color: '#888', width: 28 }}>{i + 1}</td>
                  <td style={{ fontWeight: 500 }}>{item.name}</td>
                  <td>{CATEGORY_LABELS[item.category] || item.category}</td>
                  <td>{item.quantity}</td>
                  <td>{formatCurrency(item.estimated_price)}</td>
                  <td>{item.calories?.toLocaleString()}</td>
                  <td>{item.protein}/{item.carbs}/{item.fat}</td>
                  <td style={{ textAlign: 'center', fontWeight: 'bold', color: item.health_score >= 7 ? '#16a34a' : item.health_score >= 4 ? '#d97706' : '#dc2626' }}>
                    {item.health_score}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 'bold', background: '#f0f0f0' }}>
                <td colSpan={4} style={{ textAlign: 'right' }}>סה"כ</td>
                <td>{formatCurrency(list.total_estimated_cost)}</td>
                <td>{list.total_calories?.toLocaleString()}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Nutrition Plan — missing state */}
      {!plan && list && (mode === "nutrition" || mode === "both") && (
        <div style={{ marginBottom: 28, padding: '24px', border: '1px dashed #ccc', borderRadius: 8, textAlign: 'center', color: '#888' }}>
          <div style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 8 }}>תפריט תזונה עדיין לא נוצר</div>
          <div style={{ fontSize: 13 }}>חזרו ל-BetterCart, צרו תפריט תזונה בשלב "תפריט תזונה", ואז חזרו להדפסה.</div>
        </div>
      )}

      {/* Nutrition Plan */}
      {plan && (mode === "nutrition" || mode === "both") && (
        <div className={mode === "both" ? "page-break-div" : ""}>
          <div className="section-title">תפריט תזונה שבועי</div>
          <p style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
            קלוריות יומיות: {plan.daily_calories} · קלוריות שבועיות: {plan.weekly_calories?.toLocaleString()} · עלות שבועית: {formatCurrency(plan.estimated_weekly_cost)}
          </p>

          {plan.days?.map(day => (
            <div key={day.day_name} style={{ marginBottom: 20, pageBreakInside: 'avoid' }}>
              <div className="day-header">
                <span className="day-name">יום {DAY_LABELS[day.day_name] || day.day_name}</span>
                <span className="day-stats">
                  {day.total_calories} קל' · ח:{day.total_protein}ג' · פ:{day.total_carbs}ג' · ש:{day.total_fat}ג' · {formatCurrency(day.estimated_cost)}
                </span>
              </div>
              {day.meals?.map(meal => (
                <div key={meal.meal_type} className="meal-card">
                  <div className="meal-header">
                    <span>
                      {MEAL_LABELS[meal.meal_type] || meal.meal_type}
                      {meal.meal_name && <span style={{ fontWeight: 'normal' }}> — {meal.meal_name}</span>}
                    </span>
                    <span style={{ color: '#666', fontWeight: 'normal' }}>
                      {meal.total_calories} קל' · {formatCurrency(meal.estimated_cost)}
                    </span>
                  </div>
                  {meal.items?.map((item, i) => (
                    <div key={i} className="meal-item">
                      <span>{item.food_name} <span style={{ color: '#888' }}>({item.grams}ג')</span></span>
                      <span style={{ color: '#666' }}>
                        {item.calories} קל' · ח:{item.protein}ג' פ:{item.carbs}ג' ש:{item.fat}ג'
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {!list && !plan && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#888' }}>
          <p>אין נתונים להדפסה. השלימו את כל שלבי BetterCart תחילה.</p>
        </div>
      )}
    </div>
  );
}
