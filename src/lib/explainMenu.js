/**
 * Explanation layer — turns a validateMenu() result into what the user reads:
 * the quality level, why the menu looks the way it does, what limits it, and
 * what to add or change. Deterministic: the same validation gives the same text.
 *
 * Returns { level, tone, title, points: [{ area, text }], add: [Hebrew food
 * types to add], budgetAction: boolean (point to the basket's budget card) }.
 */
import { buildFinalShoppingList } from "@/lib/shoppingOptimizer";
import { classifyProduct } from "@/lib/mealPlanRules";

const TITLES = {
  1: "תפריט מגוון, מאוזן ובתקציב",
  2: "התפריט עומד ביעדים ובתקציב — עם מגוון מוגבל",
  3: "התפריט לא עומד בכל היעדים או בתקציב",
  4: "אי אפשר לבנות תפריט סביר מהסל הנוכחי",
};
const TONES = { 1: "good", 2: "info", 3: "warn", 4: "bad" };
const DAY_HE = { Sunday: "ראשון", Monday: "שני", Tuesday: "שלישי", Wednesday: "רביעי", Thursday: "חמישי", Friday: "שישי", Saturday: "שבת" };
const days = list => list.map(d => DAY_HE[d.day] || d.day).join(", ");
const shekel = n => `₪${Math.round(n * 10) / 10}`;
const PROTEIN_GROUPS = new Set(["meat", "fish", "eggs", "legumes", "dairy_protein", "yogurt"]);

// The two products that give the week most of its fat ("גבינה צהובה ובשר טחון")
function fatSources(plan) {
  const fat = new Map();
  for (const d of plan?.days || []) for (const m of d.meals) for (const i of m.items) fat.set(i.food_name, (fat.get(i.food_name) || 0) + (Number(i.fat) || 0));
  const top = [...fat].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n);
  return top.length === 2 ? `${top[0]} ו${top[1]}` : top[0] || "";
}
// "מקור חלבון אחד" / "2 מקורות חלבון"
const proteinCount = n => (n === 1 ? "מקור חלבון אחד" : `${n} מקורות חלבון`);

// What to add, by what is missing — short Hebrew food types
const ADD = {
  protein: "מקור חלבון לארוחות (עוף, טונה, ביצים או קטניות)",
  carb: "פחמימה (אורז, פסטה, תפוחי אדמה או לחם)",
  vegetable: "ירקות",
  breakfast: "משהו לארוחת בוקר (לחם, ביצים, יוגורט או פרי)",
  eggs: "ביצים", yogurt: "יוגורט", cereal: "דגני בוקר או שיבולת שועל עם חלב",
  lunchProtein: "מקור חלבון נוסף לצהריים (קטניות, טונה, עוף או הודו)",
  moreVegetables: "עוד סוגי ירקות", moreFruit: "עוד סוגי פירות", moreCarbs: "עוד סוג פחמימה (אורז, פסטה או תפוחי אדמה)",
  fat: "שמן זית, טחינה או אגוזים",
};

export function explainMenu(validation, { plan, basketItems, profile, budgetLabel = null, menuAlternatives = null } = {}) {
  const { level, checks, offer, stats } = validation;
  const check = id => checks.find(c => c.id === id);
  const bad = id => { const c = check(id); return c && !c.ok; };
  const limited = id => { const c = check(id); return c && c.ok && c.limited; };
  const points = [];
  const add = new Set();
  let budgetAction = false;
  const say = (area, text) => points.push({ area, text });

  // ── coverage / safety / realism (level 4)
  const missing = check("coverage")?.data.missing || [];
  if (missing.length) {
    say("coverage", `בסל חסרים סוגי מזון בסיסיים לתפריט שבועי: ${missing.map(m => ADD[m]).join("; ")}.`);
    missing.forEach(m => add.add(ADD[m]));
  }
  for (const id of ["products_exist", "no_non_food", "profile_safe", "kosher_separation"]) {
    if (bad(id)) say("safety", `שגיאה: ${check(id).message} — לא מתקיים. התפריט לא יוצג עד שזה יתוקן.`);
  }
  if (bad("meals_per_day")) say("realism", `בחלק מהימים יש פחות מ-3 ארוחות — אין בסל מספיק מוצרים לכל הארוחות.`);
  if (bad("meal_slots") && !bad("meals_per_day")) {
    const missing = check("meal_slots").data.missing;
    const breakfast = missing.some(m => m.endsWith("Breakfast"));
    say("realism", breakfast
      ? "בחלק מהימים אין ארוחת בוקר — אין בסל מוצרים לארוחת בוקר (לחם, ביצים, יוגורט, דגני בוקר או פרי)."
      : `בחלק מהימים חסרה ארוחה (${missing.length}) — אין בסל מספיק מוצרים לכל הארוחות.`);
    if (breakfast) add.add(ADD.breakfast);
  }
  if (bad("meal_rules")) {
    const n = check("meal_rules").data.problems.length;
    say("realism", `${n} ארוחות לא עומדות בחוקי הארוחה (למשל ארוחה עיקרית בלי חלבון).`);
  }

  // ── budget
  const within = check("within_budget");
  if (within && !within.ok) {
    budgetAction = true;
    const { cost, budget, over } = within.data;
    // over which budget: the food budget, and what it is made of (src/lib/budgetModel.js foodBudgetLabel)
    let text = `עלות המזון לשבוע ${shekel(cost)} — ${shekel(over)} מעל תקציב המזון השבועי (${shekel(budget)}).`;
    if (budgetLabel) text += ` ${budgetLabel}.`;
    const swaps = plan?.budget?.swaps?.length || 0;
    if (swaps) text += ` כדי להתקרב לתקציב כבר הוחלפו ${swaps} מנות במוצרים זולים יותר מהסל.`;
    // Is protein what makes it expensive? (the share of the week's cost in protein foods)
    if (plan?.days && basketItems) {
      const lines = buildFinalShoppingList(basketItems, plan.days).items;
      const proteinCost = lines.filter(l => PROTEIN_GROUPS.has(classifyProduct(l.name, l.category))).reduce((s, l) => s + (Number(l.estimated_price) || 0), 0);
      const share = cost ? proteinCost / cost : 0;
      if (share >= 0.45 && profile?.protein_target) {
        text += ` מקורות החלבון הם ${Math.round(share * 100)}% מהעלות — יעד החלבון שלך (${profile.protein_target} ג׳ ביום) יקר ביחס לתקציב.`;
        text += " אפשר להחליף מוצרים יקרים בסל, להגדיל את התקציב, או להוריד את יעד החלבון.";
      } else {
        text += " אפשר להחליף מוצרים יקרים בסל או להגדיל את התקציב.";
      }
    }
    say("budget", text);
  }
  if (bad("cost_matches_list")) say("budget", "עלות התפריט לא תואמת את רשימת הקניות הסופית — בנו את התפריט מחדש.");

  // ── nutrition
  if (bad("calories")) say("nutrition", `הקלוריות מחוץ לטווח ±5% מהיעד בימים: ${days(check("calories").data.off)}.`);
  if (bad("protein")) {
    const low = check("protein").data.low;
    const fewProteins = offer.mainProteins.length < 3;
    say("nutrition", `החלבון מתחת ל-90% מהיעד בימים: ${days(low)}${fewProteins ? " — בסל אין מספיק מקורות חלבון" : ""}.`);
    if (fewProteins) add.add(ADD.lunchProtein);
  }
  if (bad("fat")) {
    const off = check("fat").data.off;
    const high = off.filter(d => d.fat > (profile?.fat_target || 0));
    say("nutrition", high.length >= off.length / 2
      ? `השומן גבוה מהיעד בימים: ${days(high)}${fatSources(plan) ? ` — בעיקר מ${fatSources(plan)}` : ''}.`
      : `השומן נמוך מהיעד בימים: ${days(off)}.`);
    if (high.length < off.length / 2 && !(basketItems || []).some(i => ["oil", "tahini", "nuts"].includes(classifyProduct(i.name)))) add.add(ADD.fat);
  }
  if (level === 3 && bad("within_budget") && !["calories", "protein", "fat"].some(bad)) {
    say("nutrition", "היעדים התזונתיים מתקיימים — הפער הוא בתקציב בלבד.");
  }

  // ── variety
  // Alternatives in the basket do not mean another valid week: "בנייה מחדש" is suggested only
  // when the planner found more than one valid menu (menuAlternatives; unknown → no promise)
  const rebuildHelps = menuAlternatives > 1;
  const proteinLimits = bad("protein") || limited("protein_sources") || limited("lunch_protein_repeat") || limited("protein_dominance");
  const noOtherWeek = proteinLimits
    ? "הסל הנוכחי מגביל את הגיוון בגלל מחסור במקורות חלבון ריאליים. כדי לקבל תפריט מגוון יותר, אפשר לבחור סל חלופי או להוסיף לסל עוד מקורות חלבון מתאימים."
    : "לא נמצאה חלופה שבועית ריאלית נוספת מהסל הנוכחי. כדי לקבל תפריט מגוון יותר, אפשר לבחור סל חלופי או להוסיף לסל עוד מקורות חלבון, פחמימה או ירקות מתאימים.";
  const lunchRepeat = check("lunch_protein_repeat");
  if (lunchRepeat && lunchRepeat.data.overLunch.length) {
    const { product, lunches } = lunchRepeat.data.overLunch[0];
    if (lunchRepeat.limited) {
      say("variety", `${product} מופיע ב-${lunches} ארוחות צהריים, כי זה מקור החלבון היחיד לצהריים בסל.`);
      add.add(ADD.lunchProtein);
    } else {
      say("variety", rebuildHelps
        ? `${product} מופיע ב-${lunches} ארוחות צהריים, למרות שיש בסל חלופות — אפשר לנסות "בנייה מחדש" לתפריט מגוון יותר.`
        : `${product} מופיע ב-${lunches} ארוחות צהריים. ${noOtherWeek}`);
    }
  }
  const dominance = check("protein_dominance");
  if (dominance && dominance.data.dominant.length) {
    const { product, meals, of } = dominance.data.dominant[0];
    say("variety", `${product} הוא החלבון העיקרי ב-${meals} מתוך ${of} הארוחות העיקריות${dominance.limited ? " — אין בסל מספיק חלופות" : ""}.`);
    if (dominance.limited) add.add(ADD.lunchProtein);
  }
  if (limited("protein_sources")) {
    say("variety", `בתפריט ${proteinCount(check("protein_sources").data.used)} בלבד — זה כל מה שיש בסל.`);
    add.add(ADD.lunchProtein);
  } else if (bad("protein_sources")) {
    say("variety", `בתפריט רק ${check("protein_sources").data.used} מקורות חלבון, למרות שיש בסל ${check("protein_sources").data.available}.`);
  }
  const breakfast = check("breakfast_variety");
  if (breakfast && (limited("breakfast_variety") || bad("breakfast_variety"))) {
    const absent = [!offer.has.eggs && "ביצים", !offer.has.yogurt && "יוגורט", !offer.has.cereal && "דגני בוקר"].filter(Boolean);
    if (limited("breakfast_variety")) {
      say("variety", `ארוחת הבוקר חוזרת על עצמה כי בסל אין ${absent.length ? absent.join(", ") : "מוצרים נוספים לארוחת בוקר"}.`);
      if (!offer.has.eggs) add.add(ADD.eggs);
      if (!offer.has.yogurt) add.add(ADD.yogurt);
      if (!offer.has.cereal) add.add(ADD.cereal);
    } else {
      say("variety", rebuildHelps
        ? "ארוחת הבוקר חוזרת על עצמה למרות שיש בסל חלופות — אפשר לנסות \"בנייה מחדש\" לתפריט מגוון יותר."
        : `ארוחת הבוקר חוזרת על עצמה. ${noOtherWeek}`);
    }
  }
  // The same foods moved between breakfast, lunch and dinner — honest about whether the basket allows better
  const cross = check("cross_meal_repeat");
  const repeatedFood = check("product_repeat");
  const crossBad = cross && (bad("cross_meal_repeat") || limited("cross_meal_repeat"));
  const foodBad = repeatedFood && (bad("product_repeat") || limited("product_repeat"));
  if (crossBad || foodBad) {
    const top = repeatedFood?.data.overused[0];
    const what = top ? ` (${top.product} מופיע ב-${top.meals} מתוך ${top.of} הארוחות)` : "";
    if (limited("cross_meal_repeat") || limited("product_repeat")) {
      const diet = (profile?.dietary_preferences || []).join(" ");
      const examples = /טבעוני|vegan/i.test(diet) ? "טופו, טמפה, עדשים, חומוס"
        : /צמחוני|vegetarian/i.test(diet) ? "ביצים, יוגורט, קטניות" : "ביצים, יוגורט, טונה, קטניות";
      say("variety", `בסל יש מגוון מוגבל, ולכן התפריט חוזר על אותם מוצרים בבוקר, בצהריים ובערב${what}. כדי לגוון — הוסיפו לסל ${examples} או עוד סוג פחמימה.`);
      // (the generic protein suggestion names meat and fish — not for a vegetarian / vegan profile)
      if (!/טבעוני|צמחוני|vegan|vegetarian/i.test(diet)) add.add(ADD.lunchProtein);
      add.add(ADD.moreCarbs);
    } else {
      say("variety", rebuildHelps
        ? `התפריט חוזר על אותם מוצרים בבוקר, בצהריים ובערב${what}. יש חלופות בסל — אפשר לנסות "בנייה מחדש" לתפריט מגוון יותר.`
        : `התפריט חוזר על חלק מהמוצרים${what} כי לא נמצאה חלופה שבועית ריאלית נוספת מהסל הנוכחי. ${proteinLimits ? "הסל הנוכחי מגביל את הגיוון בגלל מחסור במקורות חלבון ריאליים. " : ""}כדי לקבל תפריט מגוון יותר, אפשר לבחור סל חלופי או להוסיף לסל עוד מקורות חלבון, פחמימה או ירקות מתאימים.`);
    }
  }

  const rotation = (id, text, suggestion, emptyText) => {
    if (limited(id)) {
      const n = check(id).data.available;
      say("variety", n ? `${text} — אלה כל הסוגים שיש בסל (${n}).` : `${emptyText}.`);
      add.add(suggestion);
    }
    else if (bad(id)) say("variety", `${text}, למרות שיש בסל יותר סוגים.`);
  };
  rotation("carb_rotation", "מעט סוגי פחמימות בארוחות העיקריות", ADD.moreCarbs, "אין בסל פחמימה לארוחות העיקריות");
  rotation("vegetable_rotation", "מעט סוגי ירקות במהלך השבוע", ADD.moreVegetables, "אין בסל ירקות");
  rotation("fruit_rotation", "מעט סוגי פירות במהלך השבוע", ADD.moreFruit, "אין בסל פירות");

  if (level === 1) say("summary", `${offer.mainProteins.length} מקורות חלבון, ${Object.keys(check("breakfast_variety")?.data.styles || {}).length} סגנונות ארוחת בוקר, העלות ${shekel(stats.cost)}${stats.budget ? ` מתוך ${shekel(stats.budget)}` : ""}.`);

  // Level 4: say what is missing and what breaks — the nutrition / variety
  // symptoms that follow from it would only bury that
  const shown = level === 4 ? points.filter(p => ["coverage", "safety", "realism"].includes(p.area)) : points;
  return { level, tone: TONES[level], title: TITLES[level], points: shown, add: [...add], budgetAction };
}
