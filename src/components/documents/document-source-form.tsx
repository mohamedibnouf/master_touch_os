"use client";

import { useState } from "react";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { uploadDocumentAction } from "@/server/use-cases/platform";

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
  const [source, setSource] = useState<"google_drive" | "storage">("google_drive");

  return (
    <ServerActionForm action={uploadDocumentAction} className="grid gap-3 md:grid-cols-2">
      {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
      <Field label="العنوان">
        <Input name="title" required />
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
        <div className="md:col-span-2">
          <Field
            label="رابط Google Drive"
            hint="يفتح الرابط في Google Drive حسب صلاحيات حسابك هناك. النظام لا يمنح صلاحية Drive."
          >
            <Input
              name="driveUrl"
              type="url"
              required
              placeholder="https://drive.google.com/file/d/…"
              data-testid="document-drive-url"
            />
          </Field>
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
