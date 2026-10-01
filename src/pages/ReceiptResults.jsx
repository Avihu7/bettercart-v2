import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/localAPI";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Store, Calendar, Check, X, Pencil, Trash2,
  ShoppingCart, Lightbulb, ChevronLeft, TrendingUp,
  Loader2, Zap
} from "lucide-react";
import { formatCurrency } from "@/lib/calculations";
import { format } from "date-fns";
import FlowSteps from "@/components/FlowSteps";
import { useFlowData } from "@/lib/flowData";

const CATEGORIES = ["protein", "carb", "fat", "vegetable", "fruit", "dairy", "snack", "drink", "other"];

function detectChain(storeName) {
  if (!storeName) return null;
  if (/רמי\s*לוי|rami.?levy/i.test(storeName)) return 'rami_levy';
  if (/שופרסל|shufersal/i.test(storeName)) return 'shufersal';
  return null;
}

function CatalogBadge({ item }) {
  const status = item.catalog_match_status;
  if (!status || status === 'not_checked') return null;
  const confPct = item.catalog_match_confidence
    ? `${Math.round(item.catalog_match_confidence * 100)}%`
    : '';
  if (status === 'matched') return (
    <div className="mt-1 space-y-0.5">
      <span className="inline-block bg-green-100 text-green-700 text-[10px] font-medium px-1.5 py-0.5 rounded-full">
        נמצא בקטלוג {confPct}
      </span>
      {item.matched_product_name && (
        <p className="text-[10px] text-muted-foreground/60">מוצר קטלוג: {item.matched_product_name}</p>
      )}
    </div>
  );
  if (status === 'needs_review') return (
    <div className="mt-1 space-y-0.5">
      <span className="inline-block bg-amber-100 text-amber-700 text-[10px] font-medium px-1.5 py-0.5 rounded-full">
        התאמה אפשרית {confPct}
      </span>
      {item.matched_product_name && (
        <p className="text-[10px] text-muted-foreground/60">מוצר קטלוג: {item.matched_product_name}</p>
      )}
      <p className="text-[10px] text-amber-600/70">לא עודכן אוטומטית — מומלץ לבדוק</p>
    </div>
  );
  if (status === 'not_found') return (
    <span className="mt-1 inline-block bg-gray-100 text-gray-500 text-[10px] px-1.5 py-0.5 rounded-full">
      לא נמצא בקטלוג
    </span>
  );
  return null;
}

const CATEGORY_LABELS = {
  protein: "חלבון",
  carb: "פחמימה",
  fat: "שומן",
  vegetable: "ירק",
  fruit: "פרי",
  dairy: "חלבי",
  snack: "חטיף",
  drink: "שתייה",
  other: "אחר",
};

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

// Older AI insights used a malformed Hebrew term for dairy ("מוצרי דייה",
// "דיירי") — show the correct "מוצרי חלב" for receipts already saved.
function fixHebrewTerm(text) {
  if (typeof text !== "string") return text;
  return text
    .replace(/מוצרי\s+(?:דייה|דיירי|דאירי)/g, "מוצרי חלב")
    .replace(/(?<![א-ת])(?:דייה|דיירי|דאירי)(?![א-ת])/g, "מוצרי חלב");
}

function fixInsightTerms(insights) {
  if (!insights || typeof insights !== "object") return insights;
  return Object.fromEntries(
    Object.entries(insights).map(([k, v]) => [k, Array.isArray(v) ? v.map(fixHebrewTerm) : fixHebrewTerm(v)])
  );
}

export default function ReceiptResults() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { completed } = useFlowData(user);
  const urlParams = new URLSearchParams(window.location.search);
  const receiptId = urlParams.get("id");
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});

  const { data: receipt, isFetched: receiptFetched } = useQuery({
    queryKey: ["receipt", receiptId, user?.email],
    queryFn: async () => {
      const filters = user?.email ? { id: receiptId, created_by: user.email } : { id: receiptId };
      const receipts = await api.entities.Receipt.filter(filters);
      return receipts[0];
    },
    enabled: !!receiptId && !!user,
  });

  const { data: items = [] } = useQuery({
    queryKey: ["receiptItems", receiptId, user?.email],
    queryFn: () => {
      const filters = user?.email
        ? { receipt_id: receiptId, created_by: user.email }
        : { receipt_id: receiptId };
      return api.entities.ReceiptItem.filter(filters);
    },
    enabled: !!receiptId && !!user,
  });

  const foodItems = items.filter(i => i.is_food);
  const nonFoodItems = items.filter(i => !i.is_food);

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => api.entities.ReceiptItem.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receiptItems", receiptId] });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.entities.ReceiptItem.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["receiptItems", receiptId] }),
  });

  const matchCatalogMutation = useMutation({
    mutationFn: async () => {
      if (!receipt || !user || foodItems.length === 0) throw new Error('אין פריטים להתאמה');
      const chain = detectChain(receipt.store_name);
      const payload = {
        items: foodItems.map(item => ({
          name: item.normalized_name || item.original_name,
          normalized_name: item.normalized_name,
          chain,
        })),
      };
      const res = await fetch('/api/products/match-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('שגיאה בתקשורת עם שרת הקטלוג');
      const { matches } = await res.json();

      await Promise.all(
        foodItems.map(async (item, idx) => {
          const match = matches[idx];
          if (!match) return;
          const patch = {};
          if (match.matched) {
            patch.matched_product_id      = match.matched_product_id;
            patch.matched_product_name    = match.matched_name;
            patch.catalog_chain           = match.chain;
            patch.catalog_price           = match.price ?? null;
            patch.catalog_price_per_100g  = match.price_per_100g ?? null;
            patch.catalog_category        = match.category ?? null;
            patch.catalog_calories_per_100g = match.calories_per_100g ?? null;
            patch.catalog_protein_per_100g  = match.protein_per_100g ?? null;
            patch.catalog_carbs_per_100g    = match.carbs_per_100g ?? null;
            patch.catalog_fat_per_100g      = match.fat_per_100g ?? null;
            patch.catalog_match_type        = match.match_type;
            patch.catalog_match_confidence  = match.match_confidence;
            patch.catalog_needs_review      = match.needs_review ? 1 : 0;
            patch.catalog_match_status      = match.needs_review ? 'needs_review' : 'matched';
            // Only fill missing AI nutrition when confidence is high (not needs_review)
            if (!match.needs_review) {
              if (item.calories_per_100g == null && match.calories_per_100g != null)
                patch.calories_per_100g = match.calories_per_100g;
              if (item.protein_per_100g == null && match.protein_per_100g != null)
                patch.protein_per_100g = match.protein_per_100g;
              if (item.carbs_per_100g == null && match.carbs_per_100g != null)
                patch.carbs_per_100g = match.carbs_per_100g;
              if (item.fat_per_100g == null && match.fat_per_100g != null)
                patch.fat_per_100g = match.fat_per_100g;
            }
          } else {
            patch.catalog_match_status = 'not_found';
          }
          return api.entities.ReceiptItem.update(item.id, patch);
        })
      );
      return matches;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["receiptItems", receiptId, user?.email] }),
  });

  const startEdit = (item) => {
    setEditingId(item.id);
    setEditData({
      category: item.category,
      is_approved_for_menu: item.is_approved_for_menu,
      price: item.price,
      quantity: item.quantity,
    });
  };

  const saveEdit = (id) => {
    updateMutation.mutate({ id, data: editData });
  };

  if (!receipt) {
    // Not found also covers another user's receipt id — the server returns nothing for it
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <p className="text-muted-foreground">{receiptFetched || !receiptId ? "הקבלה לא נמצאה" : "טוען קבלה..."}</p>
      </div>
    );
  }

  const insights = fixInsightTerms(receipt.insights);

  return (
    <div className="space-y-6">
      <FlowSteps current={1} completed={completed} />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold">ניתוח הקבלה</h1>
          <p className="text-sm text-muted-foreground">תוצאות ניתוח AI של הקבלה שלכם</p>
        </div>
        <Button onClick={() => navigate(`/shopping-list?receipt_id=${receiptId}`)} className="rounded-full">
          בניית סל מוצרים חכם <ChevronLeft className="w-4 h-4 mr-1" />
        </Button>
      </div>

      {/* Receipt Summary */}
      <div className="grid sm:grid-cols-3 gap-4">
        <Card className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
            <Store className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">סופרמרקט</p>
            <p className="font-heading font-semibold">{receipt.store_name || "לא ידוע"}</p>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
            <Calendar className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">תאריך</p>
            <p className="font-heading font-semibold">
              {receipt.purchase_date ? format(new Date(receipt.purchase_date), "d/M/yyyy") : "לא ידוע"}
            </p>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
            <span className="text-emerald-600 font-bold text-lg leading-none">₪</span>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">סה״כ</p>
            <p className="font-heading font-semibold">{formatCurrency(receipt.total_amount)}</p>
          </div>
        </Card>
      </div>

      {/* Food Items Table */}
      <Card className="overflow-hidden">
        <div className="p-4 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="font-heading font-semibold">המוצרים שנכנסו לניתוח ({foodItems.length})</h2>
            <p className="text-xs text-muted-foreground mt-0.5">פריטי מזון שזוהו ויכנסו לסל הקניות ולניתוח התזונתי</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => matchCatalogMutation.mutate()}
            disabled={matchCatalogMutation.isPending || foodItems.length === 0}
            className="shrink-0 gap-1.5"
          >
            {matchCatalogMutation.isPending
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Zap className="w-3.5 h-3.5" />}
            התאם מוצרים לקטלוג
          </Button>
        </div>
        <p className="px-4 pt-2 text-[11px] text-muted-foreground/70">
          מערכת ההתאמה משתמשת כרגע בקטלוג שופרסל בלבד
        </p>
        {matchCatalogMutation.isSuccess && (
          <div className="px-4 py-2 bg-green-50 border-b border-green-100 text-xs text-green-700">
            ✓ הצלבת קטלוג הושלמה —{' '}
            {matchCatalogMutation.data?.filter(m => m.matched).length} מוצרים זוהו מתוך{' '}
            {matchCatalogMutation.data?.length}
          </div>
        )}
        {matchCatalogMutation.isError && (
          <div className="px-4 py-2 bg-red-50 border-b border-red-100 text-xs text-red-600">
            שגיאה בהתאמת קטלוג: {matchCatalogMutation.error?.message}
          </div>
        )}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>מוצר</TableHead>
                <TableHead>קטגוריה</TableHead>
                <TableHead>מחיר</TableHead>
                <TableHead>קל'/100ג</TableHead>
                <TableHead>ח/פ/ש</TableHead>
                <TableHead>ציון</TableHead>
                <TableHead>בתפריט</TableHead>
                <TableHead className="w-20">פעולות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {foodItems.map(item => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium text-sm">{item.normalized_name || item.original_name}</p>
                      {item.original_name && item.normalized_name && item.original_name !== item.normalized_name && (
                        <p className="text-xs text-muted-foreground/60">{item.original_name}</p>
                      )}
                      <p className="text-xs text-muted-foreground">{item.quantity}</p>
                      {item.reasoning && (
                        <p className="text-xs text-muted-foreground/70 italic mt-0.5 max-w-[180px] truncate">{item.reasoning}</p>
                      )}
                      <CatalogBadge item={item} />
                    </div>
                  </TableCell>
                  <TableCell>
                    {editingId === item.id ? (
                      <Select value={editData.category} onValueChange={v => setEditData(d => ({ ...d, category: v }))}>
                        <SelectTrigger className="w-28 h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.map(c => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c] || c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge className={`text-xs ${categoryColors[item.category] || categoryColors.other}`}>
                        {CATEGORY_LABELS[item.category] || item.category}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {editingId === item.id ? (
                      <Input type="number" className="w-20 h-7 text-xs" value={editData.price} onChange={e => setEditData(d => ({ ...d, price: Number(e.target.value) }))} />
                    ) : (
                      <span className="text-sm">{formatCurrency(item.price)}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{item.calories_per_100g}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {item.protein_per_100g}ג / {item.carbs_per_100g}ג / {item.fat_per_100g}ג
                  </TableCell>
                  <TableCell>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                      item.health_score >= 7 ? "bg-green-50 text-green-700" :
                      item.health_score >= 4 ? "bg-amber-50 text-amber-700" :
                      "bg-red-50 text-red-700"
                    }`}>
                      {item.health_score}
                    </div>
                  </TableCell>
                  <TableCell>
                    {editingId === item.id ? (
                      <button onClick={() => setEditData(d => ({ ...d, is_approved_for_menu: !d.is_approved_for_menu }))}>
                        {editData.is_approved_for_menu ? <Check className="w-4 h-4 text-green-600" /> : <X className="w-4 h-4 text-red-500" />}
                      </button>
                    ) : (
                      item.is_approved_for_menu ? <Check className="w-4 h-4 text-green-600" /> : <X className="w-4 h-4 text-red-400" />
                    )}
                  </TableCell>
                  <TableCell>
                    {editingId === item.id ? (
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => saveEdit(item.id)}>
                          <Check className="w-3.5 h-3.5 text-green-600" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingId(null)}>
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(item)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => deleteMutation.mutate(item.id)}>
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Non-Food / Excluded Items */}
      {nonFoodItems.length > 0 && (
        <Card className="overflow-hidden">
          <div className="p-4 border-b">
            <h2 className="font-heading font-semibold">שורות שלא נכנסו לניתוח ({nonFoodItems.length})</h2>
            <p className="text-xs text-muted-foreground mt-0.5">פריטים שסוננו — לא מזון, שורות מבצע, סיכומים ופריטים לא מזוהים</p>
          </div>
          <div className="p-4 space-y-2">
            {nonFoodItems.map(item => (
              <div key={item.id} className="flex items-start justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{item.original_name}</p>
                  {item.reasoning && (
                    <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-background border border-border/60 text-muted-foreground text-xs">
                      {item.reasoning}
                    </span>
                  )}
                  {!item.reasoning && (
                    <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-background border border-border/60 text-muted-foreground text-xs">
                      לא מזון
                    </span>
                  )}
                </div>
                {item.price > 0 && (
                  <span className="text-sm mr-4 shrink-0">{formatCurrency(item.price)}</span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* AI Insights */}
      {insights && (
        <Card className="p-5">
          <h2 className="font-heading font-semibold flex items-center gap-2 mb-4">
            <Lightbulb className="w-5 h-5 text-amber-500" /> תובנות AI
          </h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {insights.main_food_preferences?.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-2 flex items-center gap-1">
                  <ShoppingCart className="w-4 h-4" /> מאכלים מועדפים
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {insights.main_food_preferences.map(f => (
                    <Badge key={f} variant="secondary" className="text-xs">{f}</Badge>
                  ))}
                </div>
              </div>
            )}
            {insights.high_spending_categories?.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-2 flex items-center gap-1">
                  <TrendingUp className="w-4 h-4" /> קטגוריות עם הוצאה גבוהה
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {insights.high_spending_categories.map(c => (
                    <Badge key={c} variant="outline" className="text-xs">{c}</Badge>
                  ))}
                </div>
              </div>
            )}
            {insights.less_healthy_patterns?.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-2 text-amber-600">⚠ דפוסי אכילה פחות בריאים</h3>
                <ul className="text-xs text-muted-foreground space-y-1">
                  {insights.less_healthy_patterns.map(p => <li key={p}>• {p}</li>)}
                </ul>
              </div>
            )}
            {insights.recommended_improvements?.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-2 text-primary">✓ המלצות לשיפור</h3>
                <ul className="text-xs text-muted-foreground space-y-1">
                  {insights.recommended_improvements.map(r => <li key={r}>• {r}</li>)}
                </ul>
              </div>
            )}
          </div>
        </Card>
      )}
      {/* Next step */}
      <Card className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-sm text-muted-foreground">בשלב הבא נבחר עבורכם מוצרים מתאימים מהקבלה ומקטלוג שופרסל.</p>
        <Button onClick={() => navigate(`/shopping-list?receipt_id=${receiptId}`)} className="rounded-full">
          בניית סל מוצרים חכם <ChevronLeft className="w-4 h-4 mr-1" />
        </Button>
      </Card>
    </div>
  );
}