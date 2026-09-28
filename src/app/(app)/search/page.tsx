import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Badge, Card, EmptyState, Field, PageHeader } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  const { q = "" } = await searchParams;
  const term = q.trim();
  const supabase = await createServerSupabaseClient();

  type Hit = { kind: string; number: string; title: string; href: string; status?: string };

  const hits: Hit[] = [];

  if (term.length >= 2) {
    const pattern = `%${term}%`;
    const [docs, rfis, mats, shds, irs, ncrs, trns, cors, prs, rfqsSearch, posSearch, supplierSearch, invoiceSearch, contractsSearch, valuationsSearch, clientInvSearch, variationsSearch, clientPaySearch] = await Promise.all([
      supabase
        .from("documents")
        .select("id, document_number, title, type_code, status, project_id")
        .eq("organization_id", ctx.organization.id)
        .or(`document_number.ilike.${pattern},title.ilike.${pattern}`)
        .limit(20),
      supabase
        .from("rfis")
        .select("id, rfi_number, subject, status, project_id")
        .eq("organization_id", ctx.organization.id)
        .or(`rfi_number.ilike.${pattern},subject.ilike.${pattern}`)
        .limit(15),
      supabase
        .from("material_submittals")
        .select("id, mat_number, material_category, status, project_id")
        .eq("organization_id", ctx.organization.id)
        .or(`mat_number.ilike.${pattern},material_category.ilike.${pattern}`)
        .limit(15),
      supabase
        .from("shop_drawings")
        .select("id, shd_number, drawing_title, status, project_id")
        .eq("organization_id", ctx.organization.id)
        .or(`shd_number.ilike.${pattern},drawing_title.ilike.${pattern}`)
        .limit(15),
      supabase
        .from("inspection_requests")
        .select("id, ir_number, related_activity, status, project_id")
        .eq("organization_id", ctx.organization.id)
        .or(`ir_number.ilike.${pattern},related_activity.ilike.${pattern}`)
        .limit(15),
      supabase
        .from("ncrs")
        .select("id, ncr_number, description, status, project_id")
        .eq("organization_id", ctx.organization.id)
        .or(`ncr_number.ilike.${pattern},description.ilike.${pattern}`)
        .limit(15),
      supabase
        .from("transmittals")
        .select("id, transmittal_number, subject, status, project_id")
        .eq("organization_id", ctx.organization.id)
        .or(`transmittal_number.ilike.${pattern},subject.ilike.${pattern}`)
        .limit(15),
      supabase
        .from("correspondence")
        .select("id, reference_number, subject, status, project_id")
        .eq("organization_id", ctx.organization.id)
        .or(`reference_number.ilike.${pattern},subject.ilike.${pattern}`)
        .limit(15),
      hasPermission(ctx, "purchase_request.read")
        ? supabase
            .from("purchase_requests")
            .select("id, pr_number, status")
            .eq("organization_id", ctx.organization.id)
            .ilike("pr_number", pattern)
            .limit(15)
        : Promise.resolve({ data: [] }),
      hasPermission(ctx, "rfq.read")
        ? supabase
            .from("rfqs")
            .select("id, rfq_number, title, status")
            .eq("organization_id", ctx.organization.id)
            .or(`rfq_number.ilike.${pattern},title.ilike.${pattern}`)
            .limit(15)
        : Promise.resolve({ data: [] }),
      hasPermission(ctx, "purchase_order.read")
        ? supabase
            .from("purchase_orders")
            .select("id, po_number, status")
            .eq("organization_id", ctx.organization.id)
            .ilike("po_number", pattern)
            .limit(15)
        : Promise.resolve({ data: [] }),
      hasPermission(ctx, "supplier.read")
        ? supabase
            .from("suppliers")
            .select("id, supplier_code, legal_name, status")
            .eq("organization_id", ctx.organization.id)
            .or(`supplier_code.ilike.${pattern},legal_name.ilike.${pattern}`)
            .limit(15)
        : Promise.resolve({ data: [] }),
      hasPermission(ctx, "supplier_invoice.read")
        ? supabase
            .from("supplier_invoices")
            .select("id, invoice_number, status")
            .eq("organization_id", ctx.organization.id)
            .ilike("invoice_number", pattern)
            .limit(15)
        : Promise.resolve({ data: [] }),
      hasPermission(ctx, "finance.read") || hasPermission(ctx, "commercial_reports.read")
        ? supabase
            .from("project_contracts")
            .select("id, contract_number, client_name, status, project_id")
            .eq("organization_id", ctx.organization.id)
            .or(`contract_number.ilike.${pattern},client_name.ilike.${pattern}`)
            .limit(15)
        : Promise.resolve({ data: [] }),
      hasPermission(ctx, "client_valuation.read")
        ? supabase
            .from("client_valuations")
            .select("id, valuation_number, status")
            .eq("organization_id", ctx.organization.id)
            .ilike("valuation_number", pattern)
            .limit(15)
        : Promise.resolve({ data: [] }),
      hasPermission(ctx, "client_invoice.read")
        ? supabase
            .from("client_invoices")
            .select("id, invoice_number, status")
            .eq("organization_id", ctx.organization.id)
            .ilike("invoice_number", pattern)
            .limit(15)
        : Promise.resolve({ data: [] }),
      hasPermission(ctx, "variation.read")
        ? supabase
            .from("variations")
            .select("id, vo_number, description, status")
            .eq("organization_id", ctx.organization.id)
            .or(`vo_number.ilike.${pattern},description.ilike.${pattern}`)
            .limit(15)
        : Promise.resolve({ data: [] }),
      hasPermission(ctx, "client_payment.read")
        ? supabase
            .from("client_payments")
            .select("id, reference, amount, client_invoice_id")
            .eq("organization_id", ctx.organization.id)
            .ilike("reference", pattern)
            .limit(15)
        : Promise.resolve({ data: [] }),
    ]);

    for (const d of docs.data ?? []) {
      hits.push({
        kind: d.type_code ?? "DOC",
        number: d.document_number ?? d.id,
        title: d.title,
        status: d.status,
        href: `/document-control?q=${encodeURIComponent(d.document_number ?? "")}`,
      });
    }
    for (const r of rfis.data ?? []) {
      hits.push({
        kind: "RFI",
        number: r.rfi_number,
        title: r.subject,
        status: r.status,
        href: `/engineering?module=rfi&project=${r.project_id}`,
      });
    }
    for (const m of mats.data ?? []) {
      hits.push({
        kind: "MAT",
        number: m.mat_number,
        title: m.material_category,
        status: m.status,
        href: `/engineering?module=mat&project=${m.project_id}`,
      });
    }
    for (const s of shds.data ?? []) {
      hits.push({
        kind: "SHD",
        number: s.shd_number,
        title: s.drawing_title,
        status: s.status,
        href: `/engineering?module=shd&project=${s.project_id}`,
      });
    }
    for (const i of irs.data ?? []) {
      hits.push({
        kind: "IR",
        number: i.ir_number,
        title: i.related_activity ?? "",
        status: i.status,
        href: `/engineering?module=ir&project=${i.project_id}`,
      });
    }
    for (const n of ncrs.data ?? []) {
      hits.push({
        kind: "NCR",
        number: n.ncr_number,
        title: n.description,
        status: n.status,
        href: `/engineering?module=ncr&project=${n.project_id}`,
      });
    }
    for (const t of trns.data ?? []) {
      hits.push({
        kind: "TRN",
        number: t.transmittal_number,
        title: t.subject,
        status: t.status,
        href: `/document-control?q=${encodeURIComponent(t.transmittal_number)}`,
      });
    }
    for (const c of cors.data ?? []) {
      hits.push({
        kind: "COR",
        number: c.reference_number,
        title: c.subject,
        status: c.status,
        href: `/projects/${c.project_id}?tab=correspondence`,
      });
    }
    for (const p of (prs as { data: Array<{id: string; pr_number: string; status: string}> }).data ?? []) {
      hits.push({ kind: "PR", number: p.pr_number, title: "طلب شراء", status: p.status, href: `/procurement/purchase-requests/${p.id}` });
    }
    for (const r of (rfqsSearch as { data: Array<{id: string; rfq_number: string; title: string; status: string}> }).data ?? []) {
      hits.push({ kind: "RFQ", number: r.rfq_number, title: r.title, status: r.status, href: `/procurement/rfqs/${r.id}` });
    }
    for (const p of (posSearch as { data: Array<{id: string; po_number: string; status: string}> }).data ?? []) {
      hits.push({ kind: "PO", number: p.po_number, title: "أمر شراء", status: p.status, href: `/procurement/purchase-orders/${p.id}` });
    }
    for (const s of (supplierSearch as { data: Array<{id: string; supplier_code: string; legal_name: string; status: string}> }).data ?? []) {
      hits.push({ kind: "SUP", number: s.supplier_code, title: s.legal_name, status: s.status, href: `/procurement/suppliers/${s.id}` });
    }
    for (const i of (invoiceSearch as { data: Array<{id: string; invoice_number: string; status: string}> }).data ?? []) {
      hits.push({ kind: "INV", number: i.invoice_number, title: "فاتورة مورد", status: i.status, href: `/finance/supplier-invoices/${i.id}` });
    }
    for (const c of (contractsSearch as { data: Array<{id: string; contract_number: string; client_name: string; status: string; project_id: string}> }).data ?? []) {
      hits.push({ kind: "CON", number: c.contract_number, title: c.client_name, status: c.status, href: `/projects/${c.project_id}/commercial/contract` });
    }
    for (const v of (valuationsSearch as { data: Array<{id: string; valuation_number: string; status: string}> }).data ?? []) {
      hits.push({ kind: "VAL", number: v.valuation_number, title: "مستخلص عميل", status: v.status, href: `/finance/client-valuations/${v.id}` });
    }
    for (const ci of (clientInvSearch as { data: Array<{id: string; invoice_number: string; status: string}> }).data ?? []) {
      hits.push({ kind: "CINV", number: ci.invoice_number, title: "فاتورة عميل", status: ci.status, href: `/finance/client-invoices/${ci.id}` });
    }
    for (const vo of (variationsSearch as { data: Array<{id: string; vo_number: string; description: string; status: string}> }).data ?? []) {
      hits.push({ kind: "VO", number: vo.vo_number, title: vo.description, status: vo.status, href: `/finance/variations/${vo.id}` });
    }
    for (const cp of (clientPaySearch as { data: Array<{id: string; reference: string; amount: number; client_invoice_id: string}> }).data ?? []) {
      hits.push({ kind: "RCP", number: cp.reference, title: `تحصيل ${cp.amount}`, href: `/finance/client-invoices/${cp.client_invoice_id}` });
    }

    if (hasPermission(ctx, "employee.read")) {
      const { data: empHits } = await supabase
        .from("employees")
        .select("id, employee_number, job_title_ar, work_location, profiles(full_name_ar, full_name_en)")
        .eq("organization_id", ctx.organization.id)
        .or(`employee_number.ilike.${pattern},job_title_ar.ilike.${pattern},work_location.ilike.${pattern}`)
        .limit(15);
      for (const e of empHits ?? []) {
        const p = Array.isArray(e.profiles) ? e.profiles[0] : e.profiles;
        const name = (p as { full_name_ar?: string } | null)?.full_name_ar ?? e.employee_number ?? e.id;
        hits.push({
          kind: "EMP",
          number: e.employee_number ?? e.id.slice(0, 8),
          title: `${name}${e.job_title_ar ? ` — ${e.job_title_ar}` : ""}`,
          href: `/employees/${e.id}`,
        });
      }
    }
  }

  const canSearch =
    hasPermission(ctx, "document.read") ||
    hasPermission(ctx, "document_control.read") ||
    hasPermission(ctx, "engineering.read") ||
    hasPermission(ctx, "rfi.read") ||
    hasPermission(ctx, "purchase_request.read") ||
    hasPermission(ctx, "rfq.read") ||
    hasPermission(ctx, "purchase_order.read") ||
    hasPermission(ctx, "supplier.read") ||
    hasPermission(ctx, "supplier_invoice.read") ||
    hasPermission(ctx, "finance.read") ||
    hasPermission(ctx, "client_valuation.read") ||
    hasPermission(ctx, "client_invoice.read") ||
    hasPermission(ctx, "variation.read") ||
    hasPermission(ctx, "employee.read");

  if (!canSearch) redirect("/");

  return (
    <PageContainer className="space-y-5">
      <PageHeader title="بحث موحّد" description="PR, RFQ, PO, مورد، فاتورة، وثائق هندسية — بحث من قاعدة البيانات" />
      <Card className="mb-6">
        <form className="flex flex-wrap gap-3">
          <Field label="رقم الوثيقة / العنوان">
            <input
              name="q"
              defaultValue={term}
              className="w-full min-w-[280px] rounded-md border border-line bg-white px-3 py-2 text-sm"
              placeholder="مثال: RFI- أو MAT- أو عنوان..."
            />
          </Field>
          <div className="flex items-end">
            <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm text-white">
              بحث
            </button>
          </div>
        </form>
      </Card>

      {term.length < 2 ? (
        <EmptyState title="أدخل حرفين على الأقل للبحث." />
      ) : hits.length === 0 ? (
        <EmptyState title="لا توجد نتائج ضمن نطاق صلاحياتك." />
      ) : (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-paper text-muted">
                <tr>
                  <th className="px-4 py-3 text-right">النوع</th>
                  <th className="px-4 py-3 text-right">الرقم</th>
                  <th className="px-4 py-3 text-right">العنوان</th>
                  <th className="px-4 py-3 text-right">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {hits.map((hit, idx) => (
                  <tr key={`${hit.kind}-${hit.number}-${idx}`} className="border-t border-line">
                    <td className="px-4 py-3">
                      <Badge tone="navy">{hit.kind}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={hit.href} className="font-medium text-navy underline">
                        {hit.number}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{hit.title}</td>
                    <td className="px-4 py-3 text-muted">{hit.status ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </PageContainer>
  );
}
