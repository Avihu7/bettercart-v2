import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/localAPI";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, FileText, Camera, Loader2, Sparkles, AlertCircle, Info } from "lucide-react";
import { DEMO_RECEIPT_TEXT } from "@/lib/demoData";
import { analyzeReceipt } from "@/lib/receiptPipeline";
import { classifyReceiptLine, receiptInsights } from "@/lib/receiptClassifier";
import { IS_DEMO_MODE } from "@/lib/ai";
import { useAuth } from "@/lib/AuthContext";
import FlowSteps from "@/components/FlowSteps";
import { useFlowData } from "@/lib/flowData";

function getErrorHeadline(error) {
  switch (error?.code) {
    case 'auth':
      return 'לא הוגדר API Key תקין';
    case 'billing':
      return 'נראה שאין קרדיט פעיל ב-Anthropic API';
    case 'unsupported_media':
      return 'סוג קובץ לא נתמך';
    case 'too_large':
      return 'הקובץ גדול מדי';
    default:
      return 'משהו השתבש בניתוח הקבלה';
  }
}

const PIPELINE_STEPS = [
  "מעלה קובץ...",
  "מחלץ טקסט מהקובץ...",
  "מנתח את הקבלה עם AI...",
  "שומר נתוני קבלה...",
  "שומר פריטי מזון...",
];

export default function ReceiptUpload() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { completed } = useFlowData(user);
  const [receiptText, setReceiptText] = useState("");
  const [file, setFile] = useState(null);
  const [uploadMode, setUploadMode] = useState("text");
  const [pipelineStep, setPipelineStep] = useState("");

  const processMutation = useMutation({
    mutationFn: async () => {
      let textToAnalyze = receiptText;
      let fileUrl = null;

      if (uploadMode === "file" && file) {
        setPipelineStep("מעלה קובץ...");
        const { file_url } = await api.integrations.Core.UploadFile({ file });
        fileUrl = file_url;

        setPipelineStep("מחלץ טקסט מהקובץ...");
        const extracted = await api.integrations.Core.ExtractDataFromUploadedFile({
          file_url: fileUrl,
          json_schema: {
            type: "object",
            properties: {
              receipt_text: { type: "string", description: "Full text content of the receipt, preserving item names, prices, and totals" }
            }
          }
        });
        textToAnalyze = extracted.output?.receipt_text;
        // Stop here rather than sending a placeholder to the analysis step and
        // saving an empty receipt.
        if (typeof textToAnalyze !== "string" || !textToAnalyze.trim()) {
          throw new Error("לא הצלחנו לחלץ טקסט מהקובץ — Claude Vision לא החזיר טקסט קבלה");
        }
      }

      setPipelineStep("מנתח את הקבלה עם AI...");
      const result = await analyzeReceipt(textToAnalyze);

      // The AI only read the lines; food / category / menu suitability are
      // decided here by rules (src/lib/receiptClassifier.js), nutrition later
      // by the catalog match, the health score by the server
      const lines = result.lines.map(line => ({ ...line, ...classifyReceiptLine(line) }));
      const food = lines.filter(l => l.is_food);

      setPipelineStep("שומר נתוני קבלה...");
      const receipt = await api.entities.Receipt.create({
        store_name: result.store_name,
        purchase_date: result.purchase_date,
        total_amount: result.total_amount ?? Math.round(lines.reduce((s, l) => s + (l.price || 0), 0) * 100) / 100,
        raw_text: textToAnalyze,
        file_url: fileUrl,
        status: "analyzed",
        ai_raw_output: JSON.stringify(result.raw, null, 2),
        insights: receiptInsights(lines),
        food_item_count: food.length,
        non_food_item_count: lines.length - food.length,
      });

      setPipelineStep("שומר פריטי מזון...");
      if (lines.length > 0) {
        await api.entities.ReceiptItem.bulkCreate(lines.map(line => ({
          receipt_id: receipt.id,
          original_name: line.original_name,
          normalized_name: line.normalized_name,
          category: line.category,
          is_food: line.is_food,
          is_approved_for_menu: line.is_approved_for_menu,
          quantity: line.quantity,
          price: line.price,
          reasoning: line.reasoning,
        })));
      }

      return receipt;
    },
    onSuccess: (receipt) => {
      navigate(`/receipt-results?id=${receipt.id}`);
    },
  });

  const handleFileChange = (e) => {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0]);
    }
  };

  const loadDemo = () => {
    setReceiptText(DEMO_RECEIPT_TEXT);
    setUploadMode("text");
  };

  const isProcessing = processMutation.isPending;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <FlowSteps current={1} completed={completed} />
      <div>
        <h1 className="font-heading text-2xl font-bold">העלאת קבלה</h1>
        <p className="text-sm text-muted-foreground mt-1">
          העלו קבלה מהסופר לניתוח מוצרי המזון שלכם עם AI
        </p>
      </div>

      {/* Demo mode notice */}
      {IS_DEMO_MODE && (
        <Card className="p-4 bg-amber-50 border-amber-200">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800">מצב הדגמה פעיל — ללא API Key</p>
              <p className="text-xs text-amber-700 mt-0.5">
                כל ניתוח קבלה יחזיר נתוני הדגמה (קבלת רמי לוי לדוגמה), ללא קשר לטקסט שתדביקו.
                להפעלת ניתוח אמיתי — הגדירו <strong>VITE_ANTHROPIC_API_KEY</strong> בקובץ .env.
                ניתן להשתמש בכפתור "טען קבלה לדוגמה" לניתוח מהיר.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Supermarket support notice */}
      {!IS_DEMO_MODE && (
        <Card className="p-4 bg-blue-50 border-blue-200">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-blue-800">רשתות נתמכות</p>
              <p className="text-xs text-blue-700 mt-0.5">
                בשלב זה BetterCart תומכת בקבלות מ<strong>רמי לוי</strong> ו<strong>שופרסל</strong> בלבד. אנחנו עובדים על תמיכה ברשתות נוספות בהמשך.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Processing State */}
      {isProcessing && (
        <Card className="p-8 text-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
          <h2 className="font-heading font-semibold text-lg mb-1">מנתחים את הקבלה שלכם...</h2>
          <p className="text-sm text-muted-foreground">{pipelineStep}</p>
          <div className="mt-4 space-y-2 text-right">
            {PIPELINE_STEPS.map(step => (
              <div key={step} className="flex items-center gap-2 text-xs justify-end">
                <span className={step === pipelineStep ? "text-foreground font-medium" : "text-muted-foreground"}>{step}</span>
                <div className={`w-2 h-2 rounded-full ${step === pipelineStep ? "bg-primary animate-pulse" : PIPELINE_STEPS.indexOf(step) < PIPELINE_STEPS.indexOf(pipelineStep) ? "bg-primary" : "bg-muted"}`} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Error State */}
      {processMutation.isError && (
        <Card className="p-4 border-destructive/50 bg-destructive/5">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive mt-0.5" />
            <div>
              <p className="font-medium text-sm">{getErrorHeadline(processMutation.error)}</p>
              <p className="text-xs text-muted-foreground mt-1">נסו שוב בעוד רגע. ודאו שהקבלה היא מרמי לוי או שופרסל.</p>
              <p className="text-xs text-muted-foreground">{processMutation.error?.message}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Upload Form */}
      {!isProcessing && (
        <>
          <Tabs value={uploadMode} onValueChange={setUploadMode}>
            <TabsList className="w-full">
              <TabsTrigger value="text" className="flex-1">
                <FileText className="w-4 h-4 ml-2" /> הדבקת טקסט
              </TabsTrigger>
              <TabsTrigger value="file" className="flex-1">
                <Camera className="w-4 h-4 ml-2" /> העלאת קובץ
              </TabsTrigger>
            </TabsList>

            <TabsContent value="text" className="mt-4">
              <Card className="p-5 space-y-4">
                <Textarea
                  value={receiptText}
                  onChange={e => setReceiptText(e.target.value)}
                  placeholder={`הדביקו כאן את טקסט הקבלה מהסופר...\n\nדוגמה:\nרמי לוי\nחזה עוף 1 ק״ג - 39.90\nאורז 1 ק״ג - 12.90\nסה״כ: 52.80`}
                  className="min-h-[200px] font-mono text-sm"
                  dir="rtl"
                />
                <div className="flex justify-between items-center">
                  <Button
                    onClick={() => processMutation.mutate()}
                    disabled={!receiptText.trim()}
                  >
                    ניתוח הקבלה
                  </Button>
                  <Button variant="outline" size="sm" onClick={loadDemo}>
                    <Sparkles className="w-4 h-4 ml-1" /> טען קבלה לדוגמה
                  </Button>
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="file" className="mt-4">
              <Card className="p-5 space-y-4">
                {IS_DEMO_MODE ? (
                  <div className="flex flex-col items-center justify-center border-2 border-dashed border-amber-200 bg-amber-50 rounded-xl p-10 text-center">
                    <AlertCircle className="w-8 h-8 text-amber-500 mb-3" />
                    <p className="font-medium text-sm text-amber-800">לא ניתן לנתח קובץ ללא OCR/API פעיל</p>
                    <p className="text-xs text-amber-700 mt-2">
                      ניתן להדביק טקסט קבלה בלשונית "הדבקת טקסט" או להשתמש בקבלת הדמו.
                    </p>
                  </div>
                ) : (
                  <>
                    <label className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-xl p-10 cursor-pointer hover:border-primary/50 hover:bg-accent/50 transition-colors">
                      <Upload className="w-8 h-8 text-muted-foreground mb-3" />
                      <p className="font-medium text-sm">{file ? file.name : "לחצו להעלאת קבלה"}</p>
                      <p className="text-xs text-muted-foreground mt-1">PDF, PNG, JPG נתמכים</p>
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        className="hidden"
                        onChange={handleFileChange}
                      />
                    </label>
                    <div className="flex justify-start">
                      <Button
                        onClick={() => processMutation.mutate()}
                        disabled={!file}
                      >
                        ניתוח הקבלה
                      </Button>
                    </div>
                  </>
                )}
              </Card>
            </TabsContent>
          </Tabs>

          {/* Pipeline Info */}
          <Card className="p-5 bg-muted/50 border-0">
            <h3 className="font-heading font-semibold mb-3">מה קורה מאחורי הקלעים?</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[
                "חילוץ טקסט", "ניתוח AI", "סיווג מזון",
                "סינון מוצרים", "זיהוי העדפות", "מיפוי ערכים תזונתיים"
              ].map((step, i) => (
                <div key={step} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">{i + 1}</div>
                  {step}
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}