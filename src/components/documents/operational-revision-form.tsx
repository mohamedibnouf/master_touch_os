"use client";

import { useMemo, useState } from "react";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { GoogleDrivePickerControls } from "@/components/documents/google-drive-picker-controls";
import { uploadDocumentAction } from "@/server/use-cases/platform";
import { readGooglePickerPublicConfig, isGooglePickerReady } from "@/modules/documents/google-picker-config";
import type { NormalizedGooglePickerFile } from "@/modules/documents/google-picker-normalize";

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
      <h2 className="mb-2 font-semibold text-navy">إضافة إصدار جديد</h2>
      <p className="mb-4 text-sm text-muted">
        الإصدار الحالي: {currentRevision} · الإصدار التالي: {nextRevision}. يبقى الإصدار السابق محفوظًا.
      </p>
      <ServerActionForm action={uploadDocumentAction} className="grid gap-3 md:grid-cols-2" testId="document-add-version-form">
        <input type="hidden" name="documentId" value={documentId} data-testid="document-revision-document-id" />
        {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
        <input type="hidden" name="title" value={title} />
        <input type="hidden" name="category" value={category} />
        <input type="hidden" name="confidentiality" value={confidentiality} />
        <input type="hidden" name="expectedCurrentRevision" value={currentRevision} />
        <Field label="مصدر الملف">
          <Select
            name="fileSource"
            value={source}
            onChange={(e) => setSource(e.target.value === "google_drive" ? "google_drive" : "storage")}
          >
            <option value="storage">رفع ملف (تخزين النظام)</option>
            <option value="google_drive">Google Drive</option>
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
                  className="px-0"
                  onClick={() => setShowManualUrl((open) => !open)}
                  data-testid="document-revision-drive-manual-toggle"
                >
                  إدخال رابط Google Drive يدويًا
                </Button>
              </div>
            ) : null}
            {showManualUrl || !pickerReady ? (
              <Field
                label="رابط Google Drive"
                hint="يفتح الرابط في Google Drive حسب صلاحيات حسابك هناك. النظام لا يمنح صلاحية Drive ولا يجعل الملف عامًا."
              >
                <Input
                  name="driveUrl"
                  type="url"
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
          <Field label="الملف المعدّل">
            <Input name="file" type="file" required data-testid="document-revision-storage-file" />
          </Field>
        )}
        <div className="md:col-span-2">
          <Button type="submit" data-testid="document-revision-save">
            إضافة إصدار جديد
          </Button>
        </div>
      </ServerActionForm>
    </div>
  );
}
