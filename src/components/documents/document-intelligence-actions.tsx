"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import {
  analyzeDocumentIntelligenceAction,
  verifyDocumentIntelligenceAction,
} from "@/server/use-cases/document-intelligence";
import { requestGoogleDriveFileAccessToken, googlePickerErrorFromUnknown } from "@/modules/documents/google-gis";
import { googlePickerErrorMessage } from "@/modules/documents/google-picker-errors";
import { useI18n } from "@/lib/i18n/client";

export function DocumentIntelligenceActions({
  documentId,
  intelligenceId,
  status,
  canAnalyze,
  canVerify,
  aiEnabled,
  needsDriveToken,
  googlePickerClientId,
}: {
  documentId: string;
  intelligenceId: string | null;
  status: string | null;
  canAnalyze: boolean;
  canVerify: boolean;
  aiEnabled: boolean;
  needsDriveToken?: boolean;
  googlePickerClientId?: string;
}) {
  const { t, locale } = useI18n();
  const ta = t.documents.intelligenceActions;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2 print:hidden" data-testid="doc-intel-actions">
      <div className="flex flex-wrap gap-2">
        {canAnalyze ? (
          <Button
            type="button"
            data-testid="doc-intel-analyze"
            disabled={!aiEnabled || pending || (needsDriveToken && !googlePickerClientId)}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                try {
                  let googleAccessToken: string | undefined;
                  if (needsDriveToken) {
                    if (!googlePickerClientId) {
                      setError(googlePickerErrorMessage("not_configured", locale));
                      return;
                    }
                    googleAccessToken = await requestGoogleDriveFileAccessToken(googlePickerClientId);
                  }
                  const res = await analyzeDocumentIntelligenceAction({ documentId, googleAccessToken });
                  if (!res.ok) {
                    setError(res.error);
                    return;
                  }
                  router.refresh();
                } catch (err) {
                  setError(googlePickerErrorMessage(googlePickerErrorFromUnknown(err), locale));
                }
              });
            }}
          >
            <Sparkles className="size-4" aria-hidden />
            {pending ? ta.analyzing : ta.analyze}
          </Button>
        ) : null}

        {canVerify && status === "EXTRACTED" && intelligenceId ? (
          <Button
            type="button"
            variant="secondary"
            data-testid="doc-intel-verify"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const res = await verifyDocumentIntelligenceAction({
                  intelligenceId,
                  documentId,
                });
                if (!res.ok) {
                  setError(res.error);
                  return;
                }
                router.refresh();
              });
            }}
          >
            <CheckCircle2 className="size-4 text-success" aria-hidden />
            {ta.verify}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className="text-sm text-danger" data-testid="doc-intel-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
