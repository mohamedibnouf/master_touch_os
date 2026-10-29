import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/087_security_hardening.sql", "utf8");

function policyBody(name: string): string {
  const start = sql.indexOf(`create policy ${name} `);
  expect(start, `policy ${name} missing`).toBeGreaterThanOrEqual(0);
  return sql.slice(start, sql.indexOf(";", start));
}

describe("087 security hardening migration", () => {
  it("is idempotent: every policy is dropped before it is created", () => {
    const created = [...sql.matchAll(/create policy (\w+) on ([\w.]+)/g)];
    expect(created.length).toBeGreaterThan(0);
    for (const [, name, table] of created) {
      expect(sql).toContain(`drop policy if exists ${name} on ${table};`);
    }
    expect(sql).not.toMatch(/create function /);
    expect(sql).not.toMatch(/create index (?!if not exists)/);
    expect(sql).toContain("drop trigger if exists profiles_protect_sensitive on public.profiles;");
  });

  it("binds the HR document policies to the outer table (no self-comparison)", () => {
    const docs = policyBody("documents_select_hr");
    expect(docs).toContain("ed.document_id = documents.id");
    expect(docs).not.toMatch(/ed\.document_id = id\b/);
    const versions = policyBody("document_versions_select_hr");
    expect(versions).toContain("ed.document_id = document_versions.document_id");
    expect(versions).not.toMatch(/ed\.document_id = document_id\b/);
  });

  it("removes HR documents and the hr/ storage prefix from the generic document.read policies", () => {
    expect(policyBody("documents_select")).toContain("not public.is_hr_employee_document(documents.id)");
    expect(policyBody("document_versions_select")).toContain(
      "not public.is_hr_employee_document(document_versions.document_id)",
    );
    expect(policyBody("documents_storage_select")).toContain("coalesce((storage.foldername(name))[2], '') <> 'hr'");
    expect(policyBody("documents_storage_update")).toContain("coalesce((storage.foldername(name))[2], '') <> 'hr'");
    const hrStorage = policyBody("documents_storage_select_hr");
    expect(hrStorage).toContain("(storage.foldername(name))[2] = 'hr'");
    expect(hrStorage).toContain("public.can_access_hr_storage_object(name)");
    expect(sql).toContain("public.can_access_employee_document_row(");
  });

  it("blocks self-service changes to is_active on profiles", () => {
    expect(sql).toContain("create or replace function public.protect_sensitive_profile_fields()");
    expect(sql).toContain("old.is_active is distinct from new.is_active");
    expect(sql).toContain("and not public.security_trusted_session()");
    expect(sql).toContain("revoke all on function public.security_trusted_session() from public, anon, authenticated;");
  });

  it("adds tenant checks to compute_project_health and employee_has_approved_leave_on", () => {
    expect(sql).toContain(
      "if not public.security_trusted_session() and not public.can_access_project(p_project_id) then",
    );
    expect(sql).toContain("public.is_organization_member(e.organization_id)");
    expect(sql).toContain("revoke all on function public.compute_project_health(uuid) from public, anon;");
    expect(sql).toContain("revoke all on function public.employee_has_approved_leave_on(uuid, date) from public, anon;");
    expect(sql).not.toMatch(/grant execute on function [^;]* to [^;]*\banon\b/);
  });
});
