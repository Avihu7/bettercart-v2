import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/localAPI";
import { useAuth } from "@/lib/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ChevronLeft, ChevronRight, Check, X, ShoppingCart, Loader2, AlertCircle } from "lucide-react";
import {
  calculateBMI, calculateBMR, calculateDailyCalories,
  calculateMacros, calculateBudgetPerPurchase, calculateFitnessScore
} from "@/lib/calculations";

const STEPS = ["פרטים אישיים", "מטרות ותזונה", "העדפות", "תקציב", "סיכום"];

const DIETARY_OPTIONS = ["צמחוני", "טבעוני", "כשר", "ללא לקטוז", "ללא גלוטן"];
const ALLERGY_OPTIONS = ["בוטנים", "אגוזים", "חלב", "ביצים", "חיטה", "סויה", "דגים", "פירות ים"];
const ACTIVITY_LABELS = {
  sedentary: "יושבני (עבודת משרד)",
  lightly_active: "פעיל קלות (1-3 פעמים בשבוע)",
  moderately_active: "פעיל מתון (3-5 פעמים בשבוע)",
  very_active: "פעיל מאוד (6-7 פעמים בשבוע)",
  extra_active: "ספורטאי",
};

const STRENGTH_LABELS = {
  none:  "ללא אימוני כוח",
  "1-2": "1–2 פעמים בשבוע",
  "3-5": "3–5 פעמים בשבוע",
  "5+":  "5+ פעמים בשבוע",
};

const GOAL_LABELS = {
  weight_loss: "ירידה במשקל",
  maintenance: "שמירה על משקל",
  weight_gain: "עלייה במשקל",
};

function getBMICategoryHe(bmi) {
  if (!bmi) return "";
  if (bmi < 18.5) return "תת-משקל";
  if (bmi < 25) return "משקל תקין";
  if (bmi < 30) return "עודף משקל";
  return "השמנה";
}

export default function Onboarding() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    age: "", gender: "male", height: "", weight: "",
    activity_level: "moderately_active", strength_training: "none",
    goal: "maintenance",
    allergies: [], dietary_preferences: [],
    favorite_foods: [], disliked_foods: [],
    monthly_budget: "", purchases_per_month: "4",
    _favInput: "", _disInput: "",
  });

  const { data: existingProfiles } = useQuery({
    queryKey: ["userProfile", user?.email],
    queryFn: () => api.entities.UserProfile.filter({ created_by: user.email }),
    initialData: [],
    enabled: !!user,
  });

  useEffect(() => {
    if (existingProfiles?.length > 0) {
      const p = existingProfiles[0];
      setForm(prev => ({
        ...prev,
        age: p.age || "", gender: p.gender || "male",
        height: p.height || "", weight: p.weight || "",
        activity_level: p.activity_level || "moderately_active",
        strength_training: p.strength_training || "none",
        goal: p.goal || "maintenance",
        allergies: p.allergies || [], dietary_preferences: p.dietary_preferences || [],
        favorite_foods: p.favorite_foods || [], disliked_foods: p.disliked_foods || [],
        monthly_budget: p.monthly_budget || "", purchases_per_month: p.purchases_per_month || "4",
      }));
    }
  }, [existingProfiles]);

  const set = (field, value) => setForm(prev => ({ ...prev, [field]: value }));
  const toggleArray = (field, item) => {
    setForm(prev => ({
      ...prev,
      [field]: prev[field].includes(item)
        ? prev[field].filter(i => i !== item)
        : [...prev[field], item],
    }));
  };
  const addToArray = (field, inputField) => {
    const raw = form[inputField] || "";
    const items = raw
      .split(/[,،]/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
    if (items.length === 0) return;
    setForm(prev => {
      const existing = new Set(prev[field]);
      const toAdd = items.filter(i => !existing.has(i));
      if (toAdd.length === 0) return { ...prev, [inputField]: "" };
      return { ...prev, [field]: [...prev[field], ...toAdd], [inputField]: "" };
    });
  };
  const removeFromArray = (field, item) => {
    setForm(prev => ({ ...prev, [field]: prev[field].filter(i => i !== item) }));
  };

  const bmi = form.weight && form.height ? calculateBMI(Number(form.weight), Number(form.height)) : 0;
  const bmr = form.weight && form.height && form.age
    ? calculateBMR(Number(form.weight), Number(form.height), Number(form.age), form.gender) : 0;
  const dailyCalories = bmr ? calculateDailyCalories(bmr, form.activity_level, form.goal) : 0;
  const macros = dailyCalories ? calculateMacros(dailyCalories, form.goal, Number(form.weight)) : { protein: 0, carbs: 0, fat: 0 };
  const budgetPerPurchase = calculateBudgetPerPurchase(Number(form.monthly_budget) || 0, Number(form.purchases_per_month) || 1);
  // Base fitness score: BMI + activity + strength only (no receipt/calorie data yet at onboarding)
  const healthScore = bmi
    ? calculateFitnessScore({ bmi, activityLevel: form.activity_level, strengthTraining: form.strength_training })
    : 0;

  const budgetNum = Number(form.monthly_budget);
  const purchasesNum = Number(form.purchases_per_month);
  const budgetValid = !form.monthly_budget || (budgetNum >= 500 && budgetNum <= 10000);
  const purchasesValid = !form.purchases_per_month || (purchasesNum >= 1 && purchasesNum <= 31);
  const budgetEntered = !!form.monthly_budget;
  const purchasesEntered = !!form.purchases_per_month;

  // Missing/invalid required fields, as Hebrew messages (empty = valid)
  const validationErrors = () => {
    const errors = [];
    if (!form.age || Number(form.age) <= 0) errors.push("נא להזין גיל");
    if (!form.height || Number(form.height) <= 0) errors.push("נא להזין גובה");
    if (!form.weight || Number(form.weight) <= 0) errors.push("נא להזין משקל");
    if (step >= 3 && !form.monthly_budget) errors.push("נא להזין תקציב חודשי");
    else if (step >= 3 && !budgetValid) errors.push("התקציב החודשי חייב להיות בין ₪500 ל-₪10,000");
    if (step >= 3 && !form.purchases_per_month) errors.push("נא להזין מספר ביקורים בחודש");
    else if (step >= 3 && !purchasesValid) errors.push("מספר הביקורים בחודש חייב להיות בין 1 ל-31");
    return errors;
  };
  const [saveErrors, setSaveErrors] = useState([]);

  // Guards against a double click creating two profiles before the button re-renders as disabled
  const submittingRef = useRef(false);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const data = {
        age: Number(form.age), gender: form.gender,
        height: Number(form.height), weight: Number(form.weight),
        activity_level: form.activity_level, goal: form.goal,
        allergies: form.allergies, dietary_preferences: form.dietary_preferences,
        favorite_foods: form.favorite_foods, disliked_foods: form.disliked_foods,
        monthly_budget: Number(form.monthly_budget),
        purchases_per_month: Number(form.purchases_per_month),
        budget_per_purchase: budgetPerPurchase,
        bmi, bmr, daily_calories: dailyCalories,
        protein_target: macros.protein, carbs_target: macros.carbs, fat_target: macros.fat,
        health_score: healthScore, strength_training: form.strength_training,
        onboarding_complete: true,
      };
      if (existingProfiles?.length > 0) {
        return api.entities.UserProfile.update(existingProfiles[0].id, data);
      }
      return api.entities.UserProfile.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userProfile"], exact: false });
      navigate("/dashboard");
    },
    onSettled: () => {
      submittingRef.current = false;
    },
  });

  const handleFinish = () => {
    if (submittingRef.current || saveMutation.isPending) return;
    const errors = validationErrors();
    setSaveErrors(errors);
    if (errors.length) return;
    submittingRef.current = true;
    saveMutation.mutate();
  };

  const canNext = () => {
    if (step === 0) return form.age && form.gender && form.height && form.weight;
    if (step === 3) {
      return (
        form.monthly_budget && form.purchases_per_month &&
        budgetNum >= 500 && budgetNum <= 10000 &&
        purchasesNum >= 1 && purchasesNum <= 31
      );
    }
    return true;
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 font-body" dir="rtl">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
              <ShoppingCart className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-heading font-bold text-xl">BetterCart</span>
          </div>
          <h1 className="font-heading text-2xl font-bold mb-2">הגדרת הפרופיל שלכם</h1>
          <p className="text-sm text-muted-foreground">שלב {step + 1} מתוך {STEPS.length}: {STEPS[step]}</p>
          <Progress value={((step + 1) / STEPS.length) * 100} className="mt-4 h-1.5" />
        </div>

        {existingProfiles?.[0]?.onboarding_complete && (
          <div className="mb-4 px-4 py-3 rounded-xl bg-accent/60 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">הפרופיל שלכם כבר הושלם. תוכלו לערוך אותו כאן.</span>
            <button onClick={() => navigate("/dashboard")} className="text-primary font-medium underline mr-2">
              חזרה לדשבורד
            </button>
          </div>
        )}

        <Card className="p-6">
          {/* Step 0: Personal Info */}
          {step === 0 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>גיל</Label>
                  <Input type="number" value={form.age} onChange={e => set("age", e.target.value)} placeholder="25" />
                </div>
                <div>
                  <Label>מין</Label>
                  <Select value={form.gender} onValueChange={v => set("gender", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">זכר</SelectItem>
                      <SelectItem value="female">נקבה</SelectItem>
                      <SelectItem value="other">אחר</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>גובה (ס״מ)</Label>
                  <Input type="number" value={form.height} onChange={e => set("height", e.target.value)} placeholder="175" />
                </div>
                <div>
                  <Label>משקל (ק״ג)</Label>
                  <Input type="number" value={form.weight} onChange={e => set("weight", e.target.value)} placeholder="70" />
                </div>
              </div>
              <div>
                <Label>רמת פעילות גופנית</Label>
                <Select value={form.activity_level} onValueChange={v => set("activity_level", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ACTIVITY_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>אימוני כוח (אופציונלי)</Label>
                <Select value={form.strength_training} onValueChange={v => set("strength_training", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(STRENGTH_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  משפיע על ציון הכושר — BMI גבוה ממסת שריר לא נחשב כחסרון.
                </p>
              </div>
            </div>
          )}

          {/* Step 1: Goals & Diet */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <Label>מטרה</Label>
                <Select value={form.goal} onValueChange={v => set("goal", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weight_loss">ירידה במשקל</SelectItem>
                    <SelectItem value="maintenance">שמירה על משקל</SelectItem>
                    <SelectItem value="weight_gain">עלייה במשקל</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-2 block">העדפות תזונה</Label>
                <div className="flex flex-wrap gap-2">
                  {DIETARY_OPTIONS.map(d => (
                    <Badge
                      key={d}
                      variant={form.dietary_preferences.includes(d) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => toggleArray("dietary_preferences", d)}
                    >
                      {d}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <Label className="mb-2 block">אלרגיות</Label>
                <div className="flex flex-wrap gap-2">
                  {ALLERGY_OPTIONS.map(a => (
                    <Badge
                      key={a}
                      variant={form.allergies.includes(a) ? "destructive" : "outline"}
                      className="cursor-pointer"
                      onClick={() => toggleArray("allergies", a)}
                    >
                      {a}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Preferences */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <Label>מאכלים אהובים</Label>
                <div className="flex gap-2 mt-1">
                  <Button type="button" size="sm" onClick={() => addToArray("favorite_foods", "_favInput")}>הוסף</Button>
                  <Input
                    value={form._favInput}
                    onChange={e => set("_favInput", e.target.value)}
                    placeholder="למשל: עוף, אורז..."
                    onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addToArray("favorite_foods", "_favInput"))}
                  />
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {form.favorite_foods.map(f => (
                    <Badge key={f} variant="secondary" className="gap-1">
                      {f} <X className="w-3 h-3 cursor-pointer" onClick={() => removeFromArray("favorite_foods", f)} />
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <Label>מאכלים שלא אוהבים</Label>
                <div className="flex gap-2 mt-1">
                  <Button type="button" size="sm" onClick={() => addToArray("disliked_foods", "_disInput")}>הוסף</Button>
                  <Input
                    value={form._disInput}
                    onChange={e => set("_disInput", e.target.value)}
                    placeholder="למשל: ברוקולי, דגים..."
                    onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addToArray("disliked_foods", "_disInput"))}
                  />
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {form.disliked_foods.map(f => (
                    <Badge key={f} variant="outline" className="gap-1">
                      {f} <X className="w-3 h-3 cursor-pointer" onClick={() => removeFromArray("disliked_foods", f)} />
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Budget */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <Label>תקציב חודשי לסופר (₪)</Label>
                <Input
                  type="number"
                  value={form.monthly_budget}
                  onChange={e => set("monthly_budget", e.target.value)}
                  placeholder="2000"
                  className={budgetEntered && !budgetValid ? "border-destructive focus-visible:ring-destructive" : ""}
                />
                {budgetEntered && !budgetValid && (
                  <p className="text-xs text-destructive mt-1">התקציב החודשי חייב להיות בין ₪500 ל-₪10,000</p>
                )}
              </div>
              <div>
                <Label>מספר ביקורים בסופר בחודש</Label>
                <Input
                  type="number"
                  value={form.purchases_per_month}
                  onChange={e => set("purchases_per_month", e.target.value)}
                  placeholder="4"
                  className={purchasesEntered && !purchasesValid ? "border-destructive focus-visible:ring-destructive" : ""}
                />
                {purchasesEntered && !purchasesValid && (
                  <p className="text-xs text-destructive mt-1">מספר הביקורים חייב להיות בין 1 ל-31</p>
                )}
              </div>
              {form.monthly_budget && form.purchases_per_month && budgetValid && purchasesValid && (
                <div className="p-4 rounded-xl bg-accent text-accent-foreground">
                  <p className="text-sm font-medium">תקציב לביקור: <span className="font-bold">₪{budgetPerPurchase.toFixed(2)}</span></p>
                </div>
              )}
            </div>
          )}

          {/* Step 4: Review */}
          {step === 4 && (
            <div className="space-y-5">
              <h3 className="font-heading font-semibold text-lg">הפרופיל המחושב שלכם</h3>

              {/* Section A: Current status */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" />
                  <h4 className="text-sm font-semibold text-muted-foreground">מצב נוכחי</h4>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-3 rounded-lg bg-muted">
                    <p className="text-xs text-muted-foreground">BMI</p>
                    <p className="font-heading font-bold text-lg">{bmi.toFixed(1)}</p>
                    <p className="text-xs text-muted-foreground">{getBMICategoryHe(bmi)}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted">
                    <p className="text-xs text-muted-foreground">BMR (קצב מטבולי בסיסי)</p>
                    <p className="font-heading font-bold text-lg">{Math.round(bmr)}</p>
                    <p className="text-xs text-muted-foreground">קל'/יום</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted col-span-2">
                    <p className="text-xs text-muted-foreground">ציון כושר ובריאות (בסיסי)</p>
                    <p className="font-heading font-bold text-lg">{healthScore}/100</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      מבוסס על BMI, רמת פעילות ואימוני כוח. BMI לבדו לא תמיד משקף מסת שריר.
                      הציון ישתפר לאחר העלאת קבלות ויצירת תפריט תזונה.
                    </p>
                  </div>
                  {form.strength_training && form.strength_training !== "none" && (
                    <div className="p-3 rounded-lg bg-muted col-span-2">
                      <p className="text-xs text-muted-foreground">אימוני כוח</p>
                      <p className="font-heading font-bold">{STRENGTH_LABELS[form.strength_training]}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Section B: Daily goals */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                  <h4 className="text-sm font-semibold text-muted-foreground">יעדים יומיים</h4>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-3 rounded-lg bg-muted col-span-2">
                    <p className="text-xs text-muted-foreground">מטרה</p>
                    <p className="font-heading font-bold">{GOAL_LABELS[form.goal]}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted">
                    <p className="text-xs text-muted-foreground">קלוריות יומיות</p>
                    <p className="font-heading font-bold text-lg">{dailyCalories}</p>
                    <p className="text-xs text-muted-foreground">קל'/יום</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted">
                    <p className="text-xs text-muted-foreground">יעד חלבון</p>
                    <p className="font-heading font-bold text-lg">{macros.protein}ג</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted">
                    <p className="text-xs text-muted-foreground">יעד פחמימות</p>
                    <p className="font-heading font-bold text-lg">{macros.carbs}ג</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted">
                    <p className="text-xs text-muted-foreground">יעד שומן</p>
                    <p className="font-heading font-bold text-lg">{macros.fat}ג</p>
                  </div>
                </div>
              </div>

              {/* Section C: Budget & preferences */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
                  <h4 className="text-sm font-semibold text-muted-foreground">תקציב והעדפות</h4>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-3 rounded-lg bg-muted">
                    <p className="text-xs text-muted-foreground">תקציב חודשי</p>
                    <p className="font-heading font-bold text-lg">₪{form.monthly_budget}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted">
                    <p className="text-xs text-muted-foreground">תקציב לביקור</p>
                    <p className="font-heading font-bold text-lg">₪{budgetPerPurchase.toFixed(2)}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted col-span-2">
                    <p className="text-xs text-muted-foreground">ביקורים בחודש</p>
                    <p className="font-heading font-bold">{form.purchases_per_month} פעמים</p>
                  </div>
                  {form.dietary_preferences.length > 0 && (
                    <div className="p-3 rounded-lg bg-muted col-span-2">
                      <p className="text-xs text-muted-foreground mb-1.5">העדפות תזונה</p>
                      <div className="flex flex-wrap gap-1">
                        {form.dietary_preferences.map(d => (
                          <span key={d} className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">{d}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {form.allergies.length > 0 && (
                    <div className="p-3 rounded-lg bg-muted col-span-2">
                      <p className="text-xs text-muted-foreground mb-1.5">אלרגיות</p>
                      <div className="flex flex-wrap gap-1">
                        {form.allergies.map(a => (
                          <span key={a} className="px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-xs font-medium">{a}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {(form.favorite_foods.length > 0 || form.disliked_foods.length > 0) && (
                    <div className="p-3 rounded-lg bg-muted col-span-2">
                      <div className="grid grid-cols-2 gap-3">
                        {form.favorite_foods.length > 0 && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">מאכלים אהובים</p>
                            <p className="text-sm">{form.favorite_foods.join(', ')}</p>
                          </div>
                        )}
                        {form.disliked_foods.length > 0 && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">מאכלים לא אהובים</p>
                            <p className="text-sm">{form.disliked_foods.join(', ')}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Validation / save errors (Hebrew) */}
          {step < STEPS.length - 1 && !canNext() && (step === 0 || step === 3) && validationErrors().length > 0 && (
            <p className="text-xs text-muted-foreground mt-6" role="status">
              כדי להמשיך: {validationErrors().join(" · ")}
            </p>
          )}
          {step === STEPS.length - 1 && (saveErrors.length > 0 || saveMutation.isError) && (
            <div role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 text-destructive text-sm p-3 mt-6">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                {saveErrors.length > 0
                  ? `חסרים פרטים: ${saveErrors.join(" · ")}`
                  : "שמירת הפרופיל נכשלה. בדקו את החיבור ונסו שוב."}
              </span>
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between mt-8">
            {step < STEPS.length - 1 ? (
              <Button disabled={!canNext()} onClick={() => setStep(s => s + 1)}>
                המשך <ChevronLeft className="w-4 h-4 mr-1" />
              </Button>
            ) : (
              <Button onClick={handleFinish} disabled={saveMutation.isPending} aria-busy={saveMutation.isPending}>
                {saveMutation.isPending
                  ? <><Loader2 className="w-4 h-4 ml-1 animate-spin" /> שומר...</>
                  : <><Check className="w-4 h-4 ml-1" /> סיום</>}
              </Button>
            )}
            <Button variant="outline" disabled={step === 0 || saveMutation.isPending} onClick={() => setStep(s => s - 1)}>
              <ChevronRight className="w-4 h-4 ml-1" /> חזרה
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}