import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { ShoppingCart, TrendingDown, Heart, Receipt, Sparkles, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/localAPI";
import { useAuth } from "@/lib/AuthContext";

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.15, duration: 0.6, ease: [0.22, 1, 0.36, 1] },
  }),
};

const FEATURES = [
  {
    icon: TrendingDown,
    title: "שליטה בהוצאות החודשיות",
    desc: "עקבו אחרי כל שקל מהקבלות שלכם. ראו לאן הולך הכסף ואיך לקנות חכם יותר.",
    color: "bg-blue-50 text-blue-600",
  },
  {
    icon: Heart,
    title: "תפריט תזונה אישי",
    desc: "הבינה המלאכותית יוצרת תפריט שבועי המותאם למטרות הבריאות, ההעדפות והתקציב שלכם.",
    color: "bg-emerald-50 text-emerald-600",
  },
  {
    icon: Receipt,
    title: "תובנות מזון מהקבלה",
    desc: "העלו קבלות וגלו את הרגלי האכילה האמיתיים שלכם. הAI מזהה דפוסים ומציע שיפורים.",
    color: "bg-purple-50 text-purple-600",
  },
];

const STEPS = [
  { num: "01", title: "העלאת קבלה", desc: "צלמו תמונה או הדביקו את טקסט הקבלה" },
  { num: "02", title: "ניתוח AI", desc: "הבינה המלאכותית מסווגת מוצרי מזון וערכים תזונתיים" },
  { num: "03", title: "סל קניות חכם", desc: "קבלו רשימת קניות מותאמת לתקציב ולמטרות שלכם" },
  { num: "04", title: "תפריט שבועי", desc: "קבלו תפריט אישי לכל השבוע" },
];

export default function Landing() {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();

  const { data: profiles } = useQuery({
    queryKey: ["userProfile", user?.email],
    queryFn: () => api.entities.UserProfile.filter({ created_by: user.email }),
    initialData: [],
    enabled: isAuthenticated && !!user,
  });

  const profileComplete = profiles?.[0]?.onboarding_complete === true;

  const handleStart = () => {
    if (!isAuthenticated) return navigate("/login");
    navigate(profileComplete ? "/dashboard" : "/onboarding");
  };

  return (
    <div className="min-h-screen bg-background font-body" dir="rtl">
      {/* Navbar */}
      <nav className="fixed top-0 w-full z-50 bg-background/80 backdrop-blur-lg border-b">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
              <ShoppingCart className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-heading font-bold text-xl">BetterCart</span>
          </div>
          <Button onClick={handleStart} size="sm" className="rounded-full px-5">
            <ChevronLeft className="w-4 h-4 ml-1" /> התחילו עכשיו
          </Button>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <motion.div
            custom={0}
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-accent text-accent-foreground text-sm font-medium mb-6"
          >
            <Sparkles className="w-4 h-4" />
            ניתוח קבלות חכם בבינה מלאכותית
          </motion.div>

          <motion.h1
            custom={1}
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="font-heading text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight leading-[1.2] mb-6"
          >
            חסכו כסף.{" "}
            <span className="text-primary">אכלו בריא יותר.</span>
          </motion.h1>

          <motion.p
            custom={2}
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="text-lg text-muted-foreground max-w-xl mx-auto mb-10 leading-relaxed"
          >
            בנו תפריט תזונה אישי מתוך הקבלות האמיתיות שלכם מהסופר.
            BetterCart משתמשת בבינה מלאכותית לנתח את הרגלי הקנייה שלכם וליצור תפריט בריא וחכם שמתאים לתקציב.
          </motion.p>

          <motion.div custom={3} variants={fadeUp} initial="hidden" animate="visible" className="space-y-3">
            <Button onClick={handleStart} size="lg" className="rounded-full px-8 text-base h-12">
              <ChevronLeft className="w-5 h-5 ml-1" /> התחילו בחינם
            </Button>
            <p className="text-xs text-muted-foreground">
              כרגע תומכת בקבלות מ־<strong>רמי לוי</strong> ו־<strong>שופרסל</strong>
            </p>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-4 bg-muted/40">
        <div className="max-w-5xl mx-auto">
          <h2 className="font-heading text-3xl font-bold text-center mb-12">
            שלושה עמודי תווך לקנייה חכמה
          </h2>
          <div className="grid md:grid-cols-3 gap-6">
            {FEATURES.map((f, i) => (
              <motion.div key={f.title} custom={i} variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}>
                <Card className="p-6 h-full hover:shadow-lg transition-shadow border-0 shadow-sm">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${f.color}`}>
                    <f.icon className="w-6 h-6" />
                  </div>
                  <h3 className="font-heading font-semibold text-lg mb-2">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="font-heading text-3xl font-bold text-center mb-12">איך זה עובד?</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {STEPS.map((s, i) => (
              <motion.div key={s.num} custom={i} variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}>
                <div className="text-center">
                  <div className="text-4xl font-heading font-extrabold text-primary/20 mb-3">{s.num}</div>
                  <h3 className="font-heading font-semibold mb-1">{s.title}</h3>
                  <p className="text-sm text-muted-foreground">{s.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Supported stores notice */}
      <section className="py-8 px-4 bg-accent/50">
        <div className="max-w-2xl mx-auto text-center">
          <p className="text-sm text-muted-foreground">
            🛒 בשלב זה BetterCart תומכת בקבלות מ<strong className="text-foreground"> רמי לוי </strong>ו<strong className="text-foreground">שופרסל</strong>. אנחנו עובדים על תמיכה ברשתות נוספות בהמשך.
          </p>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="py-20 px-4 bg-primary text-primary-foreground">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="font-heading text-3xl font-bold mb-4">מוכנים לאכול חכם יותר?</h2>
          <p className="text-primary-foreground/80 mb-8">
            הצטרפו ל-BetterCart והפכו את הקבלות מהסופר לתפריט תזונה אישי.
          </p>
          <Button onClick={handleStart} size="lg" variant="secondary" className="rounded-full px-8 h-12 text-base">
            <ChevronLeft className="w-5 h-5 ml-1" /> התחילו עכשיו בחינם
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-6 px-4 border-t text-center text-sm text-muted-foreground">
        © 2026 BetterCart — פרויקט גמר
      </footer>
    </div>
  );
}
