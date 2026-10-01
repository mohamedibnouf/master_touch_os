"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { authorize } from "@/server/policies/authorize";
import { AuditService } from "@/server/services/audit.service";
import { EventService } from "@/server/services/event.service";
import { generateCorrelationId } from "@/lib/utils";
import {
  ConflictError,
  DatabaseError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { formActionFailure, type FormActionState } from "@/server/forms/form-state";
import { assertProjectBelongsToOrganization } from "@/modules/documents/project-scope";
import {
  ARCHIVE_RESTRICTION_AR,
  LIFECYCLE_AUDIT,
  applyArchiveFields,
  applyRestoreFields,
  archiveRestrictionFor,
} from "@/modules/documents/lifecycle";

type LifecycleDoc = {
  id: string;
  organization_id: string;
  project_id: string | null;
  status: string;
  is_register_controlled: boolean;
  approval_request_id: string | null;
  workflow_instance_id: string | null;
  archived_at: string | null;
  archived_by: string | null;
  title: string;
};

async function countEq(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  table:
    | "rfis"
    | "material_submittals"
    | "shop_drawings"
    | "method_statements"
    | "inspection_requests"
    | "ncrs"
    | "transmittal_items"
    | "employee_documents"
    | "projects",
  filters: Record<string, string>,
): Promise<number> {
  let query = supabase.from(table).select("id", { count: "exact", head: true });
  for (const [key, value] of Object.entries(filters)) {
    query = query.eq(key, value);
  }
  const { count, error } = await query;
  if (error) throw new DatabaseError(error);
  return count ?? 0;
}

async function loadLifecycleDocument(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  organizationId: string,
  documentId: string,
): Promise<LifecycleDoc> {
  const { data, error } = await supabase
    .from("documents")
    .select(
      "id, organization_id, project_id, status, is_register_controlled, approval_request_id, workflow_instance_id, archived_at, archived_by, title",
    )
    .eq("id", documentId)
    .eq("organization_id", organizationId)
    .maybeSingle<LifecycleDoc>();
  if (error) throw new DatabaseError(error);
  if (!data) throw new NotFoundError("المستند", "Document");
  return data;
}

async function assertArchiveAllowed(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  doc: LifecycleDoc,
): Promise<void> {
  const org = doc.organization_id;
  const id = doc.id;
  const [
    rfis,
    rfisRelated,
    mats,
    shds,
    mss,
    irs,
    irsDrawing,
    ncrs,
    transmittalItems,
    employeeDocs,
    businessCase,
  ] = await Promise.all([
    countEq(supabase, "rfis", { document_id: id, organization_id: org }),
    countEq(supabase, "rfis", { related_document_id: id, organization_id: org }),
    countEq(supabase, "material_submittals", { document_id: id, organization_id: org }),
    countEq(supabase, "shop_drawings", { document_id: id, organization_id: org }),
    countEq(supabase, "method_statements", { document_id: id, organization_id: org }),
    countEq(supabase, "inspection_requests", { document_id: id, organization_id: org }),
    countEq(supabase, "inspection_requests", { related_drawing_id: id, organization_id: org }),
    countEq(supabase, "ncrs", { document_id: id, organization_id: org }),
    countEq(supabase, "transmittal_items", { document_id: id, organization_id: org }),
    countEq(supabase, "employee_documents", { document_id: id, organization_id: org }),
    countEq(supabase, "projects", { business_case_document_id: id, organization_id: org }),
  ]);

  const code = archiveRestrictionFor({
    is_register_controlled: doc.is_register_controlled,
    approval_request_id: doc.approval_request_id,
    workflow_instance_id: doc.workflow_instance_id,
    hasEngineeringLink:
      rfis + rfisRelated + mats + shds + mss + irs + irsDrawing + ncrs > 0,
    hasTransmittalItem: transmittalItems > 0,
    isProjectBusinessCase: businessCase > 0,
    hasEmployeeDocumentLink: employeeDocs > 0,
  });
  if (code) {
    throw new ValidationError(ARCHIVE_RESTRICTION_AR[code], ARCHIVE_RESTRICTION_AR[code]);
  }
}

async function authorizeLifecycleDocument(formData: FormData) {
  const ctx = authorize(await getAuthContext(), "document.archive");
  const documentId = String(formData.get("documentId") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) {
    throw new ValidationError("المستند غير صالح.", "The document is not valid.");
  }
  const supabase = await createServerSupabaseClient();
  const doc = await loadLifecycleDocument(supabase, ctx.organization.id, documentId);
  if (doc.project_id) {
    const { data: project } = await supabase
      .from("projects")
      .select("id, organization_id")
      .eq("id", doc.project_id)
      .maybeSingle<{ id: string; organization_id: string }>();
    assertProjectBelongsToOrganization(project, ctx.organization.id);
  }
  return { ctx, supabase, doc };
}

function revalidateDocumentPaths(doc: LifecycleDoc) {
  revalidatePath("/documents");
  revalidatePath(`/documents/${doc.id}`);
  revalidatePath("/search");
  revalidatePath("/document-control");
  revalidatePath("/engineering");
  if (doc.project_id) {
    revalidatePath(`/projects/${doc.project_id}`);
  }
}

export async function archiveDocumentAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  try {
    const { ctx, supabase, doc } = await authorizeLifecycleDocument(formData);
    if (doc.archived_at) {
      throw new ConflictError(ARCHIVE_RESTRICTION_AR.alreadyArchived, ARCHIVE_RESTRICTION_AR.alreadyArchived);
    }
    await assertArchiveAllowed(supabase, doc);

    const previousStatus = doc.status;
    const fields = applyArchiveFields(ctx.userId, new Date().toISOString());
    const { error } = await supabase
      .from("documents")
      .update(fields)
      .eq("id", doc.id)
      .eq("organization_id", ctx.organization.id)
      .is("archived_at", null);
    if (error) throw new DatabaseError(error);

    const audit = new AuditService(supabase);
    await audit.log({
      organizationId: ctx.organization.id,
      action: LIFECYCLE_AUDIT.archived,
      entityType: "document",
      entityId: doc.id,
      previousValues: { archived_at: null, status: previousStatus },
      newValues: { archived_at: fields.archived_at, archived_by: fields.archived_by, status: previousStatus },
    });

    await new EventService(supabase).publish({
      type: "document.archived",
      organizationId: ctx.organization.id,
      actorId: ctx.userId,
      entityType: "document",
      entityId: doc.id,
      payload: { status: previousStatus },
      correlationId: generateCorrelationId(),
      occurredAt: fields.archived_at,
    });

    revalidateDocumentPaths(doc);
    return { ok: true, message: "تم أرشفة المستند. يمكن استعادته من المستندات المحذوفة." };
  } catch (err) {
    return formActionFailure(err, "تعذر أرشفة المستند. حاول مرة أخرى.");
  }
}

export async function restoreDocumentAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  try {
    const { ctx, supabase, doc } = await authorizeLifecycleDocument(formData);
    if (!doc.archived_at) {
      throw new ConflictError(ARCHIVE_RESTRICTION_AR.notArchived, ARCHIVE_RESTRICTION_AR.notArchived);
    }

    const previousStatus = doc.status;
    const fields = applyRestoreFields();
    const { error } = await supabase
      .from("documents")
      .update(fields)
      .eq("id", doc.id)
      .eq("organization_id", ctx.organization.id)
      .not("archived_at", "is", null);
    if (error) throw new DatabaseError(error);

    const audit = new AuditService(supabase);
    await audit.log({
      organizationId: ctx.organization.id,
      action: LIFECYCLE_AUDIT.restored,
      entityType: "document",
      entityId: doc.id,
      previousValues: { archived_at: doc.archived_at, archived_by: doc.archived_by, status: previousStatus },
      newValues: { archived_at: null, archived_by: null, status: previousStatus },
    });

    await new EventService(supabase).publish({
      type: "document.restored",
      organizationId: ctx.organization.id,
      actorId: ctx.userId,
      entityType: "document",
      entityId: doc.id,
      payload: { status: previousStatus },
      correlationId: generateCorrelationId(),
      occurredAt: new Date().toISOString(),
    });

    revalidateDocumentPaths(doc);
    return { ok: true, message: "تمت استعادة المستند." };
  } catch (err) {
    return formActionFailure(err, "تعذر استعادة المستند. حاول مرة أخرى.");
  }
}
