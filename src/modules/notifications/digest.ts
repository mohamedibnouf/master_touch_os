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

export function buildDeterministicDigest(facts: DigestFacts): string {
  const lines = [
    `ملخص إداري — ${facts.asOfDate} (آسيا/الرياض)`,
    `موافقات متأخرة: ${facts.overdueApprovals}`,
    `مشاريع تحتاج انتباهاً: ${facts.projectsNeedingAttention}`,
    `مخاطر حرجة: ${facts.criticalRisks} · عالية: ${facts.highRisks}`,
    `مسيرات قيد المراجعة: ${facts.payrollUnderReview}`,
    `استثناءات حضور: ${facts.attendanceExceptions}`,
  ];
  if (facts.attentionTitles.length) {
    lines.push("عناصر الانتباه:");
    for (const title of facts.attentionTitles.slice(0, 8)) lines.push(`- ${title}`);
  }
  return lines.join("\n");
}

export async function maybeAiDigestSummary(
  facts: DigestFacts,
  summarize?: (text: string) => Promise<string>,
): Promise<{ text: string; source: "deterministic" | "ai" }> {
  const base = buildDeterministicDigest(facts);
  if (!summarize) return { text: base, source: "deterministic" };
  try {
    const ai = (await summarize(base)).trim();
    if (!ai) return { text: base, source: "deterministic" };
    return { text: `${base}\n\nخلاصة مساعدة:\n${ai}`, source: "ai" };
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

export function formatPerformanceFacts(rows: PerformanceFacts[]): string {
  return rows
    .map(
      (r) =>
        `${r.displayName}: مسند ${r.assignedApprovals} · مكتمل ${r.completedApprovals} · متأخر ${r.overdueApprovals}`,
    )
    .join("\n");
}
