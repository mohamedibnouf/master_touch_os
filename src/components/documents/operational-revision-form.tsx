"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Field, Input, Select } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { GoogleDrivePickerControls } from "@/components/documents/google-drive-picker-controls";
import { uploadDocumentAction } from "@/server/use-cases/platform";
import { readGooglePickerPublicConfig, isGooglePickerReady } from "@/modules/documents/google-picker-config";
import type { NormalizedGooglePickerFile } from "@/modules/documents/google-picker-normalize";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/config";

export function OperationalDocumentRevisionForm({
  documentId,
  projectId,
  title,
  category,
  confidentiality,
  currentRevision,
  nextRevision,
}: {
  documentId: string;
  projectId: string | null;
  title: string;
  category: string;
  confidentiality: string;
  currentRevision: string;
  nextRevision: string;
}) {
  const { t } = useI18n();
  const tr = t.documents.revisionForm;
  const pickerConfig = useMemo(
    () =>
      readGooglePickerPublicConfig({
        NEXT_PUBLIC_GOOGLE_PICKER_ENABLED: process.env.NEXT_PUBLIC_GOOGLE_PICKER_ENABLED,
        NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID,
        NEXT_PUBLIC_GOOGLE_PICKER_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY,
      }),
    [],
  );
  const pickerReady = isGooglePickerReady(pickerConfig);
  const [source, setSource] = useState<"google_drive" | "storage">("storage");
  const [driveUrl, setDriveUrl] = useState("");
  const [selected, setSelected] = useState<NormalizedGooglePickerFile | null>(null);
  const [showManualUrl, setShowManualUrl] = useState(!pickerReady);

  function applyPickerFile(file: NormalizedGooglePickerFile) {
    setSelected(file);
    setDriveUrl(file.canonicalUrl);
    setShowManualUrl(false);
  }

  function clearPickerFile() {
    setSelected(null);
    setDriveUrl("");
  }

  return (
    <div data-testid="document-add-version">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{tr.heading}</h2>
          <p className="mt-1 text-sm text-muted">
            {format(tr.description, { current: currentRevision, next: nextRevision })}
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted" dir="ltr">
          <Badge tone="neutral">{currentRevision}</Badge>
          <span aria-hidden>→</span>
          <Badge tone="info">{nextRevision}</Badge>
        </div>
      </div>
      <ServerActionForm action={uploadDocumentAction} className="grid gap-3 md:grid-cols-2" testId="document-add-version-form">
        <input type="hidden" name="documentId" value={documentId} data-testid="document-revision-document-id" />
        {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
        <input type="hidden" name="title" value={title} />
        <input type="hidden" name="category" value={category} />
        <input type="hidden" name="confidentiality" value={confidentiality} />
        <input type="hidden" name="expectedCurrentRevision" value={currentRevision} />
        <Field label={tr.fileSource}>
          <Select
            name="fileSource"
            value={source}
            onChange={(e) => setSource(e.target.value === "google_drive" ? "google_drive" : "storage")}
          >
            <option value="storage">{tr.sourceStorage}</option>
            <option value="google_drive">{tr.sourceDrive}</option>
          </Select>
        </Field>
        {source === "google_drive" ? (
          <div className="grid gap-3 md:col-span-2">
            {pickerReady ? (
              <GoogleDrivePickerControls
                clientId={pickerConfig.clientId}
                apiKey={pickerConfig.apiKey}
                selected={selected}
                onSelected={applyPickerFile}
                onCleared={clearPickerFile}
              />
            ) : null}
            {pickerReady ? (
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  className="px-0 text-primary hover:bg-transparent hover:text-primary-hover"
                  onClick={() => setShowManualUrl((open) => !open)}
                  data-testid="document-revision-drive-manual-toggle"
                >
                  {tr.manualToggle}
                </Button>
              </div>
            ) : null}
            {showManualUrl || !pickerReady ? (
              <Field label={tr.driveUrl} hint={tr.driveUrlHint}>
                <Input
                  name="driveUrl"
                  type="url"
                  dir="ltr"
                  required={!selected}
                  value={driveUrl}
                  onChange={(e) => {
                    setDriveUrl(e.target.value);
                    setSelected(null);
                  }}
                  placeholder="https://drive.google.com/file/d/…"
                  data-testid="document-revision-drive-url"
                />
              </Field>
            ) : (
              <>
                <input type="hidden" name="driveUrl" value={driveUrl} required data-testid="document-revision-drive-url" />
                {selected?.mimeType ? <input type="hidden" name="driveMimeType" value={selected.mimeType} /> : null}
              </>
            )}
          </div>
        ) : (
          <Field label={tr.file}>
            <Input name="file" type="file" required data-testid="document-revision-storage-file" />
          </Field>
        )}
        <div className="flex justify-end border-t border-line pt-3 md:col-span-2">
          <Button type="submit" data-testid="document-revision-save">
            {tr.submit}
          </Button>
        </div>
      </ServerActionForm>
    </div>
  );
}
