import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { useFlowData } from "@/lib/flowData";
import { weeklyUsageLabel } from "@/lib/shoppingOptimizer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Trophy, ShoppingCart, UtensilsCrossed, TrendingDown,
  Flame, Heart, ArrowDown, ArrowUp, Printer, BarChart3, ChevronLeft
} from "lucide-react";
import { formatCurrency } from "@/lib/calculations";
import StatCard from "@/components/dashboard/StatCard";
import { sortDays, dayLabel } from "@/lib/weekDays";

const categoryColors = {
  protein: "bg-red-50 text-red-700",
  carb: "bg-amber-50 text-amber-700",
  fat: "bg-purple-50 text-purple-700",
  vegetable: "bg-green-50 text-green-700",
  fruit: "bg-orange-50 text-orange-700",
  dairy: "bg-blue-50 text-blue-700",
  snack: "bg-pink-50 text-pink-700",
  drink: "bg-cyan-50 text-cyan-700",
  other: "bg-gray-50 text-gray-700",
};

const CATEGORY_LABELS = {
  protein: "חלבון", carb: "פחמימה", fat: "שומן",
  vegetable: "ירק", fruit: "פרי", dairy: "חלבי",
  snack: "חטיף", drink: "שתייה", other: "אחר",
};

const MEAL_LABELS = {
  Breakfast: "בוקר", Lunch: "צהריים", Dinner: "ערב", Snacks: "חטיפים",
};

export default function FinalResults() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // The completed output: the final list (step 4) and the plan it was calculated from.
  // The step-2 basket is never shown here as the shopping list.
  const { profile, plan, planBasket, finalList: list, isLoading } = useFlowData(user);
  const ba = plan?.before_after;

  if (isLoading) return null;

  if (!list && !plan) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
        <Trophy className="w-12 h-12 text-muted-foreground/30 mb-4" />
        <h1 className="font-heading text-2xl font-bold mb-2">עדיין אין תוצאות</h1>
        <p className="text-muted-foreground text-sm">השלימו את כל השלבים כדי לראות את התוצאות הסופיות כאן.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold flex items-center gap-2">
            <Trophy className="w-6 h-6 text-primary" /> תוצאות סופיות
          </h1>
          <p className="text-sm text-muted-foreground">סיכום התוכנית המותאמת שלכם</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {list && (
            <Button size="sm" onClick={() => navigate("/print")}>
              <Printer className="w-4 h-4 ml-1" /> הדפסה / שמירה כ-PDF
            </Button>
          )}
        </div>
      </div>

      {plan?.days?.length > 0 && !list && (
        <Card className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-primary/30">
          <p className="text-sm text-muted-foreground">התפריט מוכן. נותר לחשב את סל הקניות הסופי — הכמויות המדויקות לכל השבוע.</p>
          <Button onClick={() => navigate("/final-list")} className="rounded-full">
            בניית סל קניות סופי <ChevronLeft className="w-4 h-4 mr-1" />
          </Button>
        </Card>
      )}

      <Tabs defaultValue="shopping">
        <TabsList className="w-full">
          <TabsTrigger value="shopping" className="flex-1">
            <ShoppingCart className="w-4 h-4 ml-2" /> סל קניות סופי
          </TabsTrigger>
          <TabsTrigger value="meals" className="flex-1">
            <UtensilsCrossed className="w-4 h-4 ml-2" /> תפריט תזונה
          </TabsTrigger>
          <TabsTrigger value="summary" className="flex-1">
            <BarChart3 className="w-4 h-4 ml-2" /> סיכום ונתונים
          </TabsTrigger>
        </TabsList>

        {/* Shopping List Tab */}
        <TabsContent value="shopping" className="mt-4">
          {!list && (
            <Card className="p-10 text-center">
              <ShoppingCart className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <h2 className="font-heading font-semibold text-lg mb-2">סל הקניות הסופי עדיין לא חושב</h2>
              <p className="text-sm text-muted-foreground mb-6">
                {plan?.days?.length ? "הכמויות לקנייה מחושבות לפי התפריט השבועי." : "קודם בונים תפריט תזונה, ואז מחשבים ממנו את סל הקניות הסופי."}
              </p>
              <Button onClick={() => navigate(plan?.days?.length ? "/final-list" : "/nutrition-plan")}>
                {plan?.days?.length ? "בניית סל קניות סופי" : "בניית תפריט תזונה"}
              </Button>
            </Card>
          )}
          {list && (
            <Card className="overflow-hidden">
              <div className="p-4 border-b flex items-center justify-between">
                <div>
                  <h2 className="font-heading font-semibold">סל הקניות הסופי</h2>
                  <p className="text-xs text-muted-foreground">הכמויות חושבו לפי התפריט השבועי שלך.</p>
                </div>
                <div className="flex gap-4 text-sm">
                  <span>סה״כ: <strong>{formatCurrency(list.total_estimated_cost)}</strong></span>
                </div>
              </div>
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
                    {list.items?.map((item, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium text-sm">{item.name}</TableCell>
                        <TableCell>
                          <Badge className={`text-xs ${categoryColors[item.category] || categoryColors.other}`}>
                            {CATEGORY_LABELS[item.category] || item.category}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{weeklyUsageLabel(item)}</TableCell>
                        <TableCell className="text-sm font-semibold">{item.quantity}</TableCell>
                        <TableCell className="text-sm">{formatCurrency(item.estimated_price)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
        </TabsContent>

        {/* Meal Plan Tab */}
        <TabsContent value="meals" className="mt-4 space-y-4">
          {plan?.days?.length ? (
            sortDays(plan.days).map(day => (
              <Card key={day.day_name} className="overflow-hidden">
                <div className="p-4 border-b flex items-center justify-between bg-muted/30">
                  <h3 className="font-heading font-semibold">{dayLabel(day.day_name)}</h3>
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    <span>{day.total_calories} קל'</span>
                    <span>ח:{day.total_protein}ג</span>
                    <span>פ:{day.total_carbs}ג</span>
                    <span>ש:{day.total_fat}ג</span>
                    <span>{formatCurrency(day.estimated_cost)}</span>
                  </div>
                </div>
                <div className="divide-y">
                  {day.meals?.map(meal => (
                    <div key={meal.meal_type} className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-semibold text-primary">
                          {MEAL_LABELS[meal.meal_type] || meal.meal_type}
                          {meal.meal_name && <span className="font-normal text-muted-foreground"> — {meal.meal_name}</span>}
                        </h4>
                        <span className="text-xs text-muted-foreground">{meal.total_calories} קל' · {formatCurrency(meal.estimated_cost)}</span>
                      </div>
                      <div className="space-y-1">
                        {meal.items?.map((item, i) => (
                          <div key={i} className="flex justify-between text-xs">
                            <span>{item.food_name} ({item.grams}ג)</span>
                            <span className="text-muted-foreground">{item.calories} קל'</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ))
          ) : (
            <Card className="p-10 text-center">
              <UtensilsCrossed className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <h2 className="font-heading font-semibold text-lg mb-2">עדיין לא נוצר תפריט תזונה</h2>
              <p className="text-sm text-muted-foreground mb-6">
                כדי לראות את תפריט התזונה השבועי, צרו תפריט בשלב הקודם.
              </p>
              <Button onClick={() => navigate('/nutrition-plan')}>
                <UtensilsCrossed className="w-4 h-4 ml-2" /> צור תפריט תזונה
              </Button>
            </Card>
          )}
        </TabsContent>

        {/* Summary Tab */}
        <TabsContent value="summary" className="mt-4 space-y-4">
      {/* Before / After Comparison */}
          {ba && (
            <Card className="p-5">
              <h2 className="font-heading font-semibold text-lg mb-1 flex items-center gap-2">
                <TrendingDown className="w-5 h-5 text-primary" /> לפני ואחרי
              </h2>
              <p className="text-xs text-muted-foreground mb-4">
                {ba.comparison_basis === "receipts_food"
                  ? `לפני = ההוצאה החודשית על מזון מהסוג שבתפריט, לפי ${ba.receipts_counted} ${ba.receipts_counted === 1 ? "קבלה" : "קבלות"} · אחרי = עלות סל הקניות של התפריט לחודש`
                  : "לפני = התקציב החודשי שהגדרתם בפרופיל (עדיין אין קבלות להשוואה) · אחרי = עלות סל הקניות של התפריט לחודש"}
              </p>
              {ba.comparison_basis === "receipts_food" && ba.estimated_new_monthly_spending > ba.previous_monthly_spending && (
                <p className="text-xs text-amber-800 bg-amber-50 rounded-md p-2 -mt-2 mb-4">
                  התפריט עולה יותר ממה שהקבלות מראות שאתם מוציאים על מזון כזה ({formatCurrency(ba.previous_monthly_spending)} בחודש) —
                  התפריט מכסה את כל הארוחות של השבוע, והקבלות שהעליתם כנראה לא מכסות את כל הקניות שלכם.
                  ככל שתעלו יותר קבלות, ההשוואה תהיה מדויקת יותר.
                </p>
              )}
              {ba.comparison_basis === "receipts_food" && (ba.monthly_food_non_plannable > 0 || ba.monthly_non_food > 0) && (
                <p className="text-xs text-muted-foreground -mt-2 mb-4">
                  לא נכללים בהשוואה: כ-{formatCurrency(ba.monthly_food_non_plannable)} בחודש על מזון שלא בתפריט (חטיפים, משקאות, תבלינים)
                  ו-כ-{formatCurrency(ba.monthly_non_food)} על מוצרים שאינם מזון (ניקיון, היגיינה, בית). סך הקבלות בחודש: כ-{formatCurrency(ba.monthly_receipts_total)}.
                </p>
              )}
              <div className="grid sm:grid-cols-3 gap-4">
                {/* Before Column */}
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground text-center">לפני</p>
                  <div className="p-4 rounded-xl bg-red-50 border border-red-100 text-center">
                    <p className="text-xs text-muted-foreground mb-1">הוצאה חודשית</p>
                    <p className="text-xl font-heading font-bold text-red-600">{formatCurrency(ba.previous_monthly_spending)}</p>
                    <p className="text-xs text-muted-foreground mt-1">{ba.comparison_basis === "receipts_food" ? "מזון לתפריט, לפי הקבלות" : "התקציב שהגדרתם בפרופיל"}</p>
                  </div>
                  <div className="p-4 rounded-xl bg-red-50 border border-red-100 text-center">
                    <p className="text-xs text-muted-foreground mb-1">ציון בריאות</p>
                    <p className="text-xl font-heading font-bold text-red-500">{ba.previous_health_score}<span className="text-sm font-normal text-muted-foreground">/100</span></p>
                    <p className="text-xs text-muted-foreground mt-1">לפי הפרופיל שלכם</p>
                  </div>
                </div>

                {/* Savings Column */}
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground text-center">החיסכון שלכם</p>
                  <div className="p-4 rounded-xl bg-accent border border-primary/20 text-center">
                    <p className="text-xs text-muted-foreground mb-1">חיסכון חודשי</p>
                    <p className="text-xl font-heading font-bold text-primary">{formatCurrency(ba.monthly_savings)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{formatCurrency(ba.yearly_savings)}/שנה</p>
                  </div>
                  <div className="p-4 rounded-xl bg-accent border border-primary/20 text-center">
                    <p className="text-xs text-muted-foreground mb-1">שיפור בציון</p>
                    <p className="text-xl font-heading font-bold text-primary">
                      +{Math.max(0, (ba.new_health_score || 0) - (ba.previous_health_score || 0)).toFixed(0)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">נקודות בריאות</p>
                  </div>
                </div>

                {/* After Column */}
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground text-center">אחרי</p>
                  <div className="p-4 rounded-xl bg-green-50 border border-green-100 text-center">
                    <p className="text-xs text-muted-foreground mb-1">הוצאה חודשית</p>
                    <p className="text-xl font-heading font-bold text-green-600">{formatCurrency(ba.estimated_new_monthly_spending)}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatCurrency(plan?.estimated_weekly_cost ?? planBasket?.total_estimated_cost)} לשבוע × כ-4.3 שבועות
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-green-50 border border-green-100 text-center">
                    <p className="text-xs text-muted-foreground mb-1">ציון בריאות</p>
                    <p className="text-xl font-heading font-bold text-green-600">{ba.new_health_score}<span className="text-sm font-normal text-muted-foreground">/100</span></p>
                    <p className="text-xs text-muted-foreground mt-1">לפי סל הקניות החדש</p>
                  </div>
                </div>
              </div>
            </Card>
          )}
      {/* Profile Summary */}
          {profile && (
            <Card className="p-5">
              <h2 className="font-heading font-semibold text-lg mb-3">היעדים שלכם</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-muted text-center">
                  <p className="text-xs text-muted-foreground">קלוריות יומיות</p>
                  <p className="font-heading font-bold">{profile.daily_calories}</p>
                </div>
                <div className="p-3 rounded-lg bg-muted text-center">
                  <p className="text-xs text-muted-foreground">חלבון</p>
                  <p className="font-heading font-bold">{profile.protein_target}ג</p>
                </div>
                <div className="p-3 rounded-lg bg-muted text-center">
                  <p className="text-xs text-muted-foreground">פחמימות</p>
                  <p className="font-heading font-bold">{profile.carbs_target}ג</p>
                </div>
                <div className="p-3 rounded-lg bg-muted text-center">
                  <p className="text-xs text-muted-foreground">שומן</p>
                  <p className="font-heading font-bold">{profile.fat_target}ג</p>
                </div>
              </div>
            </Card>
          )}
        </TabsContent>
      </Tabs>

    </div>
  );
}