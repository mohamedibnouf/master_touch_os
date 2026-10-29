"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { pickGoogleDriveFile } from "@/modules/documents/google-picker";
import { googlePickerErrorMessage } from "@/modules/documents/google-picker-errors";
import type { NormalizedGooglePickerFile } from "@/modules/documents/google-picker-normalize";
import { useI18n } from "@/lib/i18n/client";

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
  const { t, locale } = useI18n();
  const tp = t.documents.drivePicker;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openPicker() {
    setError(null);
    setPending(true);
    try {
      const result = await pickGoogleDriveFile({ clientId, apiKey, locale });
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
      setError(googlePickerErrorMessage("network", locale));
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
          {pending ? tp.opening : tp.pick}
        </Button>
        {selected ? (
          <>
            <Button type="button" variant="secondary" onClick={() => void openPicker()} disabled={pending || busy}>
              {tp.change}
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
              {tp.clear}
            </Button>
          </>
        ) : null}
      </div>
      {selected ? (
        <div
          className="flex items-start gap-3 rounded-[var(--radius-control)] border border-line bg-surface-muted p-3 text-sm"
          data-testid="document-drive-picker-selection"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] bg-primary-soft text-primary">
            <FileText className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{selected.name}</p>
            <p className="mt-0.5 text-xs text-muted">
              Google Drive · {mimeLabel(selected.mimeType, selected.kind)}
            </p>
            <p className="mt-2 text-xs text-muted">{tp.accessNote}</p>
          </div>
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
