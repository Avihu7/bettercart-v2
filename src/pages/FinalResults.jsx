import React from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/localAPI";
import { useAuth } from "@/lib/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Trophy, ShoppingCart, UtensilsCrossed, TrendingDown,
  Flame, Heart, ArrowDown, ArrowUp, Printer
} from "lucide-react";
import { formatCurrency } from "@/lib/calculations";
import StatCard from "@/components/dashboard/StatCard";

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

const DAY_LABELS = {
  Monday: "שני", Tuesday: "שלישי", Wednesday: "רביעי",
  Thursday: "חמישי", Friday: "שישי", Saturday: "שבת", Sunday: "ראשון",
};

export default function FinalResults() {
  const navigate = useNavigate();
  const { user } = useAuth();

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
          <Button size="sm" onClick={() => navigate("/print")}>
            <Printer className="w-4 h-4 ml-1" /> הדפסה / שמירה ל-PDF בעברית
          </Button>
        </div>
      </div>

      {/* Before / After Comparison */}
      {ba && (
        <Card className="p-5">
          <h2 className="font-heading font-semibold text-lg mb-1 flex items-center gap-2">
            <TrendingDown className="w-5 h-5 text-primary" /> לפני ואחרי
          </h2>
          <p className="text-xs text-muted-foreground mb-4">
            לפני = התקציב החודשי שהגדרתם בפרופיל · אחרי = עלות סל הקניות החדש × מספר ביקורים בחודש
          </p>
          <div className="grid sm:grid-cols-3 gap-4">
            {/* Before Column */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground text-center">לפני</p>
              <div className="p-4 rounded-xl bg-red-50 border border-red-100 text-center">
                <p className="text-xs text-muted-foreground mb-1">הוצאה חודשית</p>
                <p className="text-xl font-heading font-bold text-red-600">{formatCurrency(ba.previous_monthly_spending)}</p>
                <p className="text-xs text-muted-foreground mt-1">התקציב שהגדרתם בפרופיל</p>
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
                  {formatCurrency(list?.total_estimated_cost)} × {profile?.purchases_per_month || "?"} ביקורים
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

      <Tabs defaultValue="shopping">
        <TabsList className="w-full">
          <TabsTrigger value="shopping" className="flex-1">
            <ShoppingCart className="w-4 h-4 ml-2" /> סל קניות
          </TabsTrigger>
          <TabsTrigger value="meals" className="flex-1">
            <UtensilsCrossed className="w-4 h-4 ml-2" /> תפריט תזונה
          </TabsTrigger>
        </TabsList>

        {/* Shopping List Tab */}
        <TabsContent value="shopping" className="mt-4">
          {list && (
            <Card className="overflow-hidden">
              <div className="p-4 border-b flex items-center justify-between">
                <h2 className="font-heading font-semibold">סל הקניות הסופי</h2>
                <div className="flex gap-4 text-sm">
                  <span>סה״כ: <strong>{formatCurrency(list.total_estimated_cost)}</strong></span>
                  <span>קלוריות: <strong>{list.total_calories?.toLocaleString()}</strong></span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>מוצר</TableHead>
                      <TableHead>קטגוריה</TableHead>
                      <TableHead>כמות</TableHead>
                      <TableHead>מחיר</TableHead>
                      <TableHead>קלוריות</TableHead>
                      <TableHead>ח/פ/ש</TableHead>
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
                        <TableCell className="text-sm">{item.quantity}</TableCell>
                        <TableCell className="text-sm">{formatCurrency(item.estimated_price)}</TableCell>
                        <TableCell className="text-sm">{item.calories}</TableCell>
                        <TableCell className="text-xs">{item.protein}ג / {item.carbs}ג / {item.fat}ג</TableCell>
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
            plan.days.map(day => (
              <Card key={day.day_name} className="overflow-hidden">
                <div className="p-4 border-b flex items-center justify-between bg-muted/30">
                  <h3 className="font-heading font-semibold">יום {DAY_LABELS[day.day_name] || day.day_name}</h3>
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
      </Tabs>

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
    </div>
  );
}