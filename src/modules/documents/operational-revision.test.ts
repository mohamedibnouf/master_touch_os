import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  OPERATIONAL_ORPHAN_CLEANUP,
  OPERATIONAL_REVISION_AUDIT,
  applyOperationalRevision,
  authorizeOperationalRevision,
  canOfferOperationalRevision,
  mapOperationalRevisionRpcError,
  nextOperationalRevision,
  operationalStorageObjectPath,
  operationalStoragePathPrefix,
  type OperationalDocumentSnapshot,
  type OperationalRevisionActor,
  type OperationalVersionSnapshot,
} from "./operational-revision";

const sql078 = readFileSync("supabase/migrations/078_operational_document_version.sql", "utf8");
const sql077 = readFileSync("supabase/migrations/077_step_local_workflow_execution.sql", "utf8");
const sql029 = readFileSync("supabase/migrations/029_document_version_lifecycle.sql", "utf8");
const platformSrc = readFileSync("src/server/use-cases/platform.ts", "utf8");
const storageSrc = readFileSync("src/server/services/storage.service.ts", "utf8");
const pageSrc = readFileSync("src/app/(app)/documents/[id]/page.tsx", "utf8");
const formSrc = readFileSync("src/components/documents/operational-revision-form.tsx", "utf8");
const openSrc = readFileSync("src/components/documents/document-open-control.tsx", "utf8");

const ORG = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const DOC = "25fcf7b6-c8aa-4012-a41f-b9ff1687edb7";
const PROJECT = "cbf8f9e7-ca63-4231-8694-8a95372cbd20";
const USER = "c0482306-a50e-4264-91d2-624d57b4a0b4";
const VER_A = "6b83ac09-d63d-49af-978e-e1f5ea73e4d4";
const PATH_A = `${ORG}/${PROJECT}/${DOC}/A/02_Project_Charter_and_Scope.docx`;
const PATH_B = `${ORG}/${PROJECT}/${DOC}/B/02_Project_Charter_and_Scope_revB.docx`;

function actor(overrides: Partial<OperationalRevisionActor> = {}): OperationalRevisionActor {
  return {
    userId: USER,
    organizationId: ORG,
    membershipActive: true,
    profileActive: true,
    hasDocumentUpload: true,
    hasDocumentApprove: false,
    hasWorkflowAdvance: false,
    ...overrides,
  };
}

function document(overrides: Partial<OperationalDocumentSnapshot> = {}): OperationalDocumentSnapshot {
  return {
    id: DOC,
    organizationId: ORG,
    projectId: PROJECT,
    currentRevision: "A",
    status: "submitted",
    approvalState: "pending",
    officialDecision: null,
    submissionStatus: "not_submitted",
    workflowInstanceId: null,
    approvalRequestId: null,
    isRegisterControlled: false,
    archivedAt: null,
    ...overrides,
  };
}

function versionA(overrides: Partial<OperationalVersionSnapshot> = {}): OperationalVersionSnapshot {
  return {
    id: VER_A,
    documentId: DOC,
    revision: "A",
    fileSource: "storage",
    filePath: PATH_A,
    fileName: "02_Project_Charter_and_Scope.docx",
    isCurrent: true,
    isSuperseded: false,
    uploadedBy: USER,
    ...overrides,
  };
}

describe("078 operational document version SQL contract", () => {
  it("adds create_operational_document_version without altering 077 or 029", () => {
    expect(sql078).toContain("create or replace function public.create_operational_document_version");
    expect(sql078).toContain("create or replace function public.next_operational_revision_code");
    expect(sql078).not.toContain("create_document_revision");
    expect(sql078).not.toContain("next_revision_code");
    expect(sql077).not.toContain("create_operational_document_version");
    expect(sql029).toContain("create_document_revision");
  });

  it("is SECURITY DEFINER with explicit search_path and authenticated-only execute", () => {
    expect(sql078).toMatch(/security definer/i);
    expect(sql078).toMatch(/set search_path = public/);
    expect(sql078).toMatch(/revoke all on function public\.create_operational_document_version[\s\S]*from public, anon, authenticated, service_role/);
    expect(sql078).toMatch(/grant execute on function public\.create_operational_document_version[\s\S]*to authenticated;/);
    expect(sql078).toMatch(/revoke all on function public\.next_operational_revision_code\(text\)\s+from public, anon, authenticated, service_role/);
    expect(sql078).not.toMatch(/grant execute on function public\.next_operational_revision_code/);
  });

  it("does not add a document_versions UPDATE policy", () => {
    expect(sql078).not.toMatch(/create policy[\s\S]*document_versions/i);
    expect(sql078).not.toMatch(/on public\.document_versions/i);
  });

  it("authorizes with document.upload, membership, FOR UPDATE, and stale expected revision", () => {
    expect(sql078).toContain("auth.uid() is null");
    expect(sql078).toContain("UNAUTHORIZED");
    expect(sql078).toContain("is_organization_member");
    expect(sql078).toContain("has_permission('document.upload'");
    expect(sql078).toContain("for update");
    expect(sql078).toContain("STALE_REVISION");
    expect(sql078).toContain("is_register_controlled");
    expect(sql078).toContain("REGISTER_CONTROLLED");
  });

  it("does not grant approval, workflow, or register revise powers", () => {
    expect(sql078).not.toContain("document.approve");
    expect(sql078).not.toContain("workflow.advance");
    expect(sql078).not.toContain("workflow.manage");
    expect(sql078).not.toContain("document_control.revise");
    expect(sql078).not.toContain("complete_workflow");
    expect(sql078).not.toContain("apply_workflow_step_outcome");
  });

  it("supersedes current, inserts next letter, keeps status submitted, audits document.revised", () => {
    expect(sql078).toContain("is_current = false");
    expect(sql078).toContain("is_superseded = true");
    expect(sql078).toContain("next_operational_revision_code");
    expect(sql078).toContain("status = 'submitted'");
    expect(sql078).not.toContain("official_decision");
    expect(sql078).not.toContain("approval_state");
    expect(sql078).not.toContain("workflow_instance");
    expect(sql078).toContain(`'${OPERATIONAL_REVISION_AUDIT}'`);
    expect(sql078).toContain("unique_violation");
  });

  it("rejects storage paths that reuse the current object or skip the next revision folder", () => {
    expect(sql078).toContain("p_file_path is not distinct from v_current.file_path");
    expect(sql078).toContain("'/' || v_next");
  });
});

describe("operational letter sequence and storage paths", () => {
  it("A → B → C and rejects register R01 and Z overflow", () => {
    expect(nextOperationalRevision("A")).toBe("B");
    expect(nextOperationalRevision("B")).toBe("C");
    expect(nextOperationalRevision("R00")).toBeNull();
    expect(nextOperationalRevision("R01")).toBeNull();
    expect(nextOperationalRevision("Z")).toBeNull();
  });

  it("builds a distinct B path and storage upload uses upsert false", () => {
    const b = operationalStorageObjectPath({
      organizationId: ORG,
      projectId: PROJECT,
      documentId: DOC,
      revision: "B",
      safeFileName: "revB.docx",
    });
    expect(b).not.toBe(PATH_A);
    expect(b).toContain(`/${DOC}/B/`);
    expect(operationalStoragePathPrefix({ organizationId: ORG, projectId: PROJECT, documentId: DOC, revision: "A" })).not.toBe(
      operationalStoragePathPrefix({ organizationId: ORG, projectId: PROJECT, documentId: DOC, revision: "B" }),
    );
    expect(storageSrc).toMatch(/upsert:\s*false/);
    expect(storageSrc).toContain("operationalStorageObjectPath");
  });
});

describe("applyOperationalRevision A→B", () => {
  it("1-8. A preserved, B sole current, header B, no duplicate document, distinct path, audit name", () => {
    const result = applyOperationalRevision({
      actor: actor(),
      document: document(),
      versions: [versionA()],
      expectedCurrentRevision: "A",
      newVersionId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      file: {
        fileSource: "storage",
        filePath: PATH_B,
        fileName: "02_Project_Charter_and_Scope_revB.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 10,
        checksum: "abc",
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.id).toBe(DOC);
    expect(result.document.currentRevision).toBe("B");
    expect(result.document.status).toBe("submitted");
    expect(result.document.approvalState).toBe("pending");
    expect(result.document.officialDecision).toBeNull();
    expect(result.document.workflowInstanceId).toBeNull();
    expect(result.document.approvalRequestId).toBeNull();
    expect(result.versions).toHaveLength(2);
    const a = result.versions.find((row) => row.revision === "A");
    const b = result.versions.find((row) => row.revision === "B");
    expect(a?.isCurrent).toBe(false);
    expect(a?.isSuperseded).toBe(true);
    expect(a?.filePath).toBe(PATH_A);
    expect(b?.isCurrent).toBe(true);
    expect(b?.filePath).toBe(PATH_B);
    expect(result.versions.filter((row) => row.isCurrent)).toHaveLength(1);
    expect(OPERATIONAL_REVISION_AUDIT).toBe("document.revised");
  });

  it("9. unauthorized / missing upload denied", () => {
    expect(
      authorizeOperationalRevision({
        actor: actor({ userId: null }),
        document: document(),
        currentVersion: versionA(),
        expectedCurrentRevision: "A",
      }),
    ).toBe("UNAUTHORIZED");
    expect(
      authorizeOperationalRevision({
        actor: actor({ hasDocumentUpload: false, hasDocumentApprove: true, hasWorkflowAdvance: true }),
        document: document(),
        currentVersion: versionA(),
        expectedCurrentRevision: "A",
      }),
    ).toBe("FORBIDDEN");
  });

  it("10-11. cross-tenant and inactive membership denied", () => {
    expect(
      authorizeOperationalRevision({
        actor: actor({ organizationId: ORG_B }),
        document: document(),
        currentVersion: versionA(),
        expectedCurrentRevision: "A",
      }),
    ).toBe("FORBIDDEN");
    expect(
      authorizeOperationalRevision({
        actor: actor({ membershipActive: false }),
        document: document(),
        currentVersion: versionA(),
        expectedCurrentRevision: "A",
      }),
    ).toBe("FORBIDDEN");
  });

  it("12. register-controlled denied", () => {
    expect(
      authorizeOperationalRevision({
        actor: actor(),
        document: document({ isRegisterControlled: true }),
        currentVersion: versionA(),
        expectedCurrentRevision: "A",
      }),
    ).toBe("REGISTER_CONTROLLED");
  });

  it("13-14. stale expected revision and concurrent second B denied; A remains", () => {
    const first = applyOperationalRevision({
      actor: actor(),
      document: document(),
      versions: [versionA()],
      expectedCurrentRevision: "A",
      newVersionId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      file: {
        fileSource: "storage",
        filePath: PATH_B,
        fileName: "b.docx",
        mimeType: "application/pdf",
        sizeBytes: 1,
        checksum: null,
      },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyOperationalRevision({
      actor: actor(),
      document: first.document,
      versions: first.versions,
      expectedCurrentRevision: "A",
      newVersionId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      file: {
        fileSource: "storage",
        filePath: PATH_B.replace("revB", "conflict"),
        fileName: "c.docx",
        mimeType: "application/pdf",
        sizeBytes: 1,
        checksum: null,
      },
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.denial).toBe("STALE_REVISION");
    expect(first.versions.find((row) => row.revision === "A")?.filePath).toBe(PATH_A);
  });

  it("15-17. historical A not deleted; workflow and approval fields untouched", () => {
    const result = applyOperationalRevision({
      actor: actor(),
      document: document({
        workflowInstanceId: "8c13015c-1111-4111-8111-111111111111",
        approvalRequestId: null,
        approvalState: "pending",
      }),
      versions: [versionA()],
      expectedCurrentRevision: "A",
      newVersionId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      file: {
        fileSource: "storage",
        filePath: PATH_B,
        fileName: "b.docx",
        mimeType: "application/pdf",
        sizeBytes: 1,
        checksum: null,
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.versions.some((row) => row.id === VER_A)).toBe(true);
    expect(result.document.workflowInstanceId).toBe("8c13015c-1111-4111-8111-111111111111");
    expect(result.document.approvalState).toBe("pending");
    expect(result.document.officialDecision).toBeNull();
  });
});

describe("use-case and UI wiring", () => {
  it("18. current signed-open still queries is_current when versionId omitted", () => {
    expect(platformSrc).toContain("openStorageDocumentAction");
    expect(platformSrc).toContain('eq("is_current", true)');
    expect(platformSrc).toContain("signedUrl");
    expect(platformSrc).toContain('eq("id", versionId)');
    expect(platformSrc).toContain('eq("document_id", documentId)');
  });

  it("19. historical open binds versionId + documentId", () => {
    expect(openSrc).toContain("versionId");
    expect(openSrc).toContain('name="versionId"');
    expect(pageSrc).toContain("versionId={v.id}");
  });

  it("20-21. UI posts existing documentId and does not insert a documents row", () => {
    expect(formSrc).toContain('name="documentId"');
    expect(formSrc).toContain("uploadDocumentAction");
    expect(formSrc).toContain("إضافة إصدار جديد");
    expect(formSrc).not.toContain("إضافة مستند");
    expect(pageSrc).toContain("authorizedDriveFileId");
    expect(pageSrc).toContain("OperationalDocumentRevisionForm");
    expect(pageSrc).toContain("DocumentAiAnalysisPanel");
    expect(pageSrc).toContain("التحليل بالذكاء الاصطناعي");
    expect(pageSrc).toContain("DocumentOpenControl");
    expect(canOfferOperationalRevision({ hasDocumentUpload: true, isArchived: false, isRegisterControlled: false })).toBe(
      true,
    );
    expect(canOfferOperationalRevision({ hasDocumentUpload: false, isArchived: false, isRegisterControlled: false })).toBe(
      false,
    );
  });

  it("revision path uses the operational RPC, not create_document_revision or versions UPDATE", () => {
    expect(platformSrc).toContain("OPERATIONAL_REVISION_RPC");
    expect(platformSrc).not.toContain("create_document_revision");
    expect(platformSrc).not.toMatch(/from\("document_versions"\)\s*\.update/);
    expect(OPERATIONAL_ORPHAN_CLEANUP).toBe("log_only");
    expect(platformSrc).toContain("operational document version orphan storage object");
  });

  it("maps stale RPC to conflict", () => {
    expect(mapOperationalRevisionRpcError("STALE_REVISION").kind).toBe("CONFLICT");
    expect(mapOperationalRevisionRpcError("REGISTER_CONTROLLED").kind).toBe("VALIDATION");
    expect(mapOperationalRevisionRpcError("FORBIDDEN").kind).toBe("FORBIDDEN");
  });
});

describe("078 file integrity", () => {
  it("migration is forward-only numbered 078", () => {
    const hash = createHash("sha256").update(sql078).digest("hex");
    expect(hash).toHaveLength(64);
    expect(sql078.startsWith("-- Master Touch OS — 078")).toBe(true);
  });
});
