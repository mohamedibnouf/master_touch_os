import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/089_payroll_leave_integrity.sql", "utf8");
const sql059 = readFileSync("supabase/migrations/059_phase4_payroll_management.sql", "utf8").replace(/\r\n/g, "\n");

/** Body of one `create or replace function public.<name>(` block up to its closing `$$;`. */
function fnBody(source: string, name: string): string {
  const start = source.indexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`missing function ${name}`);
  const end = source.indexOf("\n$$;\n", start);
  return source.slice(start, end);
}

describe("089 migration shape", () => {
  it("has the standard header and safety notes", () => {
    expect(sql.startsWith("-- Master Touch OS — 089\n")).toBe(true);
    expect(sql).toContain("-- Safety:");
    expect(sql).toMatch(/Existing periods are NOT recalculated/);
  });

  it("is additive and idempotent", () => {
    expect(sql).not.toMatch(/\bdrop\s+(table|function|column)\b/i);
    expect(sql).not.toMatch(/\balter\s+table\b/i);
    expect(sql).not.toMatch(/\bcreate\s+table\b/i);
    expect(sql).not.toMatch(/\b(delete\s+from|truncate)\s+public\.payroll_periods\b/i);
    for (const m of sql.matchAll(/create policy (\w+) on ([\w.]+)/g)) {
      expect(sql).toContain(`drop policy if exists ${m[1]} on ${m[2]};`);
    }
    expect(sql.match(/create or replace function public\.\w+\(/g)?.length).toBe(8);
  });

  it("never recalculates or rewrites existing payroll data", () => {
    expect(sql).not.toMatch(/(perform|select)\s+public\.calculate_payroll_period\(/i);
    expect(sql).not.toMatch(/update public\.payroll_entries\s+set[\s\S]{0,40}net_pay\s*=\s*greatest/i);
    // Only statements outside function bodies would run at apply time.
    const outsideBodies = sql.replace(/\nas \$\$[\s\S]*?\n\$\$;/g, "");
    expect(outsideBodies).not.toMatch(/\b(update|insert into|delete from)\s+public\./i);
  });

  it("keeps grants for the replaced RPCs", () => {
    for (const grant of [
      "revoke all on function public.recompute_payroll_entry_totals(uuid) from public, anon, authenticated;",
      "grant execute on function public.calculate_payroll_period(uuid) to authenticated;",
      "grant execute on function public.approve_payroll_period(uuid) to authenticated;",
      "grant execute on function public.add_payroll_manual_earning(uuid, text, text, text, numeric, text) to authenticated;",
      "grant execute on function public.add_payroll_manual_deduction(uuid, text, text, text, numeric, text) to authenticated;",
      "grant execute on function public.submit_leave_request(uuid, date, date, text, uuid, uuid) to authenticated;",
      "grant execute on function public.decide_leave_request(uuid, text, text) to authenticated;",
      "grant execute on function public.get_employee_banking(uuid) to authenticated;",
    ]) {
      expect(sql).toContain(grant);
    }
  });
});

describe("089 payroll engine", () => {
  const calc = fnBody(sql, "calculate_payroll_period");

  it("normalises unpaid leave onto the payable-days basis and caps it", () => {
    expect(calc).toContain("v_unpaid_payable := v_unpaid_leave * v_std / v_period_calendar;");
    expect(calc).toContain("v_unpaid_payable := least(v_unpaid_payable, v_sum_payable);");
    expect(calc).toContain("v_deduct_amt := v_gross_recurring;");
    expect(calc).not.toContain("round(v_daily_avg * v_unpaid_leave, v_prec)");
  });

  it("bills every absent day (no subtraction of unpaid leave)", () => {
    expect(calc).toContain("v_absence_billable := greatest(0, coalesce(v_absent, 0));");
    expect(calc).not.toContain("coalesce(v_absent, 0) - v_unpaid_leave");
  });

  it("caps each calculated deduction at the remaining available amount", () => {
    expect(calc.match(/v_deduct_amt := least\(v_deduct_amt, v_available\);/g)?.length).toBe(3);
  });

  it("is otherwise the 059 body (same status gate, permission and engine version)", () => {
    const original = fnBody(sql059, "calculate_payroll_period");
    for (const line of [
      "if v_period.status not in ('draft', 'calculated') then",
      "public.has_permission('payroll.calculate', v_period.organization_id, 'organization', null)",
      "perform pg_advisory_xact_lock(hashtext(p_period_id::text));",
      "v_payable := v_std * v_seg_calendar / v_period_calendar;",
      "perform public.recompute_payroll_entry_totals(v_entry.id);",
    ]) {
      expect(original).toContain(line);
      expect(calc).toContain(line);
    }
  });

  it("clamps net pay at zero", () => {
    expect(fnBody(sql, "recompute_payroll_entry_totals")).toContain(
      "net_pay = greatest(v_earnings - v_deductions, 0),",
    );
  });
});

describe("089 payroll maker-checker", () => {
  it("approval requires a review by a different user", () => {
    const approve = fnBody(sql, "approve_payroll_period");
    expect(approve).toContain("if v_period.reviewed_at is null or v_period.reviewed_by is null then");
    expect(approve).toContain("raise exception 'PAYROLL_NOT_REVIEWED'");
    expect(approve).toContain("if v_period.reviewed_by = auth.uid() then");
    expect(approve).toContain("raise exception 'PAYROLL_SELF_APPROVAL'");
  });

  it("manual adjustments after review reset the review", () => {
    for (const name of ["add_payroll_manual_earning", "add_payroll_manual_deduction"]) {
      const body = fnBody(sql, name);
      expect(body).toContain("if v_period.status = 'under_review' and v_period.reviewed_at is not null then");
      expect(body).toMatch(/reviewed_at = null,\s+reviewed_by = null,/);
      expect(body).toContain("'payroll.review_reset'");
    }
  });

  it("manual deductions cannot push net below zero", () => {
    const body = fnBody(sql, "add_payroll_manual_deduction");
    expect(body).toContain("if round(p_amount, 2) > greatest(coalesce(v_entry.net_pay, 0), 0) then");
    expect(body).toContain("raise exception 'PAYROLL_NET_NEGATIVE'");
  });
});

describe("089 leave", () => {
  it("rejects deciding one's own leave request", () => {
    const body = fnBody(sql, "decide_leave_request");
    expect(body).toContain("if v_emp.profile_id = auth.uid() then");
    expect(body).toContain("raise exception 'LEAVE_SELF_DECISION'");
  });

  it("uses the Riyadh date for minimum notice", () => {
    const body = fnBody(sql, "submit_leave_request");
    expect(body).toContain("(timezone('Asia/Riyadh', now()))::date + v_notice");
    expect(body).not.toContain("current_date");
  });
});

describe("089 banking and compensation visibility", () => {
  it("returns the full IBAN only for banking/HR permissions", () => {
    const body = fnBody(sql, "get_employee_banking");
    expect(body).toContain("when v_can_see_full then b.iban");
    const fullBlock = body.slice(body.indexOf("v_can_see_full :="), body.indexOf("return query"));
    expect(fullBlock).toContain("'employee_bank.read'");
    expect(fullBlock).not.toContain("finance.read");
    expect(fullBlock).not.toContain("finance.manage");
  });

  it("drops finance.read from bank and compensation select policies", () => {
    const policies = sql.slice(sql.indexOf("drop policy if exists employee_bank_accounts_select"));
    expect(policies).not.toContain("'finance.read'");
    const comp = policies.slice(policies.indexOf("create policy employee_compensation_versions_select"));
    expect(comp).toContain("'payroll.view_all'");
    expect(comp).toContain("'employee_compensation.read'");
    expect(comp).toContain("e.profile_id = auth.uid()");
    // Fully-qualified correlation (054 compared e.organization_id with itself).
    expect(comp).toContain("e.organization_id = employee_compensation_versions.organization_id");
  });
});
