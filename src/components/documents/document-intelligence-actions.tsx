"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  analyzeDocumentIntelligenceAction,
  verifyDocumentIntelligenceAction,
} from "@/server/use-cases/document-intelligence";

export function DocumentIntelligenceActions({
  documentId,
  intelligenceId,
  status,
  canAnalyze,
  canVerify,
  aiEnabled,
}: {
  documentId: string;
  intelligenceId: string | null;
  status: string | null;
  canAnalyze: boolean;
  canVerify: boolean;
  aiEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap gap-2 print:hidden" data-testid="doc-intel-actions">
      {canAnalyze ? (
        <button
          type="button"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          data-testid="doc-intel-analyze"
          disabled={!aiEnabled || pending}
          onClick={() => {
            startTransition(async () => {
              const res = await analyzeDocumentIntelligenceAction({ documentId });
              if (!res.ok) {
                alert(res.error);
                return;
              }
              router.refresh();
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
            startTransition(async () => {
              const res = await verifyDocumentIntelligenceAction({
                intelligenceId,
                documentId,
              });
              if (!res.ok) {
                alert(res.error);
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
  );
}
