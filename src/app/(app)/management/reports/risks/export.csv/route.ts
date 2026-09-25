import { NextResponse } from "next/server";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewManagement, resolveManagementSections } from "@/modules/management/access";
import { ManagementRepository } from "@/server/repositories/management.repository";
import { riyadhTodayYmd } from "@/modules/management/riyadh-date";
import { toCsv } from "@/lib/export/csv";

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx || !canViewManagement(ctx)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const sections = resolveManagementSections(ctx);
  const supabase = await createServerSupabaseClient();
  const { risks } = await new ManagementRepository(supabase).loadRiskFindings(
    ctx.organization.id,
    sections,
  );
  const today = riyadhTodayYmd();

  const csv = toCsv(
    [
      "id",
      "rule_id",
      "category",
      "severity",
      "title_en",
      "explanation_en",
      "source_type",
      "source_id",
      "href",
      "effective_since",
      "age_days",
    ],
    risks.map((f) => [
      f.id,
      f.ruleId,
      f.category,
      f.severity,
      f.titleEn,
      f.explanationEn,
      f.sourceType,
      f.sourceId,
      f.href,
      f.effectiveSince,
      f.ageDays,
    ]),
  );

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="management-risks-${today}.csv"`,
    },
  });
}
