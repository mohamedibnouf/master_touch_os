import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  approvalTitleColumns,
  isMissingTitleEnColumnError,
  isMissingTitleEnRpcError,
  resetTitleEnColumnCacheForTests,
  selectWithOptionalTitleEn,
  setApprovalRequestTitleEn,
} from "./title-en";

describe("optional approval_requests.title_en reads", () => {
  beforeEach(() => resetTitleEnColumnCacheForTests());

  it("detects the missing-column error only for title_en", () => {
    expect(isMissingTitleEnColumnError({ code: "42703", message: "column approval_requests.title_en does not exist" })).toBe(true);
    expect(
      isMissingTitleEnColumnError({ message: "column approval_requests_1.title_en does not exist" }),
    ).toBe(true);
    expect(isMissingTitleEnColumnError({ code: "42703", message: "column foo.bar does not exist" })).toBe(false);
    expect(isMissingTitleEnColumnError(null)).toBe(false);
  });

  it("falls back to the projection without title_en before 086", async () => {
    const run = vi.fn(async (withTitleEn: boolean) =>
      withTitleEn
        ? { data: null, error: { code: "42703", message: "column approval_requests.title_en does not exist" } }
        : { data: [{ id: "1", title: "عنوان" }], error: null },
    );
    const result = await selectWithOptionalTitleEn(run);
    expect(result.data).toEqual([{ id: "1", title: "عنوان" }]);
    expect(run.mock.calls.map((c) => c[0])).toEqual([true, false]);
  });

  it("uses title_en when the column exists and does not retry other errors", async () => {
    const ok = vi.fn(async () => ({ data: [{ id: "1", title_en: "Title" }], error: null }));
    expect((await selectWithOptionalTitleEn(ok)).data).toEqual([{ id: "1", title_en: "Title" }]);
    expect(ok).toHaveBeenCalledTimes(1);

    const other = vi.fn(async () => ({ data: null, error: { code: "57014", message: "statement timeout" } }));
    expect((await selectWithOptionalTitleEn(other)).error?.code).toBe("57014");
    expect(other).toHaveBeenCalledTimes(1);
  });

  it("appends title_en to a column list", () => {
    expect(approvalTitleColumns("id, title", true)).toBe("id, title, title_en");
    expect(approvalTitleColumns("id, title", false)).toBe("id, title");
  });
});

describe("setApprovalRequestTitleEn", () => {
  it("calls the 086 RPC with a trimmed title", async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    const warn = vi.fn();
    await setApprovalRequestTitleEn({ rpc }, "req-1", "  Stage approval: Design — MT-1 ", warn);
    expect(rpc).toHaveBeenCalledWith("set_approval_request_title_en", {
      p_request_id: "req-1",
      p_title_en: "Stage approval: Design — MT-1",
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("skips empty titles and ignores a missing function with a warning", async () => {
    const rpc = vi.fn(async () => ({
      error: { code: "PGRST202", message: "Could not find the function public.set_approval_request_title_en" },
    }));
    const warn = vi.fn();
    await setApprovalRequestTitleEn({ rpc }, "req-1", "   ", warn);
    expect(rpc).not.toHaveBeenCalled();
    await expect(setApprovalRequestTitleEn({ rpc }, "req-1", "Title", warn)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/086/);
    expect(isMissingTitleEnRpcError({ code: "42883", message: "function does not exist" })).toBe(true);
    expect(isMissingTitleEnRpcError({ code: "P0001", message: "FORBIDDEN" })).toBe(false);
  });
});

describe("086 approval title_en migration", () => {
  const sql = readFileSync("supabase/migrations/086_approval_title_en.sql", "utf8");

  it("adds the nullable, length-checked column additively", () => {
    expect(sql).toContain("alter table public.approval_requests add column if not exists title_en text;");
    expect(sql).toMatch(/check \(title_en is null or char_length\(title_en\) between 1 and 240\)/);
    expect(sql).not.toMatch(/drop (table|column)/i);
  });

  it("exposes only a hardened security definer RPC", () => {
    expect(sql).toMatch(/create or replace function public\.set_approval_request_title_en\(\s*p_request_id uuid,\s*p_title_en text\s*\)/);
    expect(sql).toMatch(/security definer\s+set search_path = public/);
    expect(sql).toContain("auth.uid()");
    expect(sql).toContain("char_length(v_title) > 240");
    expect(sql).toContain("public.is_organization_member(v_organization_id)");
    expect(sql).toMatch(/v_requested_by is distinct from v_uid\s+and not public\.has_permission\('approval\.create', v_organization_id\)/);
    expect(sql).toContain("set title_en = v_title");
    expect(sql).toContain(
      "revoke all on function public.set_approval_request_title_en(uuid, text) from public, anon;",
    );
    expect(sql).toContain("grant execute on function public.set_approval_request_title_en(uuid, text) to authenticated;");
    expect(sql).not.toMatch(/grant execute[^;]*to anon/);
  });
});
