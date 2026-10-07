import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/api/localAPI";
import { useAuth } from "@/lib/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import StatCard from "@/components/dashboard/StatCard";
import {
  Flame, Beef, Wheat, Droplet, Wallet, ShoppingCart,
  Upload, Receipt, Heart, TrendingDown, Scale,
  AlertTriangle, CheckCircle2, Loader2, RefreshCw
} from "lucide-react";
import { formatCurrency, getBMICategoryHe, calculateFitnessScore, calculateBMI } from "@/lib/calculations";
import { format } from "date-fns";
import { applyReceiptRules } from "@/lib/receiptClassifier";

const STATUS_LABELS = {
  uploaded: "הועלה",
  processing: "בעיבוד",
  analyzed: "נותח",
  error: "שגיאה",
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Weight tracking state
  const [newWeight, setNewWeight] = useState("");
  const [bmiAlert, setBmiAlert] = useState(null); // { oldBmi, newBmi, diff } when BMI shifts ≥ 2
  const [weightSaved, setWeightSaved] = useState(false);

  const { data: profiles, isLoading: isLoadingProfile } = useQuery({
    queryKey: ["userProfile", user?.email],
    queryFn: () => api.entities.UserProfile.filter({ created_by: user.email }),
    enabled: !!user,
  });

  const { data: receipts } = useQuery({
    queryKey: ["receipts", user?.email],
    queryFn: () => api.entities.Receipt.filter({ created_by: user.email }, "-created_date", 5),
    initialData: [],
    enabled: !!user,
  });

  const { data: shoppingLists } = useQuery({
    queryKey: ["shoppingLists", user?.email],
    queryFn: () => api.entities.ShoppingList.filter({ created_by: user.email }, "-created_date", 1),
    initialData: [],
    enabled: !!user,
  });

  const { data: nutritionPlans } = useQuery({
    queryKey: ["nutritionPlans", user?.email],
    queryFn: () => api.entities.NutritionPlan.filter({ created_by: user.email }, "-created_date", 1),
    initialData: [],
    enabled: !!user,
  });

  const { data: approvedReceiptItems } = useQuery({
    queryKey: ["approvedReceiptItems", user?.email],
    // menu suitability by the rules (or the user's own edit), not the receipt AI
    queryFn: async () => (await api.entities.ReceiptItem.filter({ created_by: user.email }))
      .map(applyReceiptRules).filter(i => i.is_approved_for_menu),
    initialData: [],
    enabled: !!user,
  });

  const profile = profiles?.[0];

  const weightMutation = useMutation({
    mutationFn: async (weightKg) => {
      const oldBmi = profile.bmi;
      const newBmi = calculateBMI(weightKg, profile.height);
      await api.entities.UserProfile.update(profile.id, { weight: weightKg, bmi: newBmi });
      return { oldBmi, newBmi };
    },
    onSuccess: ({ oldBmi, newBmi }) => {
      queryClient.invalidateQueries({ queryKey: ["userProfile"], exact: false });
      setNewWeight("");
      const diff = Math.round(Math.abs(newBmi - oldBmi) * 10) / 10;
      if (diff >= 2) {
        setBmiAlert({ oldBmi, newBmi, diff });
      } else {
        setWeightSaved(true);
        setTimeout(() => setWeightSaved(false), 3000);
      }
    },
  });

  const handleWeightSubmit = () => {
    const kg = parseFloat(newWeight);
    if (!kg || kg < 20 || kg > 300) return;
    weightMutation.mutate(kg);
  };

  if (isLoadingProfile || !user) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!profile?.onboarding_complete) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
          <Heart className="w-8 h-8 text-primary" />
        </div>
        <h1 className="font-heading text-2xl font-bold mb-2">ברוכים הבאים ל-BetterCart!</h1>
        <p className="text-muted-foreground mb-6 max-w-md">
          השלימו את הפרופיל שלכם כדי להתחיל לקבל רשימות קניות ותפריטי תזונה מותאמים אישית.
        </p>
        <Button onClick={() => navigate("/onboarding")} size="lg" className="rounded-full px-8">
          השלמת הפרופיל
        </Button>
      </div>
    );
  }

  const latestPlan = nutritionPlans?.[0];
  const savings = latestPlan?.before_after;

  // Live fitness score: recalculated from real data, not the saved onboarding snapshot.
  // Uses approved receipt items for diet diversity, and nutrition plan weekly avg vs. target for calorie accuracy.
  const planDailyCaloriesAvg = latestPlan?.weekly_calories && latestPlan?.days?.length
    ? Math.round(latestPlan.weekly_calories / latestPlan.days.length)
    : 0;
  const liveFitnessScore = profile?.bmi
    ? calculateFitnessScore({
        bmi: profile.bmi,
        activityLevel: profile.activity_level,
        strengthTraining: profile.strength_training || 'none',
        receiptItems: approvedReceiptItems || [],
        dailyCalories: planDailyCaloriesAvg,
        calorieTarget: profile.daily_calories || 0,
      })
    : profile?.health_score ?? null;

  // Which score components are "active" (have real data behind them)
  const hasReceiptData = (approvedReceiptItems?.length || 0) > 0;
  const hasPlanData = !!latestPlan?.weekly_calories;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold">דשבורד</h1>
          <p className="text-sm text-muted-foreground">סקירת הבריאות והתקציב שלכם</p>
        </div>
        <Button onClick={() => navigate("/upload")} className="rounded-full">
          <Upload className="w-4 h-4 ml-2" /> העלאת קבלה
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="קלוריות יומיות" value={profile.daily_calories != null ? `${profile.daily_calories}` : '—'} subtitle="קל'/יום" icon={Flame} color="orange" />
        <StatCard title="חלבון" value={profile.protein_target != null ? `${profile.protein_target}ג` : '—'} subtitle="יעד יומי" icon={Beef} color="red" />
        <StatCard title="ציון כושר ובריאות" value={liveFitnessScore != null ? `${liveFitnessScore}/100` : '—'} subtitle={getBMICategoryHe(profile.bmi)} icon={Heart} color="green" />
        <StatCard title="תקציב לביקור" value={profile.budget_per_purchase != null ? formatCurrency(profile.budget_per_purchase) : '—'} subtitle={profile.purchases_per_month != null ? `${profile.purchases_per_month}x/חודש` : ''} icon={Wallet} color="blue" />
      </div>

      {/* Secondary Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="פחמימות" value={profile.carbs_target != null ? `${profile.carbs_target}ג` : '—'} icon={Wheat} color="orange" />
        <StatCard title="שומן" value={profile.fat_target != null ? `${profile.fat_target}ג` : '—'} icon={Droplet} color="purple" />
        <StatCard title="BMI" value={profile.bmi != null ? profile.bmi.toFixed(1) : '—'} subtitle={getBMICategoryHe(profile.bmi)} icon={Scale} color="blue" />
        <StatCard title="תקציב חודשי" value={profile.monthly_budget != null ? formatCurrency(profile.monthly_budget) : '—'} icon={ShoppingCart} color="green" />
      </div>

      {/* Fitness Score Info Card */}
      <Card className="p-4 border-0 bg-muted/50">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0 mt-0.5">
            <Heart className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium mb-0.5">
              ציון כושר ובריאות — מחושב לפי 5 מרכיבים:
            </p>
            <p className="text-xs text-muted-foreground mb-2">
              הציון מתחשב ב-BMI, רמת פעילות, אימוני כוח, גיוון תזונתי והתאמה קלורית.
              BMI לבדו לא תמיד משקף מסת שריר.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${profile.bmi ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${profile.bmi ? 'bg-emerald-500' : 'bg-border'}`} />
                BMI (עד 30 נק׳)
              </div>
              <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${profile.activity_level ? 'bg-blue-100 text-blue-700' : 'bg-muted text-muted-foreground'}`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${profile.activity_level ? 'bg-blue-500' : 'bg-border'}`} />
                פעילות (עד 20 נק׳)
              </div>
              <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${profile.strength_training && profile.strength_training !== 'none' ? 'bg-violet-100 text-violet-700' : 'bg-muted text-muted-foreground'}`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${profile.strength_training && profile.strength_training !== 'none' ? 'bg-violet-500' : 'bg-border'}`} />
                {profile.strength_training && profile.strength_training !== 'none' ? 'אימוני כוח (עד 18 נק׳)' : 'אימוני כוח (עדכנו פרופיל)'}
              </div>
              <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${hasReceiptData ? 'bg-purple-100 text-purple-700' : 'bg-muted text-muted-foreground'}`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${hasReceiptData ? 'bg-purple-500' : 'bg-border'}`} />
                גיוון תזונתי ({hasReceiptData ? 'עד 20 נק׳' : 'העלו קבלה'})
              </div>
              <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${hasPlanData ? 'bg-orange-100 text-orange-700' : 'bg-muted text-muted-foreground'}`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${hasPlanData ? 'bg-orange-500' : 'bg-border'}`} />
                דיוק קלורי ({hasPlanData ? 'עד 10 נק׳' : 'צרו תפריט'})
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Weight Tracking Card */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
            <Scale className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <h2 className="font-heading font-semibold text-base">עדכון משקל</h2>
            <p className="text-xs text-muted-foreground">
              משקל נוכחי: <strong>{profile.weight} ק״ג</strong>
              {profile.bmi != null && (
                <> · BMI: <strong>{profile.bmi.toFixed(1)}</strong> ({getBMICategoryHe(profile.bmi)})</>
              )}
            </p>
          </div>
        </div>

        <div className="flex gap-2 items-start">
          <div className="flex-1">
            <Input
              type="number"
              min={20}
              max={300}
              step={0.1}
              value={newWeight}
              onChange={e => {
                setNewWeight(e.target.value);
                if (weightSaved) setWeightSaved(false);
                if (bmiAlert) setBmiAlert(null);
              }}
              onKeyDown={e => e.key === "Enter" && handleWeightSubmit()}
              placeholder={`${profile.weight} ק״ג (משקל נוכחי)`}
              className="text-right"
              dir="rtl"
            />
          </div>
          <Button
            onClick={handleWeightSubmit}
            disabled={
              weightMutation.isPending ||
              !newWeight ||
              parseFloat(newWeight) < 20 ||
              parseFloat(newWeight) > 300
            }
          >
            {weightMutation.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : "עדכן משקל"
            }
          </Button>
        </div>

        {weightSaved && (
          <div className="flex items-center gap-2 mt-3 text-sm text-emerald-700">
            <CheckCircle2 className="w-4 h-4" />
            <span>המשקל עודכן בהצלחה! BMI חושב מחדש.</span>
          </div>
        )}

        {weightMutation.isError && (
          <p className="mt-2 text-xs text-destructive">{weightMutation.error?.message}</p>
        )}
      </Card>

      {/* BMI Significant Change Alert */}
      {bmiAlert && (
        <Card className="p-5 border-amber-200 bg-amber-50">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-heading font-semibold text-amber-900 mb-1">
                ה-BMI שלך השתנה משמעותית
              </h3>
              <p className="text-sm text-amber-800 mb-1">
                BMI השתנה מ-<strong>{bmiAlert.oldBmi.toFixed(1)}</strong> ({getBMICategoryHe(bmiAlert.oldBmi)})
                {" "}ל-<strong>{bmiAlert.newBmi.toFixed(1)}</strong> ({getBMICategoryHe(bmiAlert.newBmi)})
                {" "}— שינוי של <strong>{bmiAlert.diff} נקודות</strong>.
              </p>
              <p className="text-sm text-amber-700 mb-4">
                מומלץ לעדכן את הפרופיל כדי לחשב מחדש את יעדי הקלוריות, המאקרו וסל הקניות.
              </p>
              <div className="flex gap-3 flex-wrap">
                <Button
                  size="sm"
                  onClick={() => {
                    setBmiAlert(null);
                    navigate("/onboarding");
                  }}
                >
                  <RefreshCw className="w-4 h-4 ml-2" />
                  עדכן פרופיל ותוכנית
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setBmiAlert(null)}
                >
                  לא עכשיו
                </Button>
              </div>
              <p className="text-xs text-amber-600 mt-3">
                * לאחר עדכון הפרופיל, הכנסו לסל הקניות ולתפריט התזונה וצרו אותם מחדש עם הנתונים החדשים.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Savings Alert */}
      {savings?.monthly_savings > 0 && (
        <Card className="p-5 bg-accent border-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <TrendingDown className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <p className="font-heading font-semibold">החיסכון החודשי המשוער שלכם</p>
              <p className="text-sm text-muted-foreground">
                {formatCurrency(savings.monthly_savings)}/חודש · {formatCurrency(savings.yearly_savings)}/שנה
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Recent Receipts */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading font-semibold text-lg">קבלות אחרונות</h2>
          <Button variant="ghost" size="sm" onClick={() => navigate("/upload")}>
            הוספת קבלה חדשה
          </Button>
        </div>
        {receipts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Receipt className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">עדיין לא העלית קבלות</p>
            <p className="text-xs mt-1">העלו קבלה מרמי לוי או שופרסל כדי להתחיל</p>
          </div>
        ) : (
          <div className="space-y-2">
            {receipts.map(r => (
              <Link
                key={r.id}
                to={`/receipt-results?id=${r.id}`}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Receipt className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-sm">{r.store_name || "קבלה"}</p>
                    <p className="text-xs text-muted-foreground">
                      {(() => { try { return format(new Date(r.purchase_date || r.created_date), "d/M/yyyy"); } catch { return ""; } })()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {r.total_amount && <span className="text-sm font-medium">{formatCurrency(r.total_amount)}</span>}
                  <Badge variant={r.status === "analyzed" ? "default" : "secondary"} className="text-xs">
                    {STATUS_LABELS[r.status] || r.status}
                  </Badge>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {/* Quick Links */}
      <div className="grid sm:grid-cols-2 gap-4">
        {shoppingLists.length > 0 && (
          <Card className="p-5 hover:shadow-md transition-shadow cursor-pointer" onClick={() => navigate("/shopping-list")}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <ShoppingCart className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="font-heading font-semibold">סל המוצרים החכם</p>
                <p className="text-sm text-muted-foreground">צפו במוצרים שנבחרו עבורכם</p>
              </div>
            </div>
          </Card>
        )}
        {nutritionPlans.length > 0 && (
          <Card className="p-5 hover:shadow-md transition-shadow cursor-pointer" onClick={() => navigate("/nutrition-plan")}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                <Flame className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="font-heading font-semibold">תפריט תזונה</p>
                <p className="text-sm text-muted-foreground">צפו בתפריט השבועי שלכם</p>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}