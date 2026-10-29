import type { Locale } from "@/lib/i18n/config";

export type DigestFacts = {
  asOfDate: string;
  overdueApprovals: number;
  projectsNeedingAttention: number;
  highRisks: number;
  criticalRisks: number;
  payrollUnderReview: number;
  attendanceExceptions: number;
  attentionTitles: string[];
};

/**
 * Management digest text. Arabic is the default (server jobs log it as-is);
 * pass `locale: "en"` from the management digest screen for English.
 */
export function buildDeterministicDigest(facts: DigestFacts, locale: Locale = "ar"): string {
  const lines =
    locale === "en"
      ? [
          `Management digest — ${facts.asOfDate} (Asia/Riyadh)`,
          `Overdue approvals: ${facts.overdueApprovals}`,
          `Projects needing attention: ${facts.projectsNeedingAttention}`,
          `Critical risks: ${facts.criticalRisks} · High: ${facts.highRisks}`,
          `Payroll periods under review: ${facts.payrollUnderReview}`,
          `Attendance exceptions: ${facts.attendanceExceptions}`,
        ]
      : [
          `ملخص إداري — ${facts.asOfDate} (آسيا/الرياض)`,
          `موافقات متأخرة: ${facts.overdueApprovals}`,
          `مشاريع تحتاج انتباهاً: ${facts.projectsNeedingAttention}`,
          `مخاطر حرجة: ${facts.criticalRisks} · عالية: ${facts.highRisks}`,
          `مسيرات قيد المراجعة: ${facts.payrollUnderReview}`,
          `استثناءات حضور: ${facts.attendanceExceptions}`,
        ];
  if (facts.attentionTitles.length) {
    lines.push(locale === "en" ? "Attention items:" : "عناصر الانتباه:");
    for (const title of facts.attentionTitles.slice(0, 8)) lines.push(`- ${title}`);
  }
  return lines.join("\n");
}

export async function maybeAiDigestSummary(
  facts: DigestFacts,
  summarize?: (text: string) => Promise<string>,
  locale: Locale = "ar",
): Promise<{ text: string; source: "deterministic" | "ai" }> {
  const base = buildDeterministicDigest(facts, locale);
  if (!summarize) return { text: base, source: "deterministic" };
  try {
    const ai = (await summarize(base)).trim();
    if (!ai) return { text: base, source: "deterministic" };
    const heading = locale === "en" ? "Assistant summary:" : "خلاصة مساعدة:";
    return { text: `${base}\n\n${heading}\n${ai}`, source: "ai" };
  } catch {
    return { text: base, source: "deterministic" };
  }
}

export type PerformanceFacts = {
  profileId: string;
  displayName: string;
  assignedApprovals: number;
  completedApprovals: number;
  overdueApprovals: number;
};

export function formatPerformanceFacts(rows: PerformanceFacts[], locale: Locale = "ar"): string {
  return rows
    .map((r) =>
      locale === "en"
        ? `${r.displayName}: assigned ${r.assignedApprovals} · completed ${r.completedApprovals} · overdue ${r.overdueApprovals}`
        : `${r.displayName}: مسند ${r.assignedApprovals} · مكتمل ${r.completedApprovals} · متأخر ${r.overdueApprovals}`,
    )
    .join("\n");
}
