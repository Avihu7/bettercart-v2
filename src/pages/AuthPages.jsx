import React, { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShoppingCart, Loader2, AlertCircle } from "lucide-react";
import { toast } from "@/components/ui/use-toast";

const MIN_PASSWORD_LENGTH = 8;

function AuthShell({ title, subtitle, children }) {
  return (
    <div className="min-h-screen bg-background font-body flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center text-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center">
            <ShoppingCart className="w-6 h-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-bold">{title}</h1>
            {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
          </div>
        </div>
        <Card className="p-6">{children}</Card>
      </div>
    </div>
  );
}

function ErrorNote({ message }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 text-destructive text-sm p-3">
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function Field({ id, label, ...props }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} dir={props.type === "email" ? "ltr" : undefined} className={props.type === "email" ? "text-right" : undefined} {...props} />
    </div>
  );
}

export function LoginPage() {
  const { login, isAuthenticated, isLoadingAuth } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || "/dashboard";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!isLoadingAuth && isAuthenticated) return <Navigate to={from} replace />;

  const submit = async e => {
    e.preventDefault();
    setError("");
    if (!email.trim() || !password) return setError("נא למלא אימייל וסיסמה");
    setBusy(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="ברוכים הבאים ל-BetterCart" subtitle="התחברו כדי להמשיך לתוכנית האישית שלכם">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field id="email" label="אימייל" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
        <Field id="password" label="סיסמה" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
        <ErrorNote message={error} />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy && <Loader2 className="w-4 h-4 ml-2 animate-spin" />} התחברות
        </Button>
      </form>
      <p className="text-sm text-center text-muted-foreground mt-5">
        עדיין אין לך חשבון? <Link to="/register" className="text-primary font-medium hover:underline">הרשמה</Link>
      </p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { register, isAuthenticated, isLoadingAuth } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);

  if (!isLoadingAuth && isAuthenticated && !created) return <Navigate to="/dashboard" replace />;

  const submit = async e => {
    e.preventDefault();
    setError("");
    if (!email.trim()) return setError("נא להזין אימייל");
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`הסיסמה חייבת להכיל לפחות ${MIN_PASSWORD_LENGTH} תווים`);
    if (password !== confirm) return setError("הסיסמאות אינן תואמות");
    setBusy(true);
    try {
      setCreated(true);
      await register(email, password);
      toast({ title: "החשבון נוצר בהצלחה" });
      navigate("/onboarding", { replace: true });
    } catch (err) {
      setCreated(false);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="יצירת חשבון" subtitle="החשבון שומר את הפרופיל, הקבלות והתפריטים שלכם">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field id="email" label="אימייל" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
        <Field id="password" label="סיסמה" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} />
        <p className="text-xs text-muted-foreground -mt-2">לפחות {MIN_PASSWORD_LENGTH} תווים</p>
        <Field id="confirm" label="אימות סיסמה" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} />
        <ErrorNote message={error} />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy && <Loader2 className="w-4 h-4 ml-2 animate-spin" />} יצירת חשבון
        </Button>
      </form>
      <p className="text-sm text-center text-muted-foreground mt-5">
        כבר יש לך חשבון? <Link to="/login" className="text-primary font-medium hover:underline">התחברות</Link>
      </p>
    </AuthShell>
  );
}

/** Route guard: waits for the auth check, then shows the page or redirects to /login. */
export function RequireAuth({ children }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center" dir="rtl">
        <Loader2 className="w-8 h-8 animate-spin text-primary" aria-label="טוען" />
      </div>
    );
  }
  if (status !== "authenticated") {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return children;
}
