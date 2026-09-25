import type { AuthContext } from "@/types/models";
import type { ManagementReportContext } from "@/modules/management/reports/types";
import type { ManagementSectionFlags } from "@/modules/management/types";
import { riyadhTodayYmd } from "@/modules/management/riyadh-date";

export function createReportContext(
  ctx: AuthContext,
  sections: ManagementSectionFlags,
  opts?: { fromDate?: string | null; toDate?: string | null },
): ManagementReportContext {
  return {
    organizationId: ctx.organization.id,
    organizationNameAr: ctx.organization.name_ar,
    organizationNameEn: ctx.organization.name_en,
    asOfDate: riyadhTodayYmd(),
    generatedAt: new Date().toISOString(),
    sections,
    fromDate: opts?.fromDate ?? null,
    toDate: opts?.toDate ?? null,
  };
}
