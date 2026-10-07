import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/localAPI";
import { useAuth } from "@/lib/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ShoppingCart, Loader2, ChevronLeft, Sparkles, RefreshCw,
  Heart, AlertCircle, Upload, Repeat2, Trash2, Info, Plus
} from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import StatCard from "@/components/dashboard/StatCard";
import { useFlowData, FLOW_QUERY_KEY } from "@/lib/flowData";
import FlowSteps from "@/components/FlowSteps";
import { isBasketReady, isUnresolved, receiptItemName } from "@/lib/receiptReview";
import { weeklyBudget as profileWeeklyBudget, basketBudget } from "@/lib/pricing";
import { applyReceiptRules } from "@/lib/receiptClassifier";
import { buildBasket, receiptToBasketItem, sameFood, basketTotals, basketLooksThin, REGULAR_MIN_SCORE } from "@/lib/basketBuilder";
import { weeklyCosts, budgetDrivers, priceFacts, changeBudgetImpact } from "@/lib/basketBudget";
import BudgetImpactCard from "@/components/BudgetImpactCard";
import { findAlternatives, buildReplacementItem, isDisliked, familyLabel, missingStaples, basketSufficiency, profileConflict, isSupplement, proteinShortText } from "@/lib/basketAlternatives";

const MIN_FOOD_ITEMS = 3;

const formatShekel = n => `₪${Math.round(n * 10) / 10}`;

/**
 * Price details of a basket item: price and amount, ₪/kg (or litre) and
 * ₪/100 g, ₪ per 10 g of protein for protein foods, and its weekly cost and
 * share of the total; "מגדיל את העלות" for the top budget drivers.
 */
function PriceLine({ item, weekly, total, driver }) {
  const f = priceFacts(item);
  const unit = f.liquid ? "לליטר" : "לק\"ג";
  const parts = [
    f.price > 0 && `${formatShekel(f.price)} · ${item.quantity}`,
    f.perKg && `${formatShekel(f.perKg)} ${unit}${f.soldByWeight ? " (במשקל)" : ""}`,
    f.per100g && `${formatShekel(f.per100g)} ל-100 ${f.liquid ? "מ\"ל" : "גרם"}`,
    f.perTenGramsProtein && `${formatShekel(f.perTenGramsProtein)} ל-10 ג׳ חלבון`,
  ].filter(Boolean);
  return (
    <div className="mt-1 text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {parts.length > 0 && <span>{parts.join(" · ")}</span>}
      {weekly?.source === "menu" && (
        <span className="text-foreground">
          השבוע: {formatShekel(weekly.cost)}{total > 0 && ` (${Math.round(weekly.cost / total * 100)}%)`}
        </span>
      )}
      {weekly?.source === "unused" && <span>לא בשימוש בתפריט השבוע</span>}
      {driver && (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-300 text-amber-700">מגדיל את העלות</Badge>
      )}
    </div>
  );
}

// Purchase history for the basket (server/purchaseHistory.js); none when the request fails
async function fetchPurchaseHistory() {
  try {
    const res = await fetch("/api/purchase-history", { credentials: "include" });
    if (!res.ok) return [];
    return (await res.json()).products || [];
  } catch {
    return [];
  }
}

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

// A reason is shown only if it is Hebrew text, not predominantly Latin/English
function isHebrewReason(text) {
  const hebrew = (String(text || "").match(/[\u05D0-\u05EA]/g) || []).length;
  const latin = (String(text || "").match(/[A-Za-z]/g) || []).length;
  return hebrew > 0 && hebrew >= latin;
}

function ReplaceDialog({ item, basketItems, profile, onClose, onSelect, saving }) {
  const { data: options = [], isLoading, isError } = useQuery({
    queryKey: ["basketAlternatives", item?.name, basketItems.map(i => i.name).join("|"), profile?.id],
    queryFn: () => findAlternatives(item, basketItems, profile),
    enabled: !!item,
    staleTime: 5 * 60 * 1000,
  });
  const looksFor = item && familyLabel(item);

  return (
    <Dialog open={!!item} onOpenChange={open => !open && !saving && onClose()}>
      <DialogContent
        dir="rtl"
        className="w-[calc(100%-2rem)] max-w-md max-h-[85vh] overflow-y-auto rounded-xl p-5 text-right [&>button:last-child]:right-auto [&>button:last-child]:left-4"
      >
        <DialogHeader className="text-right sm:text-right space-y-1">
          <DialogTitle className="font-heading">החלפת מוצר</DialogTitle>
          <DialogDescription>
            במקום: <span className="font-medium text-foreground">{item?.name}</span>
            {looksFor && <span className="block text-xs mt-1">נחפש {looksFor}, עם ערכים תזונתיים קרובים, מקטלוג שופרסל.</span>}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto mb-2" />
            מחפשים חלופות מתאימות...
          </div>
        )}

        {!isLoading && (isError || options.length === 0) && (
          <p className="py-6 text-center text-sm text-muted-foreground">לא מצאנו כרגע חלופה דומה מספיק למוצר הזה.</p>
        )}

        {!isLoading && options.length > 0 && (
          <ul className="space-y-2">
            {options.map(o => (
              <li key={o.product.product_id}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => onSelect(o)}
                  className="w-full text-right rounded-lg border p-3 hover:border-primary hover:bg-primary/5 transition-colors disabled:opacity-50 flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{o.candidate.label}</p>
                    <p className="text-xs text-muted-foreground truncate">{o.product.original_product_name}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      ל-100 גרם: {Math.round(o.per100.kcal)} קלוריות · {Math.round(o.per100.protein)} ג׳ חלבון
                    </p>
                    {o.keepsProteinGoal === true && (
                      <p className="text-[11px] text-emerald-700 mt-0.5">שומר על יעד החלבון שלך</p>
                    )}
                    {o.keepsProteinGoal === false && (
                      <p className="text-[11px] text-amber-700 mt-0.5">
                        עם ההחלפה: {proteinShortText(o.proteinAfter, profile?.protein_target)}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-left">
                    <p className="text-sm font-semibold">₪{Number(o.product.price).toFixed(2)}</p>
                    <p className="text-[11px] text-muted-foreground">{o.grams >= 1000 && o.grams % 1000 === 0 ? `${o.grams / 1000} ק"ג` : `${Math.round(o.grams)} גרם`}</p>
                    <span className="text-xs text-primary font-medium">בחירה</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {saving && <p className="text-xs text-center text-muted-foreground">שומרים את הבחירה...</p>}
      </DialogContent>
    </Dialog>
  );
}

export default function ShoppingListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const urlParams = new URLSearchParams(window.location.search);
  const receiptId = urlParams.get("receipt_id");

  const { data: profiles } = useQuery({
    queryKey: ["userProfile", user?.email],
    queryFn: () => api.entities.UserProfile.filter({ created_by: user.email }),
    initialData: [],
    enabled: !!user,
  });


  // Fetch latest receipt for this user (used when no receipt_id in URL)
  const { data: latestReceipts = [] } = useQuery({
    queryKey: ["latestReceipt", user?.email],
    queryFn: () => api.entities.Receipt.filter({ created_by: user.email }, "-created_date", 1),
    initialData: [],
    enabled: !!user && !receiptId,
  });

  const latestReceipt = latestReceipts?.[0];
  // Use explicit receipt_id from URL; fall back to latest receipt for current user only
  const effectiveReceiptId = receiptId || latestReceipt?.id || null;

  const { data: foodReceiptItems = [], isLoading: itemsLoading } = useQuery({
    queryKey: ["approvedItems", effectiveReceiptId, user?.email],
    queryFn: () => effectiveReceiptId
      // food / menu suitability by the rules (or the user's own edit), not the receipt AI
      ? api.entities.ReceiptItem.filter({ receipt_id: effectiveReceiptId, created_by: user.email })
        .then(rows => rows.map(applyReceiptRules).filter(i => i.is_food))
      : Promise.resolve([]),
    enabled: !!user,
  });
  // Only confidently recognized or user-approved food items feed the basket;
  // items still awaiting review (or ignored / not food) never reach the basket
  const receiptItems = foodReceiptItems.filter(isBasketReady);
  const pendingReview = foodReceiptItems.filter(isUnresolved).length;

  const profile = profiles?.[0];

  const generateMutation = useMutation({
    mutationFn: async () => {
      // BetterCart plans a full week: one weekly menu and one weekly basket,
      // whatever the shopping frequency (which only splits the budget)
      const daysPerPurchase = 7;
      const weeklyBudget = profileWeeklyBudget(profile);
      // The basket algorithm lives in src/lib/basketBuilder.js (deterministic, no AI)
      const { items: finalItems, total: runningTotal } = await buildBasket({
        receiptItems, history: await fetchPurchaseHistory(), profile, weeklyBudget,
      });

      const list = await api.entities.ShoppingList.create({
        receipt_id: effectiveReceiptId || "",
        title: `סל קניות — ${new Date().toLocaleDateString("he-IL")}`,
        shopping_period_days: daysPerPurchase,
        total_estimated_cost: runningTotal,
        total_calories: Math.round(finalItems.reduce((s, i) => s + (Number(i.calories) || 0), 0)),
        status: "draft",
        items: finalItems,
        complementary_added: finalItems.some(i => !i.from_receipt),
      });

      return list;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shoppingLists"] });
      queryClient.invalidateQueries({ queryKey: [FLOW_QUERY_KEY] });
    },
  });

  // Baskets only — a final shopping list (step 4) is never shown here
  const { basket: showList, plan, planBasket, planOutdated, completed, isLoading: flowLoading } = useFlowData(user);

  // One click from the receipt: arriving with ?build=1 builds the basket right
  // away, unless a basket for this receipt already exists. Runs once; the flag
  // is dropped from the address so a refresh does not build again.
  const autoBuilt = useRef(false);
  useEffect(() => {
    if (autoBuilt.current || urlParams.get("build") !== "1") return;
    if (flowLoading || itemsLoading || !profile || generateMutation.isPending) return;
    autoBuilt.current = true;
    window.history.replaceState(null, "", window.location.pathname + (receiptId ? `?receipt_id=${receiptId}` : ""));
    if (!showList || (effectiveReceiptId && showList.receipt_id !== effectiveReceiptId)) generateMutation.mutate();
  });

  // Remove / replace a single basket item — the rest of the basket stays as is
  const [replacing, setReplacing] = useState(null); // index of the item being replaced
  const [removedSome, setRemovedSome] = useState(false);
  const saveItemsMutation = useMutation({
    mutationFn: ({ items, warnings, acceptedBudget }) => api.entities.ShoppingList.update(showList.id, {
      items, ...basketTotals(items), ...(warnings ? { basket_warnings: warnings } : {}),
      ...(acceptedBudget ? { accepted_budget: Math.max(acceptedBudget, Number(showList.accepted_budget) || 0) } : {}),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [FLOW_QUERY_KEY] }),
    onError: () => toast({ title: "השינוי לא נשמר", description: "נסו שוב בעוד רגע.", variant: "destructive" }),
  });

  // Can the basket still feed a good weekly menu for this profile?
  const sufficiency = showList?.items && profile ? basketSufficiency(showList.items, profile) : { ok: true, issues: [] };
  const savedWarnings = showList?.basket_warnings || [];
  // A change that would leave the basket short waits for the user's confirmation
  const [pendingChange, setPendingChange] = useState(null); // { items, issues, item, done, title }

  // Receipt food the user bought that is not in the basket (less healthy,
  // disliked, removed or trimmed for budget) — one tap puts it back
  const leftOutFromReceipt = showList?.items ? (() => {
    const seen = [];
    return foodReceiptItems
      .filter(i => ["matched", "approved"].includes(i.catalog_match_status))
      .filter(i => {
        const name = receiptItemName(i);
        if (showList.items.some(b => sameFood(b.name, name)) || seen.some(n => sameFood(n, name))) return false;
        seen.push(name);
        return true;
      });
  })() : [];
  const conflictOf = i => profileConflict({ name: receiptItemName(i), category: i.category }, profile);
  const leftOutReason = i => {
    const name = receiptItemName(i);
    const conflict = conflictOf(i);
    if (conflict) return conflict.text;
    if (isSupplement({ name })) return "תוסף תזונה — לא חלק מהתפריט";
    if (!i.is_approved_for_menu) return "פחות מתאים לתפריט בריא";
    if (isDisliked(name, profile?.disliked_foods || [])) return "ברשימת המאכלים שציינת שאינך אוהב/ת";
    return "לא נכנס לסל";
  };
  const addFromReceipt = raw => {
    const item = { ...receiptToBasketItem(raw), reason: "הוספת מהקבלה שלך.", user_added: true };
    requestChange({
      items: [...showList.items, item],
      title: `הוספת ${item.name}`,
      impact: { added: item },
      done: () => toast({ title: `${item.name} נוסף לסל`, description: "כדי שייכנס לתפריט, בנו את התפריט מחדש." }),
    });
  };

  /**
   * What a change does to the week's cost, or null when it stays within budget
   * (or costs less). With a menu built from this basket, the new product is
   * priced at the old one's weekly amount (the final list's calculation);
   * otherwise by the basket's own prices.
   */
  // What a change does to the week's cost (src/lib/basketBudget.js) — null when it stays within budget
  const budgetImpact = (items, { replaced, added } = {}) => changeBudgetImpact({
    basketItems: showList.items, newItems: items, replaced, added, limit: basketBudget(profile, showList),
    planDays: plan?.days?.length && planBasket?.id === showList.id ? plan.days : null,
  });

  const applyChange = ({ items, issues = [], item, done, budget, clearWarnings }) => {
    // Completing the basket answers the old warnings; other changes add their own
    const warnings = clearWarnings ? [] : issues.length ? [...savedWarnings, ...issues.map(i => ({ ...i, item }))] : undefined;
    // An accepted budget increase is kept on the basket: the menu is then fitted to it
    saveItemsMutation.mutate({ items, warnings, acceptedBudget: budget?.total }, { onSuccess: done });
  };
  const requestChange = change => {
    const before = new Set(sufficiency.issues.map(i => i.key));
    const issues = basketSufficiency(change.items, profile).issues.filter(i => !before.has(i.key));
    const budget = budgetImpact(change.items, change.impact);
    if (issues.length || budget) setPendingChange({ ...change, issues, budget });
    else applyChange(change);
  };

  const removeItem = index => {
    const item = showList.items[index];
    requestChange({
      items: showList.items.filter((_, i) => i !== index),
      item: item.name,
      title: `הסרת ${item.name}`,
      done: () => {
        setRemovedSome(true);
        toast({ title: `${item.name} הוסר מהסל` });
      },
    });
  };

  const replaceItem = option => replaceItemAt(replacing, option);
  // The budget card's recommended swaps, approved together
  const replaceMany = swaps => {
    const byIndex = new Map(swaps.map(s => [s.index, buildReplacementItem(s.option)]));
    const items = showList.items.map((it, i) => byIndex.get(i) || it);
    requestChange({
      items,
      item: swaps.map(s => showList.items[s.index]?.name).join(", "),
      title: `החלפת ${swaps.length} מוצרים לחיסכון`,
      done: () => toast({ title: `${swaps.length} מוצרים הוחלפו בחלופות זולות יותר`, description: "כדי לראות את העלות המעודכנת, בנו את התפריט מחדש." }),
    });
  };
  const replaceItemAt = (index, option) => {
    const old = showList.items[index];
    const replacement = buildReplacementItem(option);
    const items = showList.items.map((it, i) => (i === index ? replacement : it));
    setReplacing(null);
    requestChange({
      items,
      item: old.name,
      title: `החלפת ${old.name}`,
      impact: { replaced: { from: old.name, to: replacement.name } },
      done: () => toast({ title: `${old.name} הוחלף ב${option.candidate.label}` }),
    });
  };

  // "השלמת הסל": add only what is missing (no new basket), and clear old warnings
  // The additions are found first and saved through requestChange, so a
  // completion that takes the basket over budget asks before it is applied
  const completeMutation = useMutation({
    mutationFn: () => missingStaples(showList.items, profile),
    onSuccess: added => {
      if (!added.length) {
        toast({ title: "לא נמצאו מוצרים מתאימים להשלמה" });
        return;
      }
      requestChange({
        items: [...showList.items, ...added],
        title: "השלמת הסל",
        impact: { added },
        clearWarnings: true,
        done: () => toast({ title: `נוספו לסל ${added.length} מוצרים` }),
      });
    },
  });

  const disliked = profile?.disliked_foods || [];
  // The weekly plan was built from an earlier version of this basket
  const basketChangedSincePlan = planOutdated && planBasket?.id === showList?.id;

  // Weekly cost per item: what the menu needs (when a menu was built from this
  // basket), else the item's own price; the top 3 are the budget drivers
  const menuDays = plan?.days?.length && planBasket?.id === showList?.id ? plan.days : null;
  const itemCosts = showList?.items ? weeklyCosts(showList.items, menuDays) : [];
  const costTotal = itemCosts.reduce((s, c) => s + c.cost, 0);
  const driverIdx = new Set(showList?.items ? budgetDrivers(showList.items, itemCosts).slice(0, 3).map(d => d.index) : []);

  // Arriving from "החלפת מוצרים יקרים בסל": scroll to the budget card
  useEffect(() => {
    if (window.location.hash === "#budget" && showList) {
      document.getElementById("budget")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [showList]);

  const catalogMatchCount = receiptItems.filter(
    i => ["matched", "approved"].includes(i.catalog_match_status) && !i.catalog_needs_review
  ).length;

  return (
    <div className="space-y-6">
      <FlowSteps current={2} completed={completed} />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold">סל מוצרים חכם</h1>
          <p className="text-sm text-muted-foreground">בחרנו עבורך מוצרים שמהם נבנה את התפריט השבועי</p>
          {showList?.items?.length > 0 && (
            <p className="text-sm text-muted-foreground">לא מתאים לך מוצר מסוים? אפשר להחליף או להסיר אותו לפני בניית התפריט.</p>
          )}
          {effectiveReceiptId && (
            <p className="text-xs text-muted-foreground/70 mt-0.5">
              מבוסס על קבלה מ-{latestReceipt?.store_name || (receiptId ? "הקבלה שנבחרה" : "הקבלה האחרונה שהועלתה")}
            </p>
          )}
          {effectiveReceiptId && pendingReview > 0 && (
            <p className="text-xs text-amber-700 mt-0.5">
              {pendingReview} פריטים מהקבלה עדיין דורשים בדיקה ולא ייכנסו לסל.{" "}
              <button type="button" className="underline" onClick={() => navigate(`/receipt-results?id=${effectiveReceiptId}`)}>
                לבדיקת הפריטים
              </button>
            </p>
          )}
          {!effectiveReceiptId && !itemsLoading && (
            <p className="text-xs text-amber-600 mt-0.5">
              לא נמצאה קבלה — העלו קבלה כדי לבסס את הסל
            </p>
          )}
          {effectiveReceiptId && receiptItems.length > 0 && (
            <p className="text-xs text-muted-foreground/60 mt-0.5">
              {catalogMatchCount > 0
                ? `הסל משתמש בנתוני קטלוג מאומתים עבור ${catalogMatchCount} מוצרים`
                : "הסל מבוסס על נתוני הקבלה"}
            </p>
          )}
          {effectiveReceiptId && catalogMatchCount > 0 && (
            <p className="text-[11px] text-muted-foreground/50 mt-0.5">
              נתוני הקטלוג מבוססים כרגע על שופרסל
            </p>
          )}
          {showList?.items?.some(i => i.from_history) && (
            <p className="text-xs text-muted-foreground mt-0.5">
              הסל מתחשב גם בהרגלי הקנייה שלך מ-{showList.items.find(i => i.from_history).history_total_receipts} הקבלות האחרונות
            </p>
          )}
          {showList?.items?.some(i => i.from_receipt) && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {showList.items.filter(i => i.from_receipt).length} מוצרים בסל הגיעו מהקבלה שלך, והשאר נוספו כדי להשלים שבוע מאוזן
            </p>
          )}
          {showList?.complementary_added && (
            <p className="text-[11px] text-muted-foreground/50 mt-0.5">
              הסל מבוסס על הקבלה, אך הושלמו מוצרים חסרים כדי ליצור תפריט מגוון ומאוזן יותר
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
          >
            {generateMutation.isPending ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <RefreshCw className="w-4 h-4 ml-2" />}
            {showList ? "בחירה מחדש" : "בניית סל מוצרים חכם"}
          </Button>
        </div>
      </div>

      {generateMutation.isError && !generateMutation.isPending && (
        <Card className="p-4 border-destructive/50 bg-destructive/5">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-sm">לא הצלחנו לבנות את סל המוצרים</p>
              <p className="text-xs text-muted-foreground mt-1">
                בדקו שה-API key מוגדר, או נסו שוב בעוד רגע.
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 font-mono">{generateMutation.error?.message}</p>
            </div>
          </div>
        </Card>
      )}

      {generateMutation.isPending && (
        <Card className="p-10 text-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
          <h2 className="font-heading font-semibold text-lg">בוחרים עבורכם מוצרים...</h2>
          <p className="text-sm text-muted-foreground">מנתחים העדפות, תקציב וצרכים תזונתיים</p>
        </Card>
      )}

      {!generateMutation.isPending && !showList && (
        <Card className="p-10 text-center">
          <ShoppingCart className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
          <h2 className="font-heading font-semibold text-lg mb-2">עדיין לא נבחרו מוצרים</h2>
          {!itemsLoading && receiptItems.length < MIN_FOOD_ITEMS ? (
            <>
              <p className="text-sm text-muted-foreground mb-6">
                מצאנו מעט מדי מוצרי מזון בקבלות שלך כדי לבנות סל מדויק.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button variant="outline" onClick={() => navigate("/upload")}>
                  <Upload className="w-4 h-4 ml-2" /> להעלות קבלות נוספות
                </Button>
                <Button onClick={() => generateMutation.mutate()}>
                  <Sparkles className="w-4 h-4 ml-2" /> ליצור סל ראשוני לפי הפרופיל שלי
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-6">
                נבחר עבורכם מוצרים לפי הפרופיל, התקציב והקבלות שהעליתם — מהם נבנה את התפריט השבועי.
              </p>
              <Button onClick={() => generateMutation.mutate()}>
                <Sparkles className="w-4 h-4 ml-2" /> בניית סל מוצרים חכם
              </Button>
            </>
          )}
        </Card>
      )}

      {showList && !generateMutation.isPending && (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 gap-4">
            <StatCard title="מוצרים שנבחרו" value={showList.items?.length || 0} icon={ShoppingCart} color="blue" />
            <StatCard title="קטגוריות" value={new Set((showList.items || []).map(i => i.category)).size} icon={Heart} color="green" />
          </div>

          <BudgetImpactCard
            basketItems={showList.items || []}
            planDays={menuDays}
            profile={profile}
            budget={profile ? basketBudget(profile, showList) : 0}
            onReplace={replaceItemAt}
            onReplaceMany={replaceMany}
            saving={saveItemsMutation.isPending}
            menuOutdated={basketChangedSincePlan}
          />

          {/* Items Table */}
          <Card className="overflow-hidden">
            <div className="p-4 border-b flex items-center justify-between">
              <h2 className="font-heading font-semibold">המוצרים שנבחרו</h2>
              <span className="text-xs text-muted-foreground">
                {menuDays ? "העלות השבועית לכל מוצר — לפי הכמות שהתפריט צריך" : "המחיר לכל מוצר — העלות השבועית תחושב לפי התפריט"}
              </span>
            </div>
            <ul className="divide-y">
              {showList.items?.map((item, i) => (
                <li key={`${i}-${item.name}`} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${
                      item.health_score >= 7 ? "bg-green-50 text-green-700" :
                      item.health_score >= 4 ? "bg-amber-50 text-amber-700" :
                      "bg-red-50 text-red-700"
                    }`} title="ציון בריאות">
                      {item.health_score ?? "–"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-sm break-words">{item.name}</span>
                        {item.from_receipt && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">מהקבלה</Badge>
                        )}
                        {!item.from_receipt && item.history_score >= REGULAR_MIN_SCORE && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-emerald-300 text-emerald-700">קונה בקביעות</Badge>
                        )}
                        {item.protein_completion && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">השלמת חלבון</Badge>
                        )}
                        {item.from_engine && !(item.history_score >= REGULAR_MIN_SCORE) && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">המלצת BetterCart</Badge>
                        )}
                        <Badge className={`text-xs ${categoryColors[item.category] || categoryColors.other}`}>
                          {CATEGORY_LABELS[item.category] || item.category}
                        </Badge>
                      </div>
                      <PriceLine item={item} weekly={itemCosts[i]} total={costTotal} driver={driverIdx.has(i)} />
                      {isHebrewReason(item.reason) && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.reason}</p>
                      )}
                      {profileConflict(item, profile) && (
                        <p className="text-xs text-destructive mt-1">{profileConflict(item, profile).text} — מומלץ להסיר מהסל</p>
                      )}
                      {isDisliked(item.name, disliked) && (
                        <p className="text-xs text-amber-700 mt-1">מופיע ברשימת המאכלים שציינת שאינך אוהב/ת</p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0 sm:mr-auto">
                    <Button
                      variant="outline" size="sm" className="flex-1 sm:flex-none min-h-9"
                      onClick={() => setReplacing(i)}
                      disabled={saveItemsMutation.isPending}
                    >
                      <Repeat2 className="w-4 h-4 ml-1.5" /> החלפה
                    </Button>
                    <Button
                      variant="ghost" size="sm" className="flex-1 sm:flex-none min-h-9 text-muted-foreground hover:text-destructive"
                      onClick={() => removeItem(i)}
                      disabled={saveItemsMutation.isPending}
                    >
                      <Trash2 className="w-4 h-4 ml-1.5" /> הסרה
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {leftOutFromReceipt.length > 0 && (
            <Card className="overflow-hidden">
              <div className="p-4 border-b">
                <h2 className="font-heading font-semibold">מהקבלה שלך — לא נכנסו לסל</h2>
                <p className="text-xs text-muted-foreground mt-0.5">ליד כל מוצר כתוב למה הוא לא נכנס. מוצר שמתאים לתזונה שלך אפשר להוסיף לסל בלחיצה.</p>
              </div>
              <ul className="divide-y">
                {leftOutFromReceipt.map(i => (
                  <li key={i.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-sm break-words">{receiptItemName(i)}</span>
                      <p className="text-xs text-muted-foreground mt-0.5">{leftOutReason(i)}</p>
                    </div>
                    {conflictOf(i) || isSupplement({ name: receiptItemName(i) }) ? (
                      <span className="text-xs text-muted-foreground shrink-0">לא ניתן להוסיף</span>
                    ) : (
                      <Button variant="outline" size="sm" className="min-h-9 shrink-0" disabled={saveItemsMutation.isPending}
                        onClick={() => addFromReceipt(i)}>
                        <Plus className="w-4 h-4 ml-1.5" /> הוספה לסל
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {!sufficiency.ok && (
            <Card className="p-4 border-amber-300 bg-amber-50/60 space-y-2">
              <p className="font-medium text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" /> עם הסל הנוכחי לא נוכל לבנות תפריט שעומד ביעדים שלך
              </p>
              <ul className="text-sm text-muted-foreground list-disc pr-5 space-y-0.5">
                {sufficiency.issues.map(i => <li key={i.key}>{i.text}</li>)}
              </ul>
              <Button size="sm" variant="outline" onClick={() => completeMutation.mutate()} disabled={completeMutation.isPending}>
                {completeMutation.isPending ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Sparkles className="w-4 h-4 ml-2" />}
                השלמת הסל
              </Button>
            </Card>
          )}

          {removedSome && sufficiency.ok && basketLooksThin(showList.items || []) && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 text-amber-800 text-sm p-3">
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              <span>הסרת מוצר עשויה להשפיע על מגוון התפריט.</span>
            </div>
          )}

          <Card className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {basketChangedSincePlan
                ? "עדכנת את הסל — התפריט ייבנה מחדש מהמוצרים המעודכנים."
                : "מהמוצרים האלה נבנה עבורכם תפריט תזונה שבועי מותאם."}
            </p>
            <Button
              onClick={() => navigate(`/nutrition-plan?list_id=${showList.id}&build=1`)}
              className="rounded-full"
              disabled={!showList.items?.length || saveItemsMutation.isPending}
            >
              בניית תפריט תזונה <ChevronLeft className="w-4 h-4 mr-1" />
            </Button>
          </Card>

          <AlertDialog open={!!pendingChange} onOpenChange={open => !open && setPendingChange(null)}>
            <AlertDialogContent dir="rtl" className="w-[calc(100%-2rem)] max-w-md rounded-xl text-right">
              <AlertDialogHeader className="text-right sm:text-right">
                <AlertDialogTitle>{pendingChange?.title}</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    {pendingChange?.budget && (
                      <p className="rounded-lg bg-amber-50 text-amber-800 p-3">
                        {pendingChange.budget.verb} תעלה את הסכום הכולל ב-{formatShekel(pendingChange.budget.increase)} ותגרום
                        לסל הקניות לחרוג מהתקציב השבועי שלך ב-{formatShekel(pendingChange.budget.over)}.
                      </p>
                    )}
                    {pendingChange?.issues.length > 0 && (
                      <>
                        <p>אחרי השינוי הזה לא נוכל לבנות תפריט שבועי שעומד ביעדים שלך:</p>
                        <ul className="list-disc pr-5 space-y-0.5">
                          {pendingChange.issues.map(i => <li key={i.key}>{i.text}</li>)}
                        </ul>
                        <p>אפשר להמשיך בכל זאת — התפריט ייבנה מהמוצרים שיישארו, וזה יצוין בו.</p>
                      </>
                    )}
                    {pendingChange?.budget && (
                      <p>אם תאשרו, התפריט וסל הקניות הסופי ייבנו לפי תקציב של {formatShekel(pendingChange.budget.total)} לשבוע.</p>
                    )}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2 sm:gap-2 sm:justify-start">
                <AlertDialogCancel className="mt-0">ביטול</AlertDialogCancel>
                <AlertDialogAction onClick={() => { const c = pendingChange; setPendingChange(null); applyChange(c); }}>
                  {pendingChange?.budget ? "לאשר את העלייה בתקציב" : "להמשיך בכל זאת"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <ReplaceDialog
            item={replacing != null ? showList.items?.[replacing] : null}
            basketItems={showList.items || []}
            profile={profile}
            saving={saveItemsMutation.isPending}
            onClose={() => setReplacing(null)}
            onSelect={replaceItem}
          />
        </>
      )}
    </div>
  );
}