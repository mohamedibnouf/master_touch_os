"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  analyzeDocumentIntelligenceAction,
  verifyDocumentIntelligenceAction,
} from "@/server/use-cases/document-intelligence";
import { requestGoogleDriveFileAccessToken, googlePickerErrorFromUnknown } from "@/modules/documents/google-gis";
import { googlePickerErrorMessage } from "@/modules/documents/google-picker-errors";

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
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2 print:hidden" data-testid="doc-intel-actions">
      <div className="flex flex-wrap gap-2">
        {canAnalyze ? (
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            data-testid="doc-intel-analyze"
            disabled={!aiEnabled || pending || (needsDriveToken && !googlePickerClientId)}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                try {
                  let googleAccessToken: string | undefined;
                  if (needsDriveToken) {
                    if (!googlePickerClientId) {
                      setError(googlePickerErrorMessage("not_configured"));
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
                  setError(googlePickerErrorMessage(googlePickerErrorFromUnknown(err)));
                }
              });
            }}
          >
            {pending ? "جارٍ التحليل…" : "تحليل دراسة الحالة"}
          </button>
        ) : null}

        {canVerify && status === "EXTRACTED" && intelligenceId ? (
          <button
            type="button"
            className="rounded-md border border-primary px-4 py-2 text-sm font-medium text-navy disabled:opacity-50"
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
            تأكيد التحقق البشري
          </button>
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
