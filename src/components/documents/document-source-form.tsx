"use client";

import { useMemo, useState } from "react";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { GoogleDrivePickerControls } from "@/components/documents/google-drive-picker-controls";
import { uploadDocumentAction } from "@/server/use-cases/platform";
import { readGooglePickerPublicConfig, isGooglePickerReady } from "@/modules/documents/google-picker-config";
import type { NormalizedGooglePickerFile } from "@/modules/documents/google-picker-normalize";

const CATEGORIES: Array<{ value: string; label: string }> = [
  { value: "business_case", label: "دراسة حالة / Business Case" },
  { value: "contract", label: "عقد" },
  { value: "drawing", label: "مخطط" },
  { value: "shop_drawing", label: "مخطط ورشة" },
  { value: "material_submittal", label: "تقديم مواد" },
  { value: "rfi", label: "استفسار RFI" },
  { value: "method_statement", label: "بيان طريقة" },
  { value: "inspection_request", label: "طلب فحص" },
  { value: "ncr", label: "NCR" },
  { value: "invoice", label: "فاتورة" },
  { value: "purchase_order", label: "أمر شراء" },
  { value: "change_order", label: "أمر تغيير" },
  { value: "handover", label: "تسليم" },
  { value: "warranty", label: "ضمان" },
  { value: "other", label: "أخرى" },
];

export function DocumentSourceForm({
  projectId,
  showProjectPicker,
  projects,
}: {
  projectId?: string;
  showProjectPicker?: boolean;
  projects?: Array<{ id: string; project_code: string; name_ar: string }>;
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
      <Field label="العنوان">
        <Input name="title" required value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="التصنيف">
        <Select name="category" required defaultValue="other">
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="مصدر الملف">
        <Select
          name="fileSource"
          value={source}
          onChange={(e) => setSource(e.target.value === "storage" ? "storage" : "google_drive")}
        >
          <option value="google_drive">Google Drive</option>
          <option value="storage">رفع ملف (تخزين النظام)</option>
        </Select>
      </Field>
      {showProjectPicker ? (
        <Field label="المشروع (اختياري)">
          <Select name="projectId" defaultValue="">
            <option value="">بدون مشروع</option>
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
                className="px-0"
                onClick={() => setShowManualUrl((open) => !open)}
                data-testid="document-drive-manual-toggle"
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
        <Field label="الملف">
          <Input name="file" type="file" required data-testid="document-storage-file" />
        </Field>
      )}
      <div className="md:col-span-2">
        <Button type="submit" data-testid="document-save">
          إضافة مستند
        </Button>
      </div>
    </ServerActionForm>
  );
}
