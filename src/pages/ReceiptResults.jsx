import React, { useEffect, useRef, useState } from "react";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Store, Calendar, Check, X, Pencil, Trash2,
  ShoppingCart, Lightbulb, ChevronLeft, TrendingUp,
  Loader2, Zap, AlertTriangle, Search
} from "lucide-react";
import {
  isUnresolved, isExcluded, needsMatching, matchPatch, manualMatchPatch,
  approvePatch, nonFoodPatch, ignorePatch, reviewReason,
} from "@/lib/receiptReview";
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
  if (status === 'approved') return (
    <div className="mt-1 space-y-0.5">
      <span className="inline-block bg-green-100 text-green-700 text-[10px] font-medium px-1.5 py-0.5 rounded-full">
        אושר על ידך
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

// "שינוי התאמה": a few Shufersal catalog candidates for the receipt text, searchable
function ChangeMatchDialog({ item, onClose, onSelect, saving }) {
  const initial = item ? (item.normalized_name || item.original_name || "") : "";
  const [query, setQuery] = useState(initial);
  const [term, setTerm] = useState(initial);
  useEffect(() => { setQuery(initial); setTerm(initial); }, [initial]);
  const { data: results = [], isLoading } = useQuery({
    queryKey: ["catalogSearch", term],
    queryFn: async () => {
      if (term.trim().length < 2) return [];
      const res = await fetch(`/api/products/search?${new URLSearchParams({ q: term.trim(), limit: "20" })}`);
      if (!res.ok) return [];
      const data = await res.json();
      // one row per product name
      const seen = new Set();
      return (data.results || []).filter(p => !seen.has(p.original_product_name) && seen.add(p.original_product_name)).slice(0, 6);
    },
    enabled: !!item,
  });
  return (
    <Dialog open={!!item} onOpenChange={open => !open && !saving && onClose()}>
      <DialogContent dir="rtl" className="w-[calc(100%-2rem)] max-w-md max-h-[85vh] overflow-y-auto rounded-xl p-5 text-right [&>button:last-child]:right-auto [&>button:last-child]:left-4">
        <DialogHeader className="text-right sm:text-right space-y-1">
          <DialogTitle className="font-heading">שינוי התאמה</DialogTitle>
          <DialogDescription>
            מהקבלה: <span className="font-medium text-foreground">{item?.original_name}</span>
            <span className="block text-xs mt-1">בחרו את המוצר הנכון מקטלוג שופרסל.</span>
          </DialogDescription>
        </DialogHeader>
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); setTerm(query); }}>
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="חיפוש בקטלוג" className="h-9" />
          <Button type="submit" variant="outline" size="sm" className="h-9 shrink-0"><Search className="w-4 h-4" /></Button>
        </form>
        {isLoading && <p className="py-4 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline ml-2" />מחפשים בקטלוג...</p>}
        {!isLoading && results.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">לא נמצאו מוצרים מתאימים. נסו מילת חיפוש אחרת.</p>}
        <ul className="space-y-2">
          {results.map(p => (
            <li key={p.product_id}>
              <button type="button" disabled={saving} onClick={() => onSelect(p)}
                className="w-full text-right rounded-lg border p-3 hover:border-primary hover:bg-primary/5 transition-colors disabled:opacity-50 flex items-center gap-3">
                <span className="flex-1 min-w-0 text-sm font-medium break-words">{p.original_product_name}</span>
                <span className="shrink-0 text-left">
                  <span className="block text-sm font-semibold">{formatCurrency(p.price)}</span>
                  <span className="text-xs text-primary font-medium">בחירה</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
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
  const [rematching, setRematching] = useState(null); // item in "שינוי התאמה"

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
  // Unsure items wait for the user and never reach the smart basket on their own
  const reviewItems = items.filter(isUnresolved);
  const recognizedItems = foodItems.filter(i => !isUnresolved(i) && !isExcluded(i));
  const nonFoodItems = items.filter(isExcluded);

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
      // Items the user already decided on (approved / not food / ignored) are kept as they are
      const toMatch = items.filter(needsMatching);
      if (!receipt || !user || toMatch.length === 0) throw new Error('אין פריטים להתאמה');
      const chain = detectChain(receipt.store_name);
      const payload = {
        items: toMatch.map(item => ({
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
        toMatch.map((item, idx) => matches[idx] && api.entities.ReceiptItem.update(item.id, matchPatch(item, matches[idx])))
      );
      return matches;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["receiptItems", receiptId, user?.email] }),
  });

  // Catalog matching runs by itself once for items that were never matched
  const autoMatched = useRef(false);
  useEffect(() => {
    if (autoMatched.current || !receipt || !items.some(i => i.is_food && (i.catalog_match_status || "not_checked") === "not_checked")) return;
    autoMatched.current = true;
    matchCatalogMutation.mutate();
  }, [receipt, items, matchCatalogMutation]);

  const reviewMutation = useMutation({
    mutationFn: ({ id, data }) => api.entities.ReceiptItem.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receiptItems", receiptId] });
      setRematching(null);
    },
  });
  const decide = (item, data) => reviewMutation.mutate({ id: item.id, data });

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
        <div className="flex flex-col items-start sm:items-end gap-1">
          <Button onClick={() => navigate(`/shopping-list?receipt_id=${receiptId}&build=1`)} className="rounded-full">
            בניית סל מוצרים חכם <ChevronLeft className="w-4 h-4 mr-1" />
          </Button>
          {reviewItems.length > 0 && (
            <span className="text-xs text-amber-700">נותרו {reviewItems.length} פריטים לבדיקה</span>
          )}
        </div>
      </div>

      {/* Items the system is not sure about */}
      {reviewItems.length > 0 && (
        <Card className="overflow-hidden border-amber-300">
          <div className="p-4 border-b bg-amber-50/60">
            <h2 className="font-heading font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" /> דורש בדיקה ({reviewItems.length})
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              לא הצלחנו לזהות בוודאות כמה פריטים מהקבלה. אשרו, תקנו או הסירו אותם לפני בניית הסל החכם.
            </p>
          </div>
          <ul className="divide-y">
            {reviewItems.map(item => (
              <li key={item.id} className="p-4 space-y-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm break-words">{item.original_name}</span>
                    <Badge className={`text-xs ${categoryColors[item.category] || categoryColors.other}`}>
                      {CATEGORY_LABELS[item.category] || item.category}
                    </Badge>
                    <span className="text-xs text-amber-700">{reviewReason(item)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 break-words">
                    {item.matched_product_name
                      ? <>התאמה אפשרית: {item.matched_product_name}{item.catalog_match_confidence ? ` (${Math.round(item.catalog_match_confidence * 100)}%)` : ""}</>
                      : "לא נמצאה התאמה בקטלוג"}
                    {item.price > 0 && <> · {formatCurrency(item.price)}</>}
                    {item.quantity && <> · {item.quantity}</>}
                  </p>
                </div>
                <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
                  <Button size="sm" className="min-h-9" disabled={reviewMutation.isPending || !item.matched_product_name}
                    onClick={() => decide(item, approvePatch())}>
                    <Check className="w-4 h-4 ml-1" /> אישור
                  </Button>
                  <Button size="sm" variant="outline" className="min-h-9" disabled={reviewMutation.isPending}
                    onClick={() => setRematching(item)}>
                    <Search className="w-4 h-4 ml-1" /> שינוי התאמה
                  </Button>
                  <Button size="sm" variant="outline" className="min-h-9" disabled={reviewMutation.isPending}
                    onClick={() => decide(item, nonFoodPatch())}>
                    לא מזון
                  </Button>
                  <Button size="sm" variant="ghost" className="min-h-9 text-muted-foreground" disabled={reviewMutation.isPending}
                    onClick={() => decide(item, ignorePatch())}>
                    התעלמות
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ChangeMatchDialog
        item={rematching}
        saving={reviewMutation.isPending}
        onClose={() => setRematching(null)}
        onSelect={product => decide(rematching, manualMatchPatch(product, rematching))}
      />

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
            <h2 className="font-heading font-semibold">מוצרים שזוהו ({recognizedItems.length})</h2>
            <p className="text-xs text-muted-foreground mt-0.5">פריטי מזון שזוהו ויכנסו לסל הקניות ולניתוח התזונתי</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => matchCatalogMutation.mutate()}
            disabled={matchCatalogMutation.isPending || !items.some(needsMatching)}
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
              {recognizedItems.map(item => (
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
                      item.price > 0 || !(item.catalog_price > 0) ? (
                        <span className="text-sm">{formatCurrency(item.price)}</span>
                      ) : (
                        // No price on the receipt (e.g. a product added by hand): show the catalog price
                        <span className="text-sm text-muted-foreground" title="מחיר משוער לפי הקטלוג">
                          {formatCurrency(item.catalog_price)}
                          <span className="block text-[10px]">לפי הקטלוג</span>
                        </span>
                      )
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{item.calories_per_100g}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {item.protein_per_100g}ג / {item.carbs_per_100g}ג / {item.fat_per_100g}ג
                  </TableCell>
                  <TableCell>
                    <div title={item.health_score == null ? "אין ציון בריאות" : undefined} className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                      item.health_score == null ? "bg-muted text-muted-foreground" :
                      item.health_score >= 7 ? "bg-green-50 text-green-700" :
                      item.health_score >= 4 ? "bg-amber-50 text-amber-700" :
                      "bg-red-50 text-red-700"
                    }`}>
                      {item.health_score ?? "—"}
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
            <p className="text-xs text-muted-foreground mt-0.5">פריטים שסוננו — לא מזון, שורות מבצע, סיכומים ופריטים שהוחרגו</p>
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
                  {item.catalog_match_status === 'non_food' && (
                    <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-background border border-border/60 text-muted-foreground text-xs">
                      סומן על ידך כלא מזון
                    </span>
                  )}
                  {item.catalog_match_status === 'ignored' && (
                    <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-background border border-border/60 text-muted-foreground text-xs">
                      הוחרג על ידך מהסל
                    </span>
                  )}
                  {!item.reasoning && !['non_food', 'ignored'].includes(item.catalog_match_status) && (
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
        <p className="text-sm text-muted-foreground">
          {reviewItems.length > 0
            ? `נותרו ${reviewItems.length} פריטים לבדיקה. עד שתבחרו עבורם, הם לא ייכנסו לסל המוצרים החכם.`
            : "בשלב הבא נבחר עבורכם מוצרים מתאימים מהקבלה ומקטלוג שופרסל."}
        </p>
        <Button onClick={() => navigate(`/shopping-list?receipt_id=${receiptId}&build=1`)} className="rounded-full">
          בניית סל מוצרים חכם <ChevronLeft className="w-4 h-4 mr-1" />
        </Button>
      </Card>
    </div>
  );
}