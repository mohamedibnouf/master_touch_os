"use client";

import { useMemo, useState } from "react";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { GoogleDrivePickerControls } from "@/components/documents/google-drive-picker-controls";
import { uploadDocumentAction } from "@/server/use-cases/platform";
import { readGooglePickerPublicConfig, isGooglePickerReady } from "@/modules/documents/google-picker-config";
import type { NormalizedGooglePickerFile } from "@/modules/documents/google-picker-normalize";
import { useI18n } from "@/lib/i18n/client";

const CATEGORIES = [
  "business_case",
  "contract",
  "drawing",
  "shop_drawing",
  "material_submittal",
  "rfi",
  "method_statement",
  "inspection_request",
  "ncr",
  "invoice",
  "purchase_order",
  "change_order",
  "handover",
  "warranty",
  "other",
] as const;

export function DocumentSourceForm({
  projectId,
  showProjectPicker,
  projects,
}: {
  projectId?: string;
  showProjectPicker?: boolean;
  projects?: Array<{ id: string; project_code: string; name_ar: string }>;
}) {
  const { t } = useI18n();
  const tf = t.documents.sourceForm;
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

  const [source, setSource] = useState<"google_drive" | "storage">("google_drive");
  const [title, setTitle] = useState("");
  const [driveUrl, setDriveUrl] = useState("");
  const [selected, setSelected] = useState<NormalizedGooglePickerFile | null>(null);
  const [showManualUrl, setShowManualUrl] = useState(!pickerReady);

  function applyPickerFile(file: NormalizedGooglePickerFile) {
    setSelected(file);
    setDriveUrl(file.canonicalUrl);
    setShowManualUrl(false);
    setTitle((current) => (current.trim() ? current : file.name));
  }

  function clearPickerFile() {
    setSelected(null);
    setDriveUrl("");
  }

  return (
    <ServerActionForm action={uploadDocumentAction} className="grid gap-3 md:grid-cols-2">
      {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
      <Field label={tf.title}>
        <Input name="title" required value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label={tf.category}>
        <Select name="category" required defaultValue="other">
          {CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {t.documents.categories[value]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={tf.fileSource}>
        <Select
          name="fileSource"
          value={source}
          onChange={(e) => setSource(e.target.value === "storage" ? "storage" : "google_drive")}
        >
          <option value="google_drive">{tf.sourceDrive}</option>
          <option value="storage">{tf.sourceStorage}</option>
        </Select>
      </Field>
      {showProjectPicker ? (
        <Field label={tf.project}>
          <Select name="projectId" defaultValue="">
            <option value="">{tf.noProject}</option>
            {(projects ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.project_code} — {project.name_ar}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
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
                data-testid="document-drive-manual-toggle"
              >
                {tf.manualToggle}
              </Button>
            </div>
          ) : null}
          {showManualUrl || !pickerReady ? (
            <Field label={tf.driveUrl} hint={tf.driveUrlHint}>
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
                data-testid="document-drive-url"
              />
            </Field>
          ) : (
            <>
              <input type="hidden" name="driveUrl" value={driveUrl} required data-testid="document-drive-url" />
              {selected?.mimeType ? <input type="hidden" name="driveMimeType" value={selected.mimeType} /> : null}
            </>
          )}
        </div>
      ) : (
        <Field label={tf.file}>
          <Input name="file" type="file" required data-testid="document-storage-file" />
        </Field>
      )}
      <div className="flex justify-end border-t border-line pt-3 md:col-span-2">
        <Button type="submit" data-testid="document-save">
          {tf.submit}
        </Button>
      </div>
    </ServerActionForm>
  );
}
