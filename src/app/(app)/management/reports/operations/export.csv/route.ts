import { NextResponse } from "next/server";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewManagement, resolveManagementSections } from "@/modules/management/access";
import { ManagementRepository } from "@/server/repositories/management.repository";
import { createReportContext } from "@/modules/management/reports/context";
import { buildOperationsReport } from "@/modules/management/reports/builders";
import { riyadhTodayYmd } from "@/modules/management/riyadh-date";
import { toCsv } from "@/lib/export/csv";

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx || !canViewManagement(ctx)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const sections = resolveManagementSections(ctx);
  if (!sections.approvals && !sections.procurement) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  const repo = new ManagementRepository(supabase);
  const snapshot = await repo.loadSnapshot(ctx.organization.id, ctx.profile.id, sections);
  const today = riyadhTodayYmd();
  const riskInput = await repo.loadRiskInputSnapshot(
    ctx.organization.id,
    sections,
    today,
    new Date().toISOString(),
  );
  const report = buildOperationsReport({
    context: createReportContext(ctx, sections),
    snapshot,
    riskInput,
  });

  const csv = toCsv(
    ["approval_id", "title", "status", "open_days", "href"],
    report.oldestApprovals.map((a) => [a.id, a.title, a.status, a.openDays, a.href]),
  );

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="management-operations-${today}.csv"`,
    },
  });
}
