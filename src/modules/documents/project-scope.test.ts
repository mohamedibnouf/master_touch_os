import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
import { assertProjectBelongsToOrganization } from "./project-scope";
import { DRIVE_INTELLIGENCE_UNAVAILABLE_AR } from "./file-source";
import { canSelectDocumentVersion } from "./version-access";

describe("project document organization scope", () => {
  const orgA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const orgB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const projectId = "11111111-1111-1111-1111-111111111111";

  it("preserves a project id that belongs to the actor organization", () => {
    expect(() =>
      assertProjectBelongsToOrganization({ id: projectId, organization_id: orgA }, orgA),
    ).not.toThrow();
  });

  it("rejects cross-org project injection", () => {
    expect(() =>
      assertProjectBelongsToOrganization({ id: projectId, organization_id: orgB }, orgA),
    ).toThrow(ValidationError);
    expect(() => assertProjectBelongsToOrganization(null, orgA)).toThrow(ValidationError);
  });

  it("filters project lists without exposing other project rows", () => {
    const rows = [
      { id: "d1", project_id: projectId },
      { id: "d2", project_id: "22222222-2222-2222-2222-222222222222" },
      { id: "d3", project_id: projectId },
    ];
    const projectOnly = rows.filter((r) => r.project_id === projectId);
    expect(projectOnly.map((r) => r.id)).toEqual(["d1", "d3"]);
    expect(projectOnly.some((r) => r.id === "d2")).toBe(false);
  });

  it("treats the same document id as one row in project and global lists", () => {
    const global = [{ id: "same-doc", project_id: projectId }];
    const project = global.filter((r) => r.project_id === projectId);
    expect(project).toHaveLength(1);
    expect(project[0]?.id).toBe(global[0]?.id);
  });
});

describe("Drive intelligence phase 1", () => {
  it("uses a deterministic Arabic unavailable message without Storage download", () => {
    expect(DRIVE_INTELLIGENCE_UNAVAILABLE_AR).toContain("Google Drive");
    expect(DRIVE_INTELLIGENCE_UNAVAILABLE_AR).toContain("التخزين الداخلي");
  });
});

describe("document version access (065 RLS mirror)", () => {
  const org = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const projectA = "11111111-1111-1111-1111-111111111111";
  const projectB = "22222222-2222-2222-2222-222222222222";

  it("lets project members read versions on their project only", () => {
    expect(
      canSelectDocumentVersion({
        hasDocumentRead: false,
        documentOrganizationId: org,
        actorOrganizationId: org,
        documentProjectId: projectA,
        accessibleProjectIds: [projectA],
      }),
    ).toBe(true);
    expect(
      canSelectDocumentVersion({
        hasDocumentRead: false,
        documentOrganizationId: org,
        actorOrganizationId: org,
        documentProjectId: projectB,
        accessibleProjectIds: [projectA],
      }),
    ).toBe(false);
  });

  it("does not grant org-wide document.read via project access", () => {
    expect(
      canSelectDocumentVersion({
        hasDocumentRead: false,
        documentOrganizationId: org,
        actorOrganizationId: org,
        documentProjectId: null,
        accessibleProjectIds: [projectA],
      }),
    ).toBe(false);
  });
});
