"use client";

import { useMemo, useState, useTransition } from "react";
import { Button, Card } from "@/components/ui/primitives";
import { AiDisclaimer, AiHeading } from "@/components/ai/ai-chrome";
import { analyzeDocumentAiAction } from "@/server/use-cases/ai-platform";
import type { BusinessCaseAnalysis, DocumentAnalysis } from "@/modules/ai/schemas";
import type { DocumentSourceClass } from "@/modules/ai/classify-source";
import { aiClientErrorMessage } from "@/modules/ai/errors";
import {
  clearGoogleAccessToken,
  requestGoogleDriveFileAccessToken,
  googlePickerErrorFromUnknown,
} from "@/modules/documents/google-gis";
import type { GooglePickerUiError } from "@/modules/documents/google-picker-errors";
import { pickGoogleDriveFile } from "@/modules/documents/google-picker";
import {
  assertPickerMatchesAuthorizedFile,
  driveAiRecoveryVisibility,
} from "@/modules/documents/drive-ai-auth";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/config";

function Section({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <Card className="break-inside-avoid">
      <h3 className="mb-2 text-sm font-semibold text-ink">{title}</h3>
      {items.length ? (
        <ul className="list-disc space-y-1 ps-5 text-sm leading-6 text-ink">
          {items.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{empty}</p>
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
  const { t, locale } = useI18n();
  const d = t.ai.document;
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
  const pickerError = (code: GooglePickerUiError): string => d.pickerErrors[code];

  function run(analysisType: "document" | "business_case", mode: "initial" | "recovery") {
    setError(null);
    setErrorCode(null);
    startTransition(async () => {
      try {
        let googleAccessToken: string | undefined;
        if (needsDrive) {
          if (!clientId) {
            setError(pickerError("not_configured"));
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
                title: d.pickSameFileTitle,
              });
              if (!picked.ok) {
                setError(pickerError(picked.code) || picked.message);
                return;
              }
              const same = assertPickerMatchesAuthorizedFile(picked.file.fileId, authorizedDriveFileId);
              if (!same.ok) {
                setError(locale === "en" ? d.sameFileRequired : same.messageAr);
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
          setError(locale === "en" ? (aiClientErrorMessage(res.code, locale) ?? res.error) : res.error);
          setErrorCode(res.code);
          return;
        }
        setDoc(res.data.document ?? null);
        setBc(res.data.businessCase ?? null);
      } catch (err) {
        const code = googlePickerErrorFromUnknown(err);
        setError(pickerError(code));
      }
    });
  }

  const sourceNote =
    sourceClass === "CONTENT_AVAILABLE"
      ? d.source.contentAvailable
      : sourceClass === "DRIVE_FETCH_REQUIRED"
        ? d.source.driveFetchRequired
        : sourceClass === "METADATA_ONLY"
          ? d.source.metadataOnly
          : d.source.unsupported;

  return (
    <div className="space-y-3" data-testid="document-ai-analysis">
      <AiHeading title={d.title} />
      <p className="text-sm leading-6 text-muted">{sourceNote}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!canRun || pending} onClick={() => run("document", "initial")}>
          {d.analyze}
        </Button>
        {defaultBusinessCase ? (
          <Button
            type="button"
            variant="outline"
            disabled={!canRun || pending}
            onClick={() => run("business_case", "initial")}
          >
            {d.analyzeBusinessCase}
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
            {d.reauthorizeDrive}
          </Button>
        ) : null}
      </div>
      {showRecovery ? (
        <p className="text-sm text-muted" data-testid="document-ai-drive-recover-hint">
          {d.reauthorizeHint}
        </p>
      ) : null}
      {pending ? (
        <p className="text-sm text-muted" aria-live="polite">
          {d.reading}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {doc ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Card className="md:col-span-2">
            <h3 className="mb-2 text-sm font-semibold text-ink">{d.sections.summary}</h3>
            <p className="text-sm leading-7 text-ink">{doc.summary_ar}</p>
          </Card>
          <Section title={d.sections.keyPoints} items={doc.key_points} empty={d.notMentioned} />
          <Section title={d.sections.obligations} items={doc.obligations} empty={d.notMentioned} />
          <Section title={d.sections.dates} items={doc.dates} empty={d.notMentioned} />
          <Section title={d.sections.risks} items={doc.risks} empty={d.notMentioned} />
          <Section title={d.sections.missingInformation} items={doc.missing_information} empty={d.notMentioned} />
          <Section title={d.sections.managementQuestions} items={doc.management_questions} empty={d.notMentioned} />
          {doc.citations.length ? (
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-ink">{d.sections.citations}</h3>
              <ul className="space-y-1 text-sm text-muted">
                {doc.citations.map((c) => (
                  <li key={c.label_ar}>{c.page ? format(d.sections.citationPage, { page: c.page }) : c.label_ar}</li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      ) : null}
      {bc ? (
        <div className="grid gap-3 md:grid-cols-2" data-testid="business-case-ai">
          <Card className="md:col-span-2">
            <h3 className="mb-2 text-sm font-semibold text-ink">{d.sections.executiveSummary}</h3>
            <p className="text-sm leading-7 text-ink">{bc.executive_summary_ar}</p>
          </Card>
          <Section title={d.sections.objectives} items={bc.project_objectives} empty={d.notMentioned} />
          <Section title={d.sections.scope} items={bc.scope_items} empty={d.notMentioned} />
          <Section title={d.sections.requirements} items={bc.key_requirements} empty={d.notMentioned} />
          <Section title={d.sections.risks} items={bc.risks} empty={d.notMentioned} />
          <Section title={d.sections.missingInformation} items={bc.missing_information} empty={d.notMentioned} />
          <Section title={d.sections.managementQuestions} items={bc.management_questions} empty={d.notMentioned} />
          <Section title={d.sections.recommendations} items={bc.recommended_followups} empty={d.notMentioned} />
        </div>
      ) : null}
      <AiDisclaimer />
    </div>
  );
}
