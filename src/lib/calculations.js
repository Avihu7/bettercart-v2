/**
 * BetterCart Health & Budget Calculations
 * Core formulas for BMI, BMR, calorie targets, and macro distribution.
 */

const ACTIVITY_FACTORS = {
  sedentary: 1.2,
  lightly_active: 1.375,
  moderately_active: 1.55,
  very_active: 1.725,
  extra_active: 1.9,
};

// BMI = weight (kg) / height (m)²
export function calculateBMI(weight, heightCm) {
  const heightM = heightCm / 100;
  return Math.round((weight / (heightM * heightM)) * 10) / 10;
}

// BMR using Mifflin-St Jeor formula
export function calculateBMR(weight, heightCm, age, gender) {
  const base = 10 * weight + 6.25 * heightCm - 5 * age;
  return gender === "female" ? base - 161 : base + 5;
}

// Daily calorie target based on goal
export function calculateDailyCalories(bmr, activityLevel, goal) {
  const factor = ACTIVITY_FACTORS[activityLevel] || 1.55;
  const tdee = bmr * factor;

  switch (goal) {
    case "weight_loss":
      return Math.round(tdee - 400);
    case "weight_gain":
      return Math.round(tdee + 400);
    default:
      return Math.round(tdee);
  }
}

// Protein g per kg body weight, by goal and strength-training frequency.
// Resistance-training evidence: ~1.6 g/kg covers most muscle gain, up to ~2.0
// in practice; higher (up to 2.2) helps preserve lean mass in a calorie deficit.
// "5+" is the legacy option, treated as 6–7 sessions.
const PROTEIN_FACTORS = {
  standard: { none: 1.6, '1-2': 1.7, '3-5': 1.8, '6-7': 1.9, '5+': 1.9, elite: 2.0 },
  weight_loss: { none: 1.8, '1-2': 1.9, '3-5': 2.0, '6-7': 2.1, '5+': 2.1, elite: 2.2 },
};
const MAX_PROTEIN_PER_KG = 2.2;

// Fat stays a share of calories (unchanged); carbs take the remaining calories.
const FAT_RATIO = { weight_loss: 0.30, weight_gain: 0.25, maintenance: 0.30 };

export function proteinFactor(goal, strengthTraining = 'none') {
  const table = goal === 'weight_loss' ? PROTEIN_FACTORS.weight_loss : PROTEIN_FACTORS.standard;
  return Math.min(table[strengthTraining] ?? table.none, MAX_PROTEIN_PER_KG);
}

// Macro targets (grams). Protein first from body weight (never above 2.2 g/kg),
// fat as a share of calories, carbs get the remaining calories.
export function calculateMacros(dailyCalories, goal, weight, strengthTraining = 'none') {
  const fatRatio = FAT_RATIO[goal] ?? FAT_RATIO.maintenance;
  const protein = weight > 0
    ? Math.round(weight * proteinFactor(goal, strengthTraining))
    : Math.round((dailyCalories * 0.3) / 4); // no weight yet: fall back to 30% of calories
  const fat = Math.round((dailyCalories * fatRatio) / 9);
  const carbs = Math.max(0, Math.round((dailyCalories - protein * 4 - fat * 9) / 4));
  return { protein, carbs, fat };
}

/**
 * The macro targets for a saved profile, always from the current formula —
 * so profiles saved under an older formula show and use consistent targets.
 */
export function profileMacroTargets(profile) {
  if (!profile?.daily_calories) {
    return { protein: profile?.protein_target, carbs: profile?.carbs_target, fat: profile?.fat_target };
  }
  return calculateMacros(profile.daily_calories, profile.goal, Number(profile.weight), profile.strength_training || 'none');
}

// Budget per purchase
export function calculateBudgetPerPurchase(monthlyBudget, purchasesPerMonth) {
  if (!purchasesPerMonth || purchasesPerMonth === 0) return monthlyBudget;
  return Math.round((monthlyBudget / purchasesPerMonth) * 100) / 100;
}

// Health score based on BMI
export function calculateHealthScore(bmi, activityLevel) {
  let score = 50;

  // BMI scoring
  if (bmi >= 18.5 && bmi <= 24.9) score += 30;
  else if (bmi >= 25 && bmi <= 29.9) score += 15;
  else if (bmi < 18.5) score += 10;
  else score += 5;

  // Activity scoring
  const activityScores = {
    sedentary: 5,
    lightly_active: 10,
    moderately_active: 15,
    very_active: 18,
    extra_active: 20,
  };
  score += activityScores[activityLevel] || 10;

  return Math.min(100, Math.max(0, score));
}

// BMI category label (English, kept for backward compat)
export function getBMICategory(bmi) {
  if (bmi < 18.5) return "Underweight";
  if (bmi < 25) return "Normal";
  if (bmi < 30) return "Overweight";
  return "Obese";
}

// BMI category label (Hebrew)
export function getBMICategoryHe(bmi) {
  if (!bmi) return "";
  if (bmi < 18.5) return "תת-משקל";
  if (bmi < 25) return "משקל תקין";
  if (bmi < 30) return "עודף משקל";
  return "השמנה";
}

// Format currency
export function formatCurrency(amount) {
  return `₪${(amount || 0).toFixed(2)}`;
}

/**
 * Calculates a fitness & health score (0–100) from multiple factors.
 *
 * Components and their individual maximums:
 *   Base ..................  20 pts  (always)
 *   BMI ...................   0–30 pts
 *   Activity level ........   0–20 pts
 *   Strength training .....   0–12 pts  (strengthTraining field)
 *   Muscle–BMI bonus ......   0–6  pts  (ONLY when BMI 25–29.9; see note below)
 *   Diet diversity ........   0–20 pts  (approved receipt items)
 *   Calorie accuracy ......   0–10 pts  (nutrition plan vs. daily target)
 *
 * Theoretical maximum before capping:
 *   112 pts  — achieved when BMI is in the healthy range (18.5–24.9, which
 *              scores 30 pts) because the muscle-BMI bonus condition (bmi ≥ 25)
 *              cannot fire simultaneously.
 *   108 pts  — best case when BMI is 25–27.9 (20 pts + up to 6 bonus = 26).
 *   The naive column-sum of 118 is not reachable: the bonus and the top BMI
 *   tier (30 pts) are mutually exclusive.
 *
 * Result is clamped to [0, 100] by Math.min / Math.max.
 * Reaching 100 requires: normal BMI + extra_active + diverse diet + accurate
 * calories — typical healthy-but-not-elite users score 70–95.
 *
 * The muscle–BMI bonus compensates for BMI overestimating body fat in
 * active or muscular users whose BMI falls in the 25–29.9 range.
 */
export function calculateFitnessScore({
  bmi,
  activityLevel,
  strengthTraining = 'none',
  receiptItems = [],
  dailyCalories = 0,
  calorieTarget = 0,
}) {
  let score = 20; // base

  // BMI component (0–30)
  if      (bmi >= 18.5 && bmi <= 24.9) score += 30;
  else if (bmi >= 17   && bmi <  18.5) score += 18;
  else if (bmi >= 25   && bmi <= 27.9) score += 20;
  else if (bmi >= 28   && bmi <= 29.9) score += 12;
  else if (bmi >= 30   && bmi <= 34.9) score +=  6;
  else                                  score +=  2;

  // Activity component (0–20)
  const activityScores = {
    sedentary:         4,
    lightly_active:    9,
    moderately_active: 14,
    very_active:       17,
    extra_active:      20,
  };
  score += activityScores[activityLevel] ?? 9;

  // Strength training component (0–12)
  const strengthScores = { none: 0, '1-2': 4, '3-5': 10, '5+': 12, '6-7': 12, elite: 12 };
  score += strengthScores[strengthTraining] ?? 0;

  // Muscle–BMI interaction bonus (0–6):
  // Applied only when BMI is in the penalised 25–29.9 "overweight" range.
  // High-frequency training suggests elevated muscle mass rather than excess fat.
  if (bmi >= 25 && bmi <= 29.9) {
    const highTraining  = ['3-5', '5+', '6-7', 'elite'].includes(strengthTraining);
    const activeEnough  = ['moderately_active', 'very_active', 'extra_active'].includes(activityLevel);
    if (highTraining && activeEnough) score += 6;
    else if (highTraining || activeEnough) score += 3;
  }

  // Diet diversity component (0–20): unique food categories among approved receipt items
  const approvedItems    = receiptItems.filter(i => i.is_approved_for_menu);
  const uniqueCategories = new Set(approvedItems.map(i => i.category)).size;
  if      (uniqueCategories >= 5) score += 20;
  else if (uniqueCategories >= 4) score += 15;
  else if (uniqueCategories >= 3) score += 10;
  else if (uniqueCategories >= 2) score +=  5;

  // Calorie accuracy component (0–10): nutrition-plan daily average vs. profile target
  if (calorieTarget > 0 && dailyCalories > 0) {
    const ratio = dailyCalories / calorieTarget;
    if      (ratio >= 0.9 && ratio <= 1.1) score += 10;
    else if (ratio >= 0.8 && ratio <= 1.2) score +=  6;
    else if (ratio >= 0.7 && ratio <= 1.3) score +=  3;
  }

  return Math.min(100, Math.max(0, Math.round(score)));
}