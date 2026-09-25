import { NextResponse } from "next/server";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewManagement, resolveManagementSections } from "@/modules/management/access";
import { ManagementRepository } from "@/server/repositories/management.repository";
import { createReportContext } from "@/modules/management/reports/context";
import { buildProjectReport } from "@/modules/management/reports/builders";
import { riyadhTodayYmd } from "@/modules/management/riyadh-date";
import { toCsv } from "@/lib/export/csv";

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx || !canViewManagement(ctx)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const sections = resolveManagementSections(ctx);
  if (!sections.projects) {
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
  const report = buildProjectReport({
    context: createReportContext(ctx, sections),
    snapshot,
    riskInput,
  });

  const csv = toCsv(
    ["project_code", "name_ar", "status", "planned_end_date", "overdue_days", "href"],
    report.overdueProjects.map((p) => [
      p.projectCode,
      p.nameAr,
      p.status,
      p.plannedEndDate,
      p.overdueDays,
      p.href,
    ]),
  );

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="management-projects-${today}.csv"`,
    },
  });
}
