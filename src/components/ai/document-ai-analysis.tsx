"use client";

import { useMemo, useState, useTransition } from "react";
import { Button, Card } from "@/components/ui/primitives";
import { AiDisclaimer, AiSparkle } from "@/components/ai/ai-chrome";
import { analyzeDocumentAiAction } from "@/server/use-cases/ai-platform";
import type { BusinessCaseAnalysis, DocumentAnalysis } from "@/modules/ai/schemas";
import type { DocumentSourceClass } from "@/modules/ai/classify-source";
import {
  clearGoogleAccessToken,
  requestGoogleDriveFileAccessToken,
  googlePickerErrorFromUnknown,
} from "@/modules/documents/google-gis";
import { googlePickerErrorMessage } from "@/modules/documents/google-picker-errors";
import { pickGoogleDriveFile } from "@/modules/documents/google-picker";
import {
  assertPickerMatchesAuthorizedFile,
  driveAiRecoveryVisibility,
} from "@/modules/documents/drive-ai-auth";

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

async function obtainDriveToken(clientId: string): Promise<string> {
  return requestGoogleDriveFileAccessToken(clientId);
}

export function DocumentAiAnalysisPanel({
  documentId,
  enabled,
  sourceClass,
  defaultBusinessCase,
  googlePickerClientId,
  googlePickerApiKey,
  authorizedDriveFileId,
}: {
  documentId: string;
  enabled: boolean;
  sourceClass: DocumentSourceClass;
  defaultBusinessCase: boolean;
  googlePickerClientId?: string;
  googlePickerApiKey?: string;
  authorizedDriveFileId?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [recoveryUsed, setRecoveryUsed] = useState(false);
  const [doc, setDoc] = useState<DocumentAnalysis | null>(null);
  const [bc, setBc] = useState<BusinessCaseAnalysis | null>(null);
  const needsDrive = sourceClass === "DRIVE_FETCH_REQUIRED";
  const canRun = enabled && (sourceClass === "CONTENT_AVAILABLE" || (needsDrive && Boolean(googlePickerClientId)));
  const clientId = useMemo(() => googlePickerClientId ?? "", [googlePickerClientId]);
  const apiKey = googlePickerApiKey ?? "";
  const showRecovery = needsDrive && driveAiRecoveryVisibility({ recoveryUsed, errorCode }).showRecovery;

  function run(analysisType: "document" | "business_case", mode: "initial" | "recovery") {
    setError(null);
    setErrorCode(null);
    startTransition(async () => {
      try {
        let googleAccessToken: string | undefined;
        if (needsDrive) {
          if (!clientId) {
            setError(googlePickerErrorMessage("not_configured"));
            return;
          }
          if (mode === "recovery") {
            if (recoveryUsed) return;
            setRecoveryUsed(true);
            clearGoogleAccessToken();
            if (authorizedDriveFileId && apiKey) {
              const picked = await pickGoogleDriveFile({
                clientId,
                apiKey,
                interactive: true,
                title: "اختر نفس ملف Google Drive الأصلي",
              });
              if (!picked.ok) {
                setError(picked.message);
                return;
              }
              const same = assertPickerMatchesAuthorizedFile(picked.file.fileId, authorizedDriveFileId);
              if (!same.ok) {
                setError(same.messageAr);
                return;
              }
              googleAccessToken = await requestGoogleDriveFileAccessToken(clientId, { interactive: false });
            } else {
              googleAccessToken = await requestGoogleDriveFileAccessToken(clientId, { interactive: true });
            }
          } else {
            googleAccessToken = await obtainDriveToken(clientId);
          }
        }
        const res = await analyzeDocumentAiAction({ documentId, analysisType, refresh: true, googleAccessToken });
        if (!res.ok) {
          setError(res.error);
          setErrorCode(res.code);
          return;
        }
        setDoc(res.data.document ?? null);
        setBc(res.data.businessCase ?? null);
      } catch (err) {
        const code = googlePickerErrorFromUnknown(err);
        setError(googlePickerErrorMessage(code));
      }
    });
  }

  const sourceNote =
    sourceClass === "CONTENT_AVAILABLE"
      ? "المحتوى متاح للتحليل من تخزين النظام."
      : sourceClass === "DRIVE_FETCH_REQUIRED"
        ? "سيتم قراءة محتوى الملف من Google Drive بعد تفويض قصير، دون حفظ الرمز. فتح الملف في المتصفح لا يكفي؛ التطبيق يحتاج تفويض drive.file لنفس الحساب."
        : sourceClass === "METADATA_ONLY"
          ? "بيانات وصفية فقط — تحليل المحتوى غير متاح لهذا المصدر."
          : "نوع الملف غير مدعوم للتحليل حالياً.";

  return (
    <div className="space-y-3" data-testid="document-ai-analysis">
      <div className="flex flex-wrap items-center gap-2">
        <AiSparkle />
        <h2 className="font-semibold text-ink">تحليل المستند بالذكاء الاصطناعي</h2>
      </div>
      <p className="text-sm text-muted">{sourceNote}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!canRun || pending} onClick={() => run("document", "initial")}>
          تحليل المستند بالذكاء الاصطناعي
        </Button>
        {defaultBusinessCase ? (
          <Button
            type="button"
            variant="outline"
            disabled={!canRun || pending}
            onClick={() => run("business_case", "initial")}
          >
            تحليل دراسة الحالة
          </Button>
        ) : null}
        {showRecovery ? (
          <Button
            type="button"
            variant="outline"
            disabled={!canRun || pending}
            data-testid="document-ai-drive-recover"
            onClick={() => run("document", "recovery")}
          >
            إعادة تفويض Google Drive
          </Button>
        ) : null}
      </div>
      {showRecovery ? (
        <p className="text-sm text-muted" data-testid="document-ai-drive-recover-hint">
          اختر حساب Google الذي يحتوي الملف، ثم أعد اختيار نفس الملف من Google Drive. لن يُنشأ إصدار جديد.
        </p>
      ) : null}
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
              <h3 className="mb-3 font-semibold">المصادر</h3>
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
