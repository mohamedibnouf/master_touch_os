import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: vi.fn() }));

import { updateEmployeeProfileFields } from "./account-access";

type Result = { data: unknown; error: unknown };

/** Minimal chainable PostgREST stub: records filters/updates, resolves per table. */
function fakeAdmin(results: { employee: Result; profile: Result; update: Result }) {
  const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
  const from = (table: string) => {
    let mode: "select" | "update" = "select";
    const builder: Record<string, unknown> = {};
    const record = (op: string) => (...args: unknown[]) => {
      calls.push({ table, op, args });
      if (op === "update") mode = "update";
      return builder;
    };
    for (const op of ["select", "eq", "update"]) builder[op] = record(op);
    builder.maybeSingle = async () => (table === "employees" ? results.employee : results.profile);
    builder.then = (resolve: (value: Result) => unknown) =>
      Promise.resolve(mode === "update" ? results.update : { data: null, error: null }).then(resolve);
    return builder;
  };
  return { client: { from } as never, calls };
}

const input = {
  organizationId: "org-1",
  employeeId: "emp-1",
  profileId: "prof-1",
  actorIsPlatformAdmin: false,
  patch: { full_name_ar: "اسم", full_name_en: "Name", phone: "+966500000000" },
};

describe("updateEmployeeProfileFields", () => {
  it("scopes to the org's employee and writes only names/phone", async () => {
    const { client, calls } = fakeAdmin({
      employee: { data: { id: "emp-1" }, error: null },
      profile: { data: { is_platform_admin: false }, error: null },
      update: { data: [{ id: "prof-1" }], error: null },
    });
    await updateEmployeeProfileFields(client, input);
    const employeeFilters = calls.filter((c) => c.table === "employees" && c.op === "eq").map((c) => c.args);
    expect(employeeFilters).toEqual([
      ["id", "emp-1"],
      ["organization_id", "org-1"],
      ["profile_id", "prof-1"],
    ]);
    const update = calls.find((c) => c.op === "update");
    expect(update?.args[0]).toEqual(input.patch);
    expect(Object.keys(update?.args[0] as object)).not.toContain("is_active");
  });

  it("fails loudly when no row is updated", async () => {
    const { client } = fakeAdmin({
      employee: { data: { id: "emp-1" }, error: null },
      profile: { data: { is_platform_admin: false }, error: null },
      update: { data: [], error: null },
    });
    await expect(updateEmployeeProfileFields(client, input)).rejects.toThrow();
  });

  it("refuses employees outside the caller's org and platform-admin profiles", async () => {
    const outside = fakeAdmin({
      employee: { data: null, error: null },
      profile: { data: { is_platform_admin: false }, error: null },
      update: { data: [{ id: "prof-1" }], error: null },
    });
    await expect(updateEmployeeProfileFields(outside.client, input)).rejects.toThrow();
    expect(outside.calls.some((c) => c.op === "update")).toBe(false);

    const admin = fakeAdmin({
      employee: { data: { id: "emp-1" }, error: null },
      profile: { data: { is_platform_admin: true }, error: null },
      update: { data: [{ id: "prof-1" }], error: null },
    });
    await expect(updateEmployeeProfileFields(admin.client, input)).rejects.toThrow();
    expect(admin.calls.some((c) => c.op === "update")).toBe(false);
  });
});
