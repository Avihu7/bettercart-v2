import React, { useState } from "react";
import { api } from "@/api/localAPI";
import { useAuth } from "@/lib/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bug, FileText, Brain, ShoppingCart, UtensilsCrossed, Database
} from "lucide-react";
import { format } from "date-fns";

function JsonBlock({ data, title }) {
  return (
    <div>
      {title && <h3 className="font-heading font-semibold text-sm mb-2">{title}</h3>}
      <ScrollArea className="h-[400px]">
        <pre className="bg-muted rounded-lg p-4 text-xs font-mono whitespace-pre-wrap overflow-x-auto">
          {typeof data === "string" ? data : JSON.stringify(data, null, 2)}
        </pre>
      </ScrollArea>
    </div>
  );
}

export default function DebugView() {
  const { user } = useAuth();
  const [selectedReceiptId, setSelectedReceiptId] = useState("");

  const { data: receipts = [] } = useQuery({
    queryKey: ["receipts", user?.email],
    queryFn: () => api.entities.Receipt.filter({ created_by: user.email }, "-created_date", 20),
    initialData: [],
    enabled: !!user,
  });

  const { data: receiptItems = [] } = useQuery({
    queryKey: ["debugReceiptItems", selectedReceiptId, user?.email],
    queryFn: () => selectedReceiptId
      ? api.entities.ReceiptItem.filter({ receipt_id: selectedReceiptId, created_by: user.email })
      : [],
    enabled: !!selectedReceiptId && !!user,
  });

  const { data: shoppingLists = [] } = useQuery({
    queryKey: ["shoppingLists", user?.email],
    queryFn: () => api.entities.ShoppingList.filter({ created_by: user.email }, "-created_date", 5),
    initialData: [],
    enabled: !!user,
  });

  const { data: plans = [] } = useQuery({
    queryKey: ["nutritionPlans", user?.email],
    queryFn: () => api.entities.NutritionPlan.filter({ created_by: user.email }, "-created_date", 5),
    initialData: [],
    enabled: !!user,
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["userProfile", user?.email],
    queryFn: () => api.entities.UserProfile.filter({ created_by: user.email }),
    initialData: [],
    enabled: !!user,
  });

  const selectedReceipt = receipts.find(r => r.id === selectedReceiptId);

  const latestReceiptId = receipts?.[0]?.id;
  const latestListId = shoppingLists?.[0]?.id;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold flex items-center gap-2">
          <Bug className="w-6 h-6" /> Debug & Presentation View
        </h1>
        <p className="text-sm text-muted-foreground">
          Raw data view for project presentation and debugging
        </p>
      </div>

      {/* Identity & Reset Panel */}
      <Card className="p-4 bg-slate-50 border-slate-200">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="space-y-1 font-mono text-xs text-slate-600">
            <p><span className="font-semibold text-slate-800">User:</span> {user?.email || '—'}</p>
            <p><span className="font-semibold text-slate-800">Latest Receipt ID:</span> {latestReceiptId || '—'}</p>
            <p><span className="font-semibold text-slate-800">Latest Shopping List ID:</span> {latestListId || '—'}</p>
            <p><span className="font-semibold text-slate-800">Profile:</span> {profiles?.[0] ? `id=${profiles[0].id}` : 'אין פרופיל'}</p>
          </div>
        </div>
      </Card>

      {/* Receipt Selector */}
      <Card className="p-4">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium">Select Receipt:</span>
          <Select value={selectedReceiptId} onValueChange={setSelectedReceiptId}>
            <SelectTrigger className="w-[300px]">
              <SelectValue placeholder="Choose a receipt..." />
            </SelectTrigger>
            <SelectContent>
              {receipts.map(r => (
                <SelectItem key={r.id} value={r.id}>
                  {r.store_name || "Receipt"} — {r.created_date ? format(new Date(r.created_date), "MMM d, yyyy HH:mm") : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Tabs defaultValue="pipeline">
        <TabsList className="w-full flex-wrap">
          <TabsTrigger value="pipeline"><Brain className="w-4 h-4 mr-1" /> Pipeline</TabsTrigger>
          <TabsTrigger value="raw"><FileText className="w-4 h-4 mr-1" /> Raw Text</TabsTrigger>
          <TabsTrigger value="items"><Database className="w-4 h-4 mr-1" /> Items</TabsTrigger>
          <TabsTrigger value="shopping"><ShoppingCart className="w-4 h-4 mr-1" /> Shopping</TabsTrigger>
          <TabsTrigger value="nutrition"><UtensilsCrossed className="w-4 h-4 mr-1" /> Nutrition</TabsTrigger>
          <TabsTrigger value="profile"><Bug className="w-4 h-4 mr-1" /> Profile</TabsTrigger>
        </TabsList>

        {/* Pipeline Flow */}
        <TabsContent value="pipeline" className="mt-4">
          <Card className="p-5">
            <h2 className="font-heading font-semibold text-lg mb-4">Receipt Intelligence Pipeline</h2>
            <div className="space-y-4">
              {[
                { step: "1. Upload Receipt", desc: "User uploads receipt text or image", status: receipts.length > 0 ? "done" : "pending" },
                { step: "2. Text Extraction", desc: "OCR or text parsing from receipt", status: selectedReceipt?.raw_text ? "done" : "pending" },
                { step: "3. AI Analysis", desc: "InvokeLLM with structured JSON schema", status: selectedReceipt?.ai_raw_output ? "done" : "pending" },
                { step: "4. Food Classification", desc: "Categorize items as protein/carb/fat/etc.", status: receiptItems.some(i => i.category) ? "done" : "pending" },
                { step: "5. Non-food Filtering", desc: "Remove cleaning products, cosmetics, etc.", status: receiptItems.some(i => !i.is_food) ? "done" : "pending" },
                { step: "6. Shopping List Generation", desc: "Rule-based basket from receipt + profile (no AI)", status: shoppingLists.length > 0 ? "done" : "pending" },
                { step: "7. Nutrition Plan", desc: "Weekly meal plan from shopping list", status: plans.length > 0 ? "done" : "pending" },
                { step: "8. PDF Export", desc: "Downloadable shopping list and meal plan", status: "ready" },
              ].map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                    s.status === "done" ? "bg-primary text-primary-foreground" :
                    s.status === "ready" ? "bg-accent text-accent-foreground" :
                    "bg-muted text-muted-foreground"
                  }`}>
                    {i + 1}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{s.step}</p>
                    <p className="text-xs text-muted-foreground">{s.desc}</p>
                  </div>
                  <Badge variant={s.status === "done" ? "default" : "secondary"} className="ml-auto text-xs">
                    {s.status}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        {/* Raw Receipt Text */}
        <TabsContent value="raw" className="mt-4">
          <Card className="p-5">
            {selectedReceipt ? (
              <JsonBlock data={selectedReceipt.raw_text} title="Raw Receipt Text" />
            ) : (
              <p className="text-muted-foreground text-sm">Select a receipt above</p>
            )}
          </Card>
        </TabsContent>

        {/* AI JSON Output + Items */}
        <TabsContent value="items" className="mt-4 space-y-4">
          {selectedReceipt?.ai_raw_output && (
            <Card className="p-5">
              <JsonBlock data={selectedReceipt.ai_raw_output} title="AI JSON Output" />
            </Card>
          )}
          <Card className="p-5">
            <JsonBlock data={receiptItems} title={`Extracted Items (${receiptItems.length})`} />
          </Card>
        </TabsContent>

        {/* Shopping Lists */}
        <TabsContent value="shopping" className="mt-4">
          <Card className="p-5">
            <JsonBlock data={shoppingLists} title={`Shopping Lists (${shoppingLists.length})`} />
          </Card>
        </TabsContent>

        {/* Nutrition Plans */}
        <TabsContent value="nutrition" className="mt-4">
          <Card className="p-5">
            <JsonBlock data={plans} title={`Nutrition Plans (${plans.length})`} />
          </Card>
        </TabsContent>

        {/* Profile */}
        <TabsContent value="profile" className="mt-4">
          <Card className="p-5">
            <JsonBlock data={profiles} title="User Profile" />
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}