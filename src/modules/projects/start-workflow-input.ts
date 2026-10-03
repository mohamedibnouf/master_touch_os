import { z } from "zod";
import { startWorkflowSchema } from "@/modules/approvals/schemas";

export type StartWorkflowFormInput = z.infer<typeof startWorkflowSchema>;

export function parseStartWorkflowForm(input: {
  definitionId: FormDataEntryValue | null;
  entityType: FormDataEntryValue | null;
  entityId: FormDataEntryValue | null;
}): { ok: true; data: StartWorkflowFormInput } | { ok: false; field: "definitionId" | "entityType" | "entityId" | "shape" } {
  const parsed = startWorkflowSchema.safeParse({
    definitionId: input.definitionId,
    entityType: input.entityType,
    entityId: input.entityId,
  });
  if (parsed.success) return { ok: true, data: parsed.data };
  const paths = parsed.error.issues.map((issue) => String(issue.path[0] ?? ""));
  if (paths.includes("definitionId")) return { ok: false, field: "definitionId" };
  if (paths.includes("entityId")) return { ok: false, field: "entityId" };
  if (paths.includes("entityType")) return { ok: false, field: "entityType" };
  return { ok: false, field: "shape" };
}

export function startWorkflowValidationMessage(field: "definitionId" | "entityType" | "entityId" | "shape"): {
  ar: string;
  en: string;
} {
  if (field === "definitionId") {
    return { ar: "اختر قالب مسار العمل.", en: "Select a workflow template." };
  }
  if (field === "entityId") {
    return { ar: "تعذر تحديد المشروع.", en: "The project could not be identified." };
  }
  if (field === "entityType") {
    return { ar: "مسار العمل غير متاح لهذا المشروع.", en: "This workflow is not available for this entity." };
  }
  return { ar: "تعذر بدء مسار العمل.", en: "Could not start the workflow." };
}

export function mapStartWorkflowRpcError(message: string): {
  kind: "FORBIDDEN" | "CONFLICT" | "VALIDATION" | "NOT_FOUND" | "DATABASE";
  ar: string;
  en: string;
} {
  if (message.includes("CONFLICT")) {
    return { kind: "CONFLICT", ar: "تم بدء مسار العمل مسبقاً.", en: "This workflow was already started." };
  }
  if (message.includes("FORBIDDEN")) {
    return {
      kind: "FORBIDDEN",
      ar: "ليس لديك صلاحية بدء مسار العمل.",
      en: "You do not have permission to start this workflow.",
    };
  }
  if (message.includes("VALIDATION")) {
    return {
      kind: "VALIDATION",
      ar: "مسار العمل غير متاح لهذا المشروع.",
      en: "This workflow is not available for this entity.",
    };
  }
  if (message.includes("NOT_FOUND")) {
    return {
      kind: "NOT_FOUND",
      ar: "تعذر بدء المسار بسبب إعداد غير مكتمل.",
      en: "The workflow is not fully configured.",
    };
  }
  return {
    kind: "DATABASE",
    ar: "تعذر بدء مسار العمل.",
    en: "Could not start the workflow.",
  };
}
