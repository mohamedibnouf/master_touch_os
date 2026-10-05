"use client";

import { useState, useTransition } from "react";
import { Button, Card } from "@/components/ui/primitives";
import { AiDisclaimer, AiSparkle } from "@/components/ai/ai-chrome";
import { analyzeDocumentAiAction } from "@/server/use-cases/ai-platform";
import type { BusinessCaseAnalysis, DocumentAnalysis } from "@/modules/ai/schemas";

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <Card className="break-inside-avoid">
      <h3 className="mb-2 font-semibold text-ink">{title}</h3>
      {items.length ? (
        <ul className="list-disc space-y-1 pr-5 text-sm leading-6">
          {items.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">غير مذكور في النص المستخرج.</p>
      )}
    </Card>
  );
}

export function DocumentAiAnalysisPanel({
  documentId,
  enabled,
  sourceClass,
  defaultBusinessCase,
}: {
  documentId: string;
  enabled: boolean;
  sourceClass: "CONTENT_AVAILABLE" | "METADATA_ONLY" | "UNSUPPORTED";
  defaultBusinessCase: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<DocumentAnalysis | null>(null);
  const [bc, setBc] = useState<BusinessCaseAnalysis | null>(null);

  function run(analysisType: "document" | "business_case") {
    setError(null);
    startTransition(async () => {
      const res = await analyzeDocumentAiAction({ documentId, analysisType, refresh: true });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDoc(res.data.document ?? null);
      setBc(res.data.businessCase ?? null);
    });
  }

  const sourceNote =
    sourceClass === "CONTENT_AVAILABLE"
      ? "المحتوى متاح للتحليل من تخزين النظام."
      : sourceClass === "METADATA_ONLY"
        ? "بيانات وصفية فقط — تحليل المحتوى غير متاح (مثل Google Drive في الوضع الحالي)."
        : "نوع الملف غير مدعوم للتحليل حالياً.";

  return (
    <div className="space-y-3" data-testid="document-ai-analysis">
      <div className="flex flex-wrap items-center gap-2">
        <AiSparkle />
        <h2 className="font-semibold text-ink">تحليل المستند بالذكاء الاصطناعي</h2>
      </div>
      <p className="text-sm text-muted">{sourceNote}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={!enabled || pending || sourceClass !== "CONTENT_AVAILABLE"}
          onClick={() => run("document")}
        >
          تحليل المستند بالذكاء الاصطناعي
        </Button>
        {defaultBusinessCase ? (
          <Button
            type="button"
            variant="outline"
            disabled={!enabled || pending || sourceClass !== "CONTENT_AVAILABLE"}
            onClick={() => run("business_case")}
          >
            تحليل دراسة الحالة
          </Button>
        ) : null}
      </div>
      {pending ? <p className="text-sm text-muted">جاري قراءة المستند...</p> : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {doc ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Card>
            <h3 className="mb-2 font-semibold">الملخص</h3>
            <p className="text-sm leading-7">{doc.summary_ar}</p>
          </Card>
          <Section title="النقاط الرئيسية" items={doc.key_points} />
          <Section title="الالتزامات" items={doc.obligations} />
          <Section title="التواريخ" items={doc.dates} />
          <Section title="المخاطر" items={doc.risks} />
          <Section title="المعلومات الناقصة" items={doc.missing_information} />
          <Section title="أسئلة للإدارة" items={doc.management_questions} />
          {doc.citations.length ? (
            <Card>
              <h3 className="mb-2 font-semibold">المصادر</h3>
              <ul className="text-sm text-muted">
                {doc.citations.map((c) => (
                  <li key={c.label_ar}>{c.page ? `المصدر: صفحة ${c.page}` : c.label_ar}</li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      ) : null}
      {bc ? (
        <div className="grid gap-3 md:grid-cols-2" data-testid="business-case-ai">
          <Card className="md:col-span-2">
            <h3 className="mb-2 font-semibold">الملخص التنفيذي</h3>
            <p className="text-sm leading-7">{bc.executive_summary_ar}</p>
          </Card>
          <Section title="الأهداف" items={bc.project_objectives} />
          <Section title="النطاق" items={bc.scope_items} />
          <Section title="المتطلبات" items={bc.key_requirements} />
          <Section title="المخاطر" items={bc.risks} />
          <Section title="المعلومات الناقصة" items={bc.missing_information} />
          <Section title="أسئلة للإدارة" items={bc.management_questions} />
          <Section title="التوصيات" items={bc.recommended_followups} />
        </div>
      ) : null}
      <AiDisclaimer />
    </div>
  );
}
