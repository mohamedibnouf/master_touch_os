"use client";

import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { pickGoogleDriveFile } from "@/modules/documents/google-picker";
import { googlePickerErrorMessage } from "@/modules/documents/google-picker-errors";
import type { NormalizedGooglePickerFile } from "@/modules/documents/google-picker-normalize";

function mimeLabel(mimeType: string | null, kind: NormalizedGooglePickerFile["kind"]): string {
  if (kind === "document") return "Google Docs";
  if (kind === "spreadsheets") return "Google Sheets";
  if (kind === "presentation") return "Google Slides";
  if (mimeType) return mimeType;
  return "Google Drive";
}

export function GoogleDrivePickerControls({
  clientId,
  apiKey,
  selected,
  onSelected,
  onCleared,
  busy,
}: {
  clientId: string;
  apiKey: string;
  selected: NormalizedGooglePickerFile | null;
  onSelected: (file: NormalizedGooglePickerFile) => void;
  onCleared: () => void;
  busy?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openPicker() {
    setError(null);
    setPending(true);
    try {
      const result = await pickGoogleDriveFile({ clientId, apiKey });
      if (!result.ok) {
        if (result.code !== "picker_cancelled" && result.code !== "sign_in_cancelled") {
          setError(result.message);
        } else if (result.code === "sign_in_cancelled") {
          setError(result.message);
        }
        return;
      }
      onSelected(result.file);
    } catch {
      setError(googlePickerErrorMessage("network"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => void openPicker()}
          disabled={pending || busy}
          data-testid="document-drive-picker"
        >
          {pending ? "جارٍ فتح Google Drive…" : "اختيار من Google Drive"}
        </Button>
        {selected ? (
          <>
            <Button type="button" variant="secondary" onClick={() => void openPicker()} disabled={pending || busy}>
              تغيير الاختيار
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setError(null);
                onCleared();
              }}
              disabled={pending || busy}
              data-testid="document-drive-picker-clear"
            >
              إزالة الاختيار
            </Button>
          </>
        ) : null}
      </div>
      {selected ? (
        <div
          className="rounded-[var(--radius-control)] border border-line bg-white p-3 text-sm shadow-[var(--shadow-1)]"
          data-testid="document-drive-picker-selection"
        >
          <p className="font-medium text-navy">{selected.name}</p>
          <p className="mt-1 text-xs text-muted">
            Google Drive · {mimeLabel(selected.mimeType, selected.kind)}
          </p>
          <p className="mt-2 text-xs text-muted">
            الفتح يخضع لصلاحيات Google Drive. النظام لا يغيّر المشاركة ولا يجعل الملف عامًا.
          </p>
        </div>
      ) : null}
      {error ? (
        <p className="text-sm text-danger" data-testid="document-drive-picker-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
