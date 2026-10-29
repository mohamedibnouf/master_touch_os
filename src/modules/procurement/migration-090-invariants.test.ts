import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/090_commercial_integrity.sql", "utf8");

/** Body of one `create or replace function public.<name>(` … `$$;` block. */
function fnBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} defined in 090`).toBeGreaterThanOrEqual(0);
  const open = sql.indexOf("as $$", start);
  const close = sql.indexOf("\n$$;", open);
  return sql.slice(start, close);
}

describe("090 commercial integrity — static SQL invariants", () => {
  it("is additive: no deletes, drops or row updates outside function bodies", () => {
    expect(sql).not.toMatch(/^\s*delete from/im);
    expect(sql).not.toMatch(/drop (table|function|index|policy)/i);
    const outsideFunctions = sql.replace(/as \$\$[\s\S]*?\n\$\$;/g, "");
    expect(outsideFunctions).not.toMatch(/^\s*update public\./im);
    expect(sql).toMatch(/^-- Safety:/m);
  });

  it("approve_variation gates on approvable status and closes open requests", () => {
    const body = fnBody("approve_variation");
    expect(body).toMatch(/v_vo\.status not in \('under_review', 'submitted', 'negotiation'\)/);
    expect(body).toMatch(/raise exception 'CONFLICT/);
    expect(body.indexOf("CONFLICT")).toBeLessThan(body.indexOf("update public.project_budgets"));
    expect(body).toMatch(/update public\.approval_requests\s+set status = 'cancelled'/);
    expect(body).toMatch(/entity_type = 'variation'/);
    expect(body).toMatch(/can_approve_variation\(v_vo\.project_id, v_vo\.organization_id\)/);
  });

  it("record_supplier_payment refuses non-payable invoices before inserting", () => {
    const body = fnBody("record_supplier_payment");
    expect(body).toMatch(/v_inv\.status not in \('approved_for_payment', 'partially_paid'\)/);
    expect(body.indexOf("SUPPLIER_INVOICE_NOT_PAYABLE")).toBeLessThan(body.indexOf("insert into public.supplier_payments"));
    expect(body).toMatch(/for update/);
    expect(body).toMatch(/can_record_supplier_payment/);
  });

  it("evaluate_supplier_invoice_match checks org/permission, refuses past review, compares cumulatively", () => {
    const body = fnBody("evaluate_supplier_invoice_match");
    expect(body).toMatch(/can_review_supplier_invoice\(v_inv\.project_id, v_inv\.organization_id\)/);
    expect(body).toMatch(/raise exception 'FORBIDDEN'/);
    expect(body).toMatch(/v_inv\.status not in \('received', 'under_review', 'matched', 'discrepancy'\)/);
    expect(body).toMatch(/sum\(si\.total\)[\s\S]*si\.status not in \('cancelled', 'rejected'\)/);
    expect(body).toMatch(/invoice_exceeds_receipt/);
    expect(body).toMatch(/received_quantity \* unit_price/);
    const helper = fnBody("can_review_supplier_invoice");
    expect(helper).toMatch(/is_organization_member\(p_organization_id\)/);
    expect(sql).toMatch(/revoke all on function public\.can_review_supplier_invoice\(uuid, uuid\) from public, anon/);
  });

  it("issue_purchase_order only issues approved POs and checks permission first", () => {
    const body = fnBody("issue_purchase_order");
    expect(body).toMatch(/v_po\.status <> 'approved'/);
    expect(body).not.toMatch(/'draft'/);
    expect(body.indexOf("FORBIDDEN")).toBeLessThan(body.indexOf("v_po.status <> 'approved'"));
  });

  it("post_goods_receipt posts drafts once against an open PO", () => {
    const body = fnBody("post_goods_receipt");
    expect(body).toMatch(/v_gr\.status <> 'draft'/);
    expect(body).toMatch(/v_po_status not in \('issued', 'partially_delivered'\)/);
    expect(body.indexOf("GOODS_RECEIPT_ALREADY_POSTED")).toBeLessThan(body.indexOf("for r in"));
  });

  it("quotation unique index is partial, guarded and never fails on duplicates", () => {
    expect(sql).toMatch(
      /create unique index purchase_orders_quotation_active_uidx\s+on public\.purchase_orders \(quotation_id\)\s+where quotation_id is not null and status <> 'cancelled'/,
    );
    expect(sql).toMatch(/having count\(\*\) > 1/);
    expect(sql).toMatch(/raise notice '090: purchase_orders_quotation_active_uidx NOT created/);
    expect(sql).toMatch(/indexname = 'purchase_orders_quotation_active_uidx'/);
  });

  it("decide_entity_approval keeps the 049 body and guards valuation / variation / invoice branches", () => {
    const body = fnBody("decide_entity_approval");
    expect(body).toMatch(/returns jsonb/);
    expect(body).toMatch(/submit_approval_decision\(v_step\.id, p_official_code, p_comment\)/);
    expect(body).toMatch(/v_valuation\.status <> 'internal_review'/);
    expect(body.indexOf("v_valuation.status <> 'internal_review'")).toBeLessThan(
      body.indexOf("client_valuation.internal_approved"),
    );
    expect(body).toMatch(/v_variation\.status not in \('under_review', 'submitted', 'negotiation'\)/);
    expect(body).toMatch(/v_invoice\.status not in \('received', 'under_review', 'matched', 'discrepancy'\)/);
    // Purchase order / PR / comparison branches unchanged.
    expect(body).toMatch(/quotation\.award_approved/);
    expect(body).toMatch(/purchase_order\.approved/);
  });

  it("keeps search_path pinned on every security definer function", () => {
    const definers = sql.match(/^security definer\s+set search_path = public$/gm) ?? [];
    const all = sql.match(/^security definer$/gm) ?? [];
    expect(definers.length).toBe(all.length);
    expect(all.length).toBeGreaterThanOrEqual(7);
  });
});
