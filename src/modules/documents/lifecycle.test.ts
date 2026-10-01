import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROLE_PERMISSION_MAP, type SystemRoleCode } from "@/lib/permissions/catalog";
import { evaluatePermission, type RoleGrant } from "@/lib/permissions/evaluate";
import {
  ARCHIVE_RESTRICTION_AR,
  LIFECYCLE_AUDIT,
  applyArchiveFields,
  applyRestoreFields,
  archivePairIsValid,
  archiveRestrictionFor,
  shouldIncludeInActiveDocumentList,
} from "./lifecycle";
import { notificationEntityHref } from "@/lib/notifications/href";
import { uploadDocumentSchema, isStorageFileRequired } from "./schemas";
import { isStorageIntelligenceEligible } from "./file-source";
import { parseGoogleDriveUrl } from "./google-drive-url";

const ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SAMPLE_ID = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";

function grant(role: SystemRoleCode, organizationId: string): RoleGrant {
  return {
    roleCode: role,
    isExternal: false,
    organizationId,
    scopeType: "organization",
    scopeId: null,
    permissions: ROLE_PERMISSION_MAP[role],
  };
}

describe("document.archive permission", () => {
  it("A. privileged operational roles can archive", () => {
    for (const role of ["super_admin", "general_manager", "operations_manager", "document_controller"] as const) {
      expect(evaluatePermission([grant(role, ORG_A)], "document.archive", { organizationId: ORG_A })).toBe(true);
    }
  });

  it("B. unauthorized roles cannot archive", () => {
    for (const role of ["engineer", "project_manager", "viewer", "hr_officer", "client", "consultant", "supplier", "subcontractor"] as const) {
      expect(evaluatePermission([grant(role, ORG_A)], "document.archive", { organizationId: ORG_A })).toBe(false);
    }
  });

  it("C/D. restore uses the same document.archive grant", () => {
    expect(evaluatePermission([grant("document_controller", ORG_A)], "document.archive", { organizationId: ORG_A })).toBe(
      true,
    );
    expect(evaluatePermission([grant("engineer", ORG_A)], "document.archive", { organizationId: ORG_A })).toBe(false);
  });

  it("E. cross-organization grants cannot archive another org", () => {
    expect(evaluatePermission([grant("document_controller", ORG_A)], "document.archive", { organizationId: ORG_B })).toBe(
      false,
    );
  });

  it("F. project-scoped access without document.archive cannot authorize lifecycle", () => {
    const projectGrant: RoleGrant = {
      roleCode: "project_manager",
      isExternal: false,
      organizationId: ORG_A,
      scopeType: "project",
      scopeId: "11111111-1111-1111-1111-111111111111",
      permissions: ROLE_PERMISSION_MAP.project_manager,
    };
    expect(
      evaluatePermission([projectGrant], "document.archive", {
        organizationId: ORG_A,
        projectId: "11111111-1111-1111-1111-111111111111",
      }),
    ).toBe(false);
  });
});

describe("archive restrictions and pair", () => {
  it("P–U. blocks controlled, engineering, transmittal, workflow, employee, business case", () => {
    expect(archiveRestrictionFor({
      is_register_controlled: true,
      approval_request_id: null,
      workflow_instance_id: null,
      hasEngineeringLink: false,
      hasTransmittalItem: false,
      isProjectBusinessCase: false,
      hasEmployeeDocumentLink: false,
    })).toBe("register");
    expect(ARCHIVE_RESTRICTION_AR.register).toContain("رسمي");
    expect(archiveRestrictionFor({
      is_register_controlled: false,
      approval_request_id: "x",
      workflow_instance_id: null,
      hasEngineeringLink: false,
      hasTransmittalItem: false,
      isProjectBusinessCase: false,
      hasEmployeeDocumentLink: false,
    })).toBe("workflow");
    expect(archiveRestrictionFor({
      is_register_controlled: false,
      approval_request_id: null,
      workflow_instance_id: null,
      hasEngineeringLink: true,
      hasTransmittalItem: false,
      isProjectBusinessCase: false,
      hasEmployeeDocumentLink: false,
    })).toBe("engineering");
    expect(archiveRestrictionFor({
      is_register_controlled: false,
      approval_request_id: null,
      workflow_instance_id: null,
      hasEngineeringLink: false,
      hasTransmittalItem: true,
      isProjectBusinessCase: false,
      hasEmployeeDocumentLink: false,
    })).toBe("transmittal");
    expect(archiveRestrictionFor({
      is_register_controlled: false,
      approval_request_id: null,
      workflow_instance_id: null,
      hasEngineeringLink: false,
      hasTransmittalItem: false,
      isProjectBusinessCase: true,
      hasEmployeeDocumentLink: false,
    })).toBe("businessCase");
    expect(archiveRestrictionFor({
      is_register_controlled: false,
      approval_request_id: null,
      workflow_instance_id: null,
      hasEngineeringLink: false,
      hasTransmittalItem: false,
      isProjectBusinessCase: false,
      hasEmployeeDocumentLink: true,
    })).toBe("employee");
  });

  it("I–L/V. archive/restore mutate only the archive pair and keep status caller-owned", () => {
    const archived = applyArchiveFields("profile-1", "2026-10-02T00:00:00.000Z");
    expect(archived).toEqual({ archived_at: "2026-10-02T00:00:00.000Z", archived_by: "profile-1" });
    expect(archived).not.toHaveProperty("status");
    expect(applyRestoreFields()).toEqual({ archived_at: null, archived_by: null });
    expect(archivePairIsValid(null, null)).toBe(true);
    expect(archivePairIsValid("t", "p")).toBe(true);
    expect(archivePairIsValid("t", null)).toBe(false);
  });

  it("M/N. active lists exclude archived", () => {
    expect(shouldIncludeInActiveDocumentList(null)).toBe(true);
    expect(shouldIncludeInActiveDocumentList("2026-01-01T00:00:00.000Z")).toBe(false);
  });
});

describe("audit, href, intelligence, picker regression", () => {
  it("uses document.archived / document.restored and keeps notification href", () => {
    expect(LIFECYCLE_AUDIT.archived).toBe("document.archived");
    expect(LIFECYCLE_AUDIT.restored).toBe("document.restored");
    expect(notificationEntityHref("document", "doc-1")).toBe("/documents/doc-1");
  });

  it("Y/Z. Drive create schema and Storage file requirement remain", () => {
    expect(
      uploadDocumentSchema.safeParse({
        title: "عقد",
        category: "contract",
        fileSource: "google_drive",
        driveUrl: `https://drive.google.com/file/d/${SAMPLE_ID}/view`,
      }).success,
    ).toBe(true);
    expect(isStorageFileRequired("storage")).toBe(true);
    expect(parseGoogleDriveUrl(`https://drive.google.com/file/d/${SAMPLE_ID}/view`)?.fileId).toBe(SAMPLE_ID);
    expect(isStorageIntelligenceEligible({ file_source: "storage", file_path: "a/b" })).toBe(true);
    expect(isStorageIntelligenceEligible({ file_source: "google_drive", file_path: null })).toBe(false);
  });
});

describe("migration 066 and no-delete guarantees", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/066_document_lifecycle.sql"), "utf8");
  const lifecycleTs = readFileSync(join(process.cwd(), "src/server/use-cases/document-lifecycle.ts"), "utf8");
  const storageTs = readFileSync(join(process.cwd(), "src/server/services/storage.service.ts"), "utf8");

  it("G. trigger requires document.archive to change lifecycle columns", () => {
    expect(sql).toContain("protect_document_archive_fields");
    expect(sql).toContain("has_permission('document.archive'");
    expect(sql).toContain("document_lifecycle_trusted_session");
    expect(sql).toContain("on delete restrict");
    expect(sql).not.toMatch(/auth\.uid\(\) is null or auth\.role\(\) = 'service_role'/);
    expect(sql).not.toMatch(/set\s+status\s*=\s*'archived'/i);
  });

  it("H. does not add DELETE policies on documents or document_versions", () => {
    expect(sql).not.toMatch(/create policy \w+_delete on public\.documents/i);
    expect(sql).not.toMatch(/create policy \w+_delete on public\.document_versions/i);
    expect(sql).not.toContain("for delete");
  });

  it("W. lifecycle use case does not call Google Drive delete/trash APIs", () => {
    expect(lifecycleTs).not.toMatch(/files\.delete|permissions\.delete|trash/i);
    expect(lifecycleTs).not.toContain("googleapis");
  });

  it("X. StorageService still has no object remove/delete", () => {
    expect(storageTs).not.toMatch(/\.remove\(|\.delete\(/);
    expect(lifecycleTs).not.toContain("storage.from");
  });

  it("seeds document.archive only to privileged roles", () => {
    expect(sql).toContain("super_admin");
    expect(sql).toContain("document_controller");
    expect(sql).not.toContain("project_manager");
    expect(sql).not.toContain("'engineer'");
  });
});
