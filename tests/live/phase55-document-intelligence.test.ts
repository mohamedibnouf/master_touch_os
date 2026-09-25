/**
 * Phase 5.5 — Document Intelligence live RLS / tenant / revision / verification tests.
 * Skips until migration 061 is applied (intentionally not applied in this hardening pass).
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  adminClient,
  liveTestConfigured,
  provisionLiveFixture,
  signInAs,
  type LiveFixture,
} from "./helpers";

const configured = liveTestConfigured();

const EMPTY_PAYLOAD = {
  summary: "test",
  objectives: [],
  deliverables: [],
  milestones: [],
  deadlines: [],
  budgetFacts: [],
  stakeholders: [],
  assumptions: [],
  dependencies: [],
  explicitRisks: [],
  requiredApprovals: [],
  actionItems: [],
  ambiguities: [],
};

describe.skipIf(!configured)("live Phase 5.5 document_intelligence", () => {
  let fx: LiveFixture;
  let tableReady = false;
  let updater: { id: string; email: string; password: string } | null = null;

  const seeded: { documentIds: string[]; storagePaths: string[] } = {
    documentIds: [],
    storagePaths: [],
  };

  beforeAll(async () => {
    const admin = adminClient();
    const { error } = await admin.from("document_intelligence").select("id").limit(1);
    tableReady = !error;
    if (!tableReady) {
      console.warn(
        "[live-test] Phase 5.5 requires migration 061 (supabase/phase5_apply_061.sql). Skipping until applied.",
      );
      return;
    }
    fx = await provisionLiveFixture();

    const prefix = process.env.LIVE_TEST_PASSWORD_PREFIX ?? "MtTest1!";
    const email = `mt-live-pe-${fx.runId}@test.local`;
    const password = `${prefix}pe`;
    const { data: created, error: uErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name_ar: "project_engineer", full_name_en: "project_engineer", locale: "ar" },
    });
    if (uErr || !created.user) throw new Error(`create updater: ${uErr?.message}`);
    await admin.from("organization_members").upsert({
      organization_id: fx.orgAId,
      profile_id: created.user.id,
      status: "active",
    });
    const { data: role } = await admin
      .from("roles")
      .select("id")
      .eq("code", "project_engineer")
      .is("organization_id", null)
      .single();
    if (!role) throw new Error("project_engineer role missing");
    await admin.from("user_roles").insert({
      organization_id: fx.orgAId,
      profile_id: created.user.id,
      role_id: role.id,
      scope_type: "organization",
    });
    updater = { id: created.user.id, email, password };
  }, 180_000);

  afterAll(async () => {
    const admin = adminClient();
    if (tableReady) {
      for (const id of seeded.documentIds) {
        await admin.from("document_intelligence").delete().eq("document_id", id);
        await admin.from("document_versions").delete().eq("document_id", id);
        await admin.from("documents").delete().eq("id", id);
      }
      if (seeded.storagePaths.length) {
        await admin.storage.from("documents").remove(seeded.storagePaths);
      }
    }
    if (updater) {
      try {
        await admin.auth.admin.deleteUser(updater.id);
      } catch {
        /* best-effort */
      }
    }
    if (fx) await fx.cleanup();
  }, 180_000);

  async function seedDocument(input: {
    orgId: string;
    projectId: string | null;
    revision?: string;
    uploadedBy: string;
  }) {
    const admin = adminClient();
    const revision = input.revision ?? "A";
    const { data: doc, error: docErr } = await admin
      .from("documents")
      .insert({
        organization_id: input.orgId,
        project_id: input.projectId,
        category: "business_case",
        title: `Live DI ${crypto.randomUUID().slice(0, 8)}`,
        current_revision: revision,
        status: "submitted",
        confidentiality: "internal",
        uploaded_by: input.uploadedBy,
      })
      .select("id")
      .single();
    if (docErr || !doc) throw new Error(`seed doc: ${docErr?.message}`);
    seeded.documentIds.push(doc.id);

    const body = Buffer.from(
      "Business Case Objectives: build campus. Deliverable: drawings. Deadline 2026-10-01.",
      "utf8",
    );
    const path = `${input.orgId}/${input.projectId ?? "org"}/${doc.id}/${revision}/bc.txt`;
    await admin.storage.from("documents").upload(path, body, {
      contentType: "text/plain",
      upsert: true,
    });
    seeded.storagePaths.push(path);

    const { data: version, error: vErr } = await admin
      .from("document_versions")
      .insert({
        organization_id: input.orgId,
        document_id: doc.id,
        revision,
        file_path: path,
        file_name: "bc.txt",
        mime_type: "text/plain",
        size_bytes: body.length,
        uploaded_by: input.uploadedBy,
        is_current: true,
      })
      .select("id")
      .single();
    if (vErr || !version) throw new Error(`seed version: ${vErr?.message}`);
    return { docId: doc.id as string, versionId: version.id as string, path };
  }

  it("A. valid same-org document/version insert succeeds", async ({ skip }) => {
    if (!tableReady) {
      skip("Apply supabase/phase5_apply_061.sql (migration 061)");
      return;
    }
    const seededDoc = await seedDocument({
      orgId: fx.orgAId,
      projectId: fx.projectId,
      uploadedBy: fx.users.pm.id,
    });
    const pm = await signInAs(fx.users.pm.email, fx.users.pm.password);
    const { data, error } = await pm
      .from("document_intelligence")
      .insert({
        organization_id: fx.orgAId,
        document_id: seededDoc.docId,
        document_version_id: seededDoc.versionId,
        status: "PROCESSING",
        provider: "mock",
        created_by: fx.users.pm.id,
        extraction_payload: EMPTY_PAYLOAD,
      })
      .select("id, created_by, status")
      .single();
    expect(error).toBeNull();
    expect(data?.status).toBe("PROCESSING");
    expect(data?.created_by).toBe(fx.users.pm.id);
  });

  it("B. cross-org organization/document combination fails", async ({ skip }) => {
    if (!tableReady) {
      skip("Apply supabase/phase5_apply_061.sql (migration 061)");
      return;
    }
    const orgB = await seedDocument({
      orgId: fx.orgBId,
      projectId: fx.orgBProjectId,
      uploadedBy: fx.users.admin.id,
    });
    const admin = adminClient();
    const { error } = await admin.from("document_intelligence").insert({
      organization_id: fx.orgAId,
      document_id: orgB.docId,
      document_version_id: orgB.versionId,
      status: "PROCESSING",
      provider: "mock",
      created_by: fx.users.pm.id,
    });
    expect(error).toBeTruthy();
  });

  it("C. document/version mismatch fails", async ({ skip }) => {
    if (!tableReady) {
      skip("Apply supabase/phase5_apply_061.sql (migration 061)");
      return;
    }
    const a = await seedDocument({
      orgId: fx.orgAId,
      projectId: fx.projectId,
      uploadedBy: fx.users.pm.id,
    });
    const b = await seedDocument({
      orgId: fx.orgAId,
      projectId: fx.projectId,
      uploadedBy: fx.users.pm.id,
    });
    const admin = adminClient();
    const { error } = await admin.from("document_intelligence").insert({
      organization_id: fx.orgAId,
      document_id: a.docId,
      document_version_id: b.versionId,
      status: "PROCESSING",
      provider: "mock",
      created_by: fx.users.pm.id,
    });
    expect(error).toBeTruthy();
  });

  it("D. unauthorized project/document user cannot read intelligence", async ({ skip }) => {
    if (!tableReady) {
      skip("Apply supabase/phase5_apply_061.sql (migration 061)");
      return;
    }
    const seededDoc = await seedDocument({
      orgId: fx.orgAId,
      projectId: fx.projectId,
      uploadedBy: fx.users.pm.id,
    });
    const admin = adminClient();
    const { data: intel } = await admin
      .from("document_intelligence")
      .insert({
        organization_id: fx.orgAId,
        document_id: seededDoc.docId,
        document_version_id: seededDoc.versionId,
        status: "PROCESSING",
        provider: "mock",
        created_by: fx.users.pm.id,
      })
      .select("id")
      .single();
    const restricted = await signInAs(fx.users.restricted.email, fx.users.restricted.password);
    const { data } = await restricted
      .from("document_intelligence")
      .select("id")
      .eq("id", intel!.id)
      .maybeSingle();
    expect(data).toBeNull();
  });

  it("E. unauthorized user cannot create intelligence", async ({ skip }) => {
    if (!tableReady) {
      skip("Apply supabase/phase5_apply_061.sql (migration 061)");
      return;
    }
    const seededDoc = await seedDocument({
      orgId: fx.orgAId,
      projectId: fx.projectId,
      uploadedBy: fx.users.pm.id,
    });
    const restricted = await signInAs(fx.users.restricted.email, fx.users.restricted.password);
    const { error } = await restricted.from("document_intelligence").insert({
      organization_id: fx.orgAId,
      document_id: seededDoc.docId,
      document_version_id: seededDoc.versionId,
      status: "PROCESSING",
      provider: "mock",
      created_by: fx.users.restricted.id,
    });
    expect(error).toBeTruthy();
  });

  it("F. document.update-only user cannot forge VERIFIED", async ({ skip }) => {
    if (!tableReady) {
      skip("Apply supabase/phase5_apply_061.sql (migration 061)");
      return;
    }
    if (!updater) throw new Error("updater missing");
    const seededDoc = await seedDocument({
      orgId: fx.orgAId,
      projectId: fx.projectId,
      uploadedBy: fx.users.pm.id,
    });
    const admin = adminClient();
    await admin.from("project_members").insert({
      organization_id: fx.orgAId,
      project_id: fx.projectId,
      profile_id: updater.id,
      role_label: "engineer",
      is_active: true,
    });
    const { data: intel } = await admin
      .from("document_intelligence")
      .insert({
        organization_id: fx.orgAId,
        document_id: seededDoc.docId,
        document_version_id: seededDoc.versionId,
        status: "PROCESSING",
        provider: "mock",
        created_by: fx.users.pm.id,
      })
      .select("id")
      .single();
    await admin
      .from("document_intelligence")
      .update({
        status: "EXTRACTED",
        extraction_payload: EMPTY_PAYLOAD,
        provider: "mock",
      })
      .eq("id", intel!.id);

    const pe = await signInAs(updater.email, updater.password);
    const { data: forged } = await pe
      .from("document_intelligence")
      .update({ status: "VERIFIED", verified_by: updater.id })
      .eq("id", intel!.id)
      .select("id")
      .maybeSingle();
    expect(forged).toBeNull();

    const { error: rpcErr } = await pe.rpc("verify_document_intelligence", {
      p_intelligence_id: intel!.id,
    });
    expect(rpcErr).toBeTruthy();
  });

  it("G-I. verifier EXTRACTED → VERIFIED; verified_by/at are authentic", async ({ skip }) => {
    if (!tableReady) {
      skip("Apply supabase/phase5_apply_061.sql (migration 061)");
      return;
    }
    const seededDoc = await seedDocument({
      orgId: fx.orgAId,
      projectId: fx.projectId,
      uploadedBy: fx.users.pm.id,
    });
    const admin = adminClient();
    const { data: intel } = await admin
      .from("document_intelligence")
      .insert({
        organization_id: fx.orgAId,
        document_id: seededDoc.docId,
        document_version_id: seededDoc.versionId,
        status: "PROCESSING",
        provider: "mock",
        created_by: fx.users.pm.id,
      })
      .select("id")
      .single();
    await admin
      .from("document_intelligence")
      .update({
        status: "EXTRACTED",
        extraction_payload: EMPTY_PAYLOAD,
        provider: "mock",
      })
      .eq("id", intel!.id);

    const before = Date.now();
    const pm = await signInAs(fx.users.pm.email, fx.users.pm.password);
    const { data, error } = await pm.rpc("verify_document_intelligence", {
      p_intelligence_id: intel!.id,
    });
    expect(error).toBeNull();
    const row = (Array.isArray(data) ? data[0] : data) as {
      status: string;
      verified_by: string;
      verified_at: string;
    };
    expect(row.status).toBe("VERIFIED");
    expect(row.verified_by).toBe(fx.users.pm.id);
    const at = new Date(row.verified_at).getTime();
    expect(at).toBeGreaterThanOrEqual(before - 2000);
    expect(at).toBeLessThanOrEqual(Date.now() + 2000);
  });

  it("J. PENDING → VERIFIED direct transition fails", async ({ skip }) => {
    if (!tableReady) {
      skip("Apply supabase/phase5_apply_061.sql (migration 061)");
      return;
    }
    const seededDoc = await seedDocument({
      orgId: fx.orgAId,
      projectId: fx.projectId,
      uploadedBy: fx.users.pm.id,
    });
    const admin = adminClient();
    const { data: intel } = await admin
      .from("document_intelligence")
      .insert({
        organization_id: fx.orgAId,
        document_id: seededDoc.docId,
        document_version_id: seededDoc.versionId,
        status: "PENDING",
        created_by: fx.users.pm.id,
      })
      .select("id")
      .single();
    const pm = await signInAs(fx.users.pm.email, fx.users.pm.password);
    const { data } = await pm
      .from("document_intelligence")
      .update({ status: "VERIFIED" })
      .eq("id", intel!.id)
      .select("id")
      .maybeSingle();
    expect(data).toBeNull();
    const { error: rpcErr } = await pm.rpc("verify_document_intelligence", {
      p_intelligence_id: intel!.id,
    });
    expect(rpcErr).toBeTruthy();
  });

  it("K. FAILED → VERIFIED fails", async ({ skip }) => {
    if (!tableReady) {
      skip("Apply supabase/phase5_apply_061.sql (migration 061)");
      return;
    }
    const seededDoc = await seedDocument({
      orgId: fx.orgAId,
      projectId: fx.projectId,
      uploadedBy: fx.users.pm.id,
    });
    const admin = adminClient();
    const { data: intel } = await admin
      .from("document_intelligence")
      .insert({
        organization_id: fx.orgAId,
        document_id: seededDoc.docId,
        document_version_id: seededDoc.versionId,
        status: "PROCESSING",
        created_by: fx.users.pm.id,
      })
      .select("id")
      .single();
    await admin
      .from("document_intelligence")
      .update({ status: "FAILED", error_message: "parser" })
      .eq("id", intel!.id);
    const pm = await signInAs(fx.users.pm.email, fx.users.pm.password);
    const { data } = await pm
      .from("document_intelligence")
      .update({ status: "VERIFIED" })
      .eq("id", intel!.id)
      .select("id")
      .maybeSingle();
    expect(data).toBeNull();
    const { error: rpcErr } = await pm.rpc("verify_document_intelligence", {
      p_intelligence_id: intel!.id,
    });
    expect(rpcErr).toBeTruthy();
  });

  it("L-M. VERIFIED payload and identity fields are immutable", async ({ skip }) => {
    if (!tableReady) {
      skip("Apply supabase/phase5_apply_061.sql (migration 061)");
      return;
    }
    const seededDoc = await seedDocument({
      orgId: fx.orgAId,
      projectId: fx.projectId,
      uploadedBy: fx.users.pm.id,
    });
    const admin = adminClient();
    const { data: intel } = await admin
      .from("document_intelligence")
      .insert({
        organization_id: fx.orgAId,
        document_id: seededDoc.docId,
        document_version_id: seededDoc.versionId,
        status: "PROCESSING",
        created_by: fx.users.pm.id,
      })
      .select("id")
      .single();
    await admin
      .from("document_intelligence")
      .update({ status: "EXTRACTED", extraction_payload: EMPTY_PAYLOAD, provider: "mock" })
      .eq("id", intel!.id);
    const pm = await signInAs(fx.users.pm.email, fx.users.pm.password);
    const { error: vErr } = await pm.rpc("verify_document_intelligence", {
      p_intelligence_id: intel!.id,
    });
    expect(vErr).toBeNull();

    const { data: payloadMut } = await pm
      .from("document_intelligence")
      .update({ extraction_payload: { summary: "tamper" } })
      .eq("id", intel!.id)
      .select("id")
      .maybeSingle();
    expect(payloadMut).toBeNull();

    const { error: identityErr } = await admin
      .from("document_intelligence")
      .update({ organization_id: fx.orgBId })
      .eq("id", intel!.id);
    expect(identityErr).toBeTruthy();
  });

  it("N. cross-org update fails", async ({ skip }) => {
    if (!tableReady) {
      skip("Apply supabase/phase5_apply_061.sql (migration 061)");
      return;
    }
    const orgB = await seedDocument({
      orgId: fx.orgBId,
      projectId: fx.orgBProjectId,
      uploadedBy: fx.users.admin.id,
    });
    const admin = adminClient();
    const { data: intel } = await admin
      .from("document_intelligence")
      .insert({
        organization_id: fx.orgBId,
        document_id: orgB.docId,
        document_version_id: orgB.versionId,
        status: "PROCESSING",
        created_by: fx.users.admin.id,
      })
      .select("id")
      .single();
    const pm = await signInAs(fx.users.pm.email, fx.users.pm.password);
    const { data } = await pm
      .from("document_intelligence")
      .update({ status: "FAILED", error_message: "x" })
      .eq("id", intel!.id)
      .select("id")
      .maybeSingle();
    expect(data).toBeNull();
  });

  it("O. direct delete by authenticated user fails", async ({ skip }) => {
    if (!tableReady) {
      skip("Apply supabase/phase5_apply_061.sql (migration 061)");
      return;
    }
    const seededDoc = await seedDocument({
      orgId: fx.orgAId,
      projectId: fx.projectId,
      uploadedBy: fx.users.pm.id,
    });
    const admin = adminClient();
    const { data: intel } = await admin
      .from("document_intelligence")
      .insert({
        organization_id: fx.orgAId,
        document_id: seededDoc.docId,
        document_version_id: seededDoc.versionId,
        status: "PROCESSING",
        created_by: fx.users.pm.id,
      })
      .select("id")
      .single();
    const pm = await signInAs(fx.users.pm.email, fx.users.pm.password);
    const { data, error } = await pm
      .from("document_intelligence")
      .delete()
      .eq("id", intel!.id)
      .select("id");
    expect((data ?? []).length).toBe(0);
    void error;
    const { data: still } = await admin
      .from("document_intelligence")
      .select("id")
      .eq("id", intel!.id)
      .maybeSingle();
    expect(still?.id).toBe(intel!.id);
  });

  it("P-Q. FAILED retry allowed; concurrent active uniqueness preserved", async ({ skip }) => {
    if (!tableReady) {
      skip("Apply supabase/phase5_apply_061.sql (migration 061)");
      return;
    }
    const seededDoc = await seedDocument({
      orgId: fx.orgAId,
      projectId: fx.projectId,
      uploadedBy: fx.users.pm.id,
    });
    const admin = adminClient();
    const { data: failed } = await admin
      .from("document_intelligence")
      .insert({
        organization_id: fx.orgAId,
        document_id: seededDoc.docId,
        document_version_id: seededDoc.versionId,
        status: "PROCESSING",
        created_by: fx.users.pm.id,
      })
      .select("id")
      .single();
    await admin
      .from("document_intelligence")
      .update({ status: "FAILED", error_message: "retry-me" })
      .eq("id", failed!.id);

    const { data: retry, error: retryErr } = await admin
      .from("document_intelligence")
      .insert({
        organization_id: fx.orgAId,
        document_id: seededDoc.docId,
        document_version_id: seededDoc.versionId,
        status: "PROCESSING",
        created_by: fx.users.pm.id,
      })
      .select("id")
      .single();
    expect(retryErr).toBeNull();
    expect(retry?.id).toBeTruthy();

    const { error: dup } = await admin.from("document_intelligence").insert({
      organization_id: fx.orgAId,
      document_id: seededDoc.docId,
      document_version_id: seededDoc.versionId,
      status: "PROCESSING",
      created_by: fx.users.pm.id,
    });
    expect(dup).toBeTruthy();
  });

  it("R. new document revision does not reuse previous revision intelligence", async ({ skip }) => {
    if (!tableReady) {
      skip("Apply supabase/phase5_apply_061.sql (migration 061)");
      return;
    }
    const seededDoc = await seedDocument({
      orgId: fx.orgAId,
      projectId: fx.projectId,
      uploadedBy: fx.users.pm.id,
    });
    const admin = adminClient();
    const { data: intel } = await admin
      .from("document_intelligence")
      .insert({
        organization_id: fx.orgAId,
        document_id: seededDoc.docId,
        document_version_id: seededDoc.versionId,
        status: "PROCESSING",
        created_by: fx.users.pm.id,
      })
      .select("id")
      .single();
    await admin
      .from("document_intelligence")
      .update({ status: "EXTRACTED", extraction_payload: EMPTY_PAYLOAD, provider: "mock" })
      .eq("id", intel!.id);

    await admin
      .from("document_versions")
      .update({ is_current: false, is_superseded: true })
      .eq("id", seededDoc.versionId);

    const body = Buffer.from("Revision B business case text with objectives stated.", "utf8");
    const pathB = `${fx.orgAId}/${fx.projectId}/${seededDoc.docId}/B/bc.txt`;
    await admin.storage.from("documents").upload(pathB, body, { contentType: "text/plain", upsert: true });
    seeded.storagePaths.push(pathB);
    const { data: versionB } = await admin
      .from("document_versions")
      .insert({
        organization_id: fx.orgAId,
        document_id: seededDoc.docId,
        revision: "B",
        file_path: pathB,
        file_name: "bc.txt",
        mime_type: "text/plain",
        size_bytes: body.length,
        uploaded_by: fx.users.pm.id,
        is_current: true,
      })
      .select("id")
      .single();

    const { data: forB } = await admin
      .from("document_intelligence")
      .select("id")
      .eq("document_version_id", versionB!.id)
      .in("status", ["PENDING", "PROCESSING", "EXTRACTED", "VERIFIED"]);
    expect(forB ?? []).toHaveLength(0);

    const { data: stillA } = await admin
      .from("document_intelligence")
      .select("document_version_id")
      .eq("id", intel!.id)
      .single();
    expect(stillA?.document_version_id).toBe(seededDoc.versionId);
  });
});
