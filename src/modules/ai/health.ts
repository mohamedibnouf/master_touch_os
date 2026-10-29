import type { Locale } from "@/lib/i18n/config";
import { AI_LIMITS } from "./limits";
import type { AiHealth, AiSeverity, AiRiskType, DeterministicRisk } from "./schemas";

export type ProjectAiStageSignal = {
  id: string;
  nameAr: string;
  visual: string;
  deadlineState: string;
  dueAt: string | null;
  responsibleLabel: string | null;
  requiresApproval: boolean;
  engineStatus: string;
  blockReason: string | null;
  openApprovalTitle: string | null;
  openApprovalId: string | null;
  approvalStartedAt: string | null;
};

export type ProjectAiFacts = {
  projectId: string;
  organizationId: string;
  project_name_ar: string;
  project_code: string;
  project_status: string;
  description: string | null;
  start_date: string | null;
  planned_end_date: string | null;
  location: string | null;
  completed_stages: number;
  total_stages: number;
  progress_percent: number;
  current_stage_name: string | null;
  current_stage_id: string | null;
  stages: ProjectAiStageSignal[];
  team: Array<{ label: string; role: string | null }>;
  documents: Array<{ id: string; title: string; category: string | null }>;
  activity: Array<{ action: string; at: string }>;
  generated_at: string;
  data_as_of: string;
};

function hoursSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (now.getTime() - t) / 36e5;
}

function hoursUntil(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (t - now.getTime()) / 36e5;
}

export function classifyProjectHealth(input: {
  risks: DeterministicRisk[];
  completed: number;
  total: number;
}): AiHealth {
  const types = new Set(input.risks.map((r) => r.type));
  const critical = input.risks.some((r) => r.severity === "critical");
  const high = input.risks.some((r) => r.severity === "high");
  if (critical) return "critical";
  if (types.has("OVERDUE_STAGE") && types.has("LONG_PENDING_APPROVAL")) return "critical";
  if (types.has("OVERDUE_STAGE") || types.has("PROJECT_END_DATE_RISK") || types.has("BLOCKED_WORKFLOW")) {
    return high ? "at_risk" : "at_risk";
  }
  if (
    types.has("DUE_SOON") ||
    types.has("PENDING_APPROVAL") ||
    types.has("MISSING_ASSIGNEE") ||
    types.has("LONG_PENDING_APPROVAL")
  ) {
    return "attention";
  }
  if (input.total > 0 && input.completed === input.total) return "healthy";
  if (input.total === 0) return "attention";
  return "healthy";
}

type RiskCopy = {
  stage: (name: string) => string;
  dueAt: (due: string) => string;
  noDueAt: string;
  status: (status: string) => string;
  overdueTitle: (name: string) => string;
  overdueExplanation: (name: string) => string;
  overdueRecommendation: string;
  dueSoonTitle: (name: string) => string;
  dueSoonExplanation: (name: string) => string;
  dueSoonRecommendation: string;
  missingAssigneeTitle: (name: string) => string;
  missingAssigneeExplanation: string;
  missingAssigneeRecommendation: string;
  longPendingTitle: (name: string) => string;
  pendingTitle: (name: string) => string;
  longPendingExplanation: string;
  pendingExplanation: string;
  request: (title: string) => string;
  openApproval: string;
  ageHours: (hours: number) => string;
  ageUnavailable: string;
  pendingRecommendation: string;
  blockedTitle: (name: string) => string;
  blockedExplanation: string;
  blockedRecommendation: string;
  endDateTitle: string;
  endDateExplanation: string;
  plannedEnd: (date: string) => string;
  progress: (completed: number, total: number) => string;
  endDateRecommendation: string;
};

const RISK_COPY_AR: RiskCopy = {
  stage: (name) => `المرحلة: ${name}`,
  dueAt: (due) => `موعد الإغلاق: ${due}`,
  noDueAt: "لا يوجد موعد مخزّن",
  status: (status) => `الحالة: ${status}`,
  overdueTitle: (name) => `مرحلة متأخرة: ${name}`,
  overdueExplanation: (name) => `المرحلة «${name}» متأخرة حسب موعد النظام.`,
  overdueRecommendation: "راجع سبب التأخير من شاشة مسار العمل، ولا يغيّر الذكاء الاصطناعي الموعد.",
  dueSoonTitle: (name) => `مرحلة قاربت الاستحقاق: ${name}`,
  dueSoonExplanation: (name) => `المرحلة «${name}» ضمن نافذة التنبيه.`,
  dueSoonRecommendation: "تابع المسؤول المعيّن قبل حلول الموعد.",
  missingAssigneeTitle: (name) => `بدون مسؤول: ${name}`,
  missingAssigneeExplanation: "المرحلة النشطة بلا مسؤول ظاهر في السياق المعتمد.",
  missingAssigneeRecommendation: "عيّن مسؤولاً للمرحلة عبر صلاحيات إدارة الفريق في النظام.",
  longPendingTitle: (name) => `موافقة معلّقة طويلاً: ${name}`,
  pendingTitle: (name) => `موافقة معلّقة: ${name}`,
  longPendingExplanation: "توجد موافقة معلّقة تجاوزت حد المتابعة التشغيلية المحسوب في التطبيق.",
  pendingExplanation: "توجد موافقة معلّقة على المرحلة.",
  request: (title) => `الطلب: ${title}`,
  openApproval: "موافقة مفتوحة",
  ageHours: (hours) => `عمر تقريبي بالساعات: ${hours}`,
  ageUnavailable: "عمر الموافقة غير متاح",
  pendingRecommendation: "راجع الموافقة المعلقة من شاشة الاعتمادات المعتمدة.",
  blockedTitle: (name) => `مسار متوقف: ${name}`,
  blockedExplanation: "المرحلة في حالة توقف حسب محرك مسار العمل.",
  blockedRecommendation: "عالج سبب التوقف من شاشة المراحل. الذكاء الاصطناعي لا يُكمل المرحلة.",
  endDateTitle: "تجاوز تاريخ الانتهاء المخطط",
  endDateExplanation: "تاريخ الانتهاء المخطط قد مضى بينما العمل غير مكتمل حسب عدّاد المراحل.",
  plannedEnd: (date) => `الانتهاء المخطط: ${date}`,
  progress: (completed, total) => `التقدم: ${completed}/${total}`,
  endDateRecommendation: "راجع خطة الإغلاق أو حدّث التواريخ عبر الإجراءات المعتمدة في النظام.",
};

const RISK_COPY_EN: RiskCopy = {
  stage: (name) => `Stage: ${name}`,
  dueAt: (due) => `Due: ${due}`,
  noDueAt: "No stored due date",
  status: (status) => `Status: ${status}`,
  overdueTitle: (name) => `Overdue stage: ${name}`,
  overdueExplanation: (name) => `Stage "${name}" is overdue according to the system deadline.`,
  overdueRecommendation: "Review the cause of the delay from the workflow screen. AI does not change the deadline.",
  dueSoonTitle: (name) => `Stage due soon: ${name}`,
  dueSoonExplanation: (name) => `Stage "${name}" is within the alert window.`,
  dueSoonRecommendation: "Follow up with the assigned owner before the deadline.",
  missingAssigneeTitle: (name) => `No owner: ${name}`,
  missingAssigneeExplanation: "The active stage has no visible owner in the authorized context.",
  missingAssigneeRecommendation: "Assign an owner to the stage through the team-management permissions in the system.",
  longPendingTitle: (name) => `Approval pending for a long time: ${name}`,
  pendingTitle: (name) => `Pending approval: ${name}`,
  longPendingExplanation: "An approval has been pending beyond the operational follow-up threshold computed by the app.",
  pendingExplanation: "There is a pending approval on this stage.",
  request: (title) => `Request: ${title}`,
  openApproval: "Open approval",
  ageHours: (hours) => `Approximate age in hours: ${hours}`,
  ageUnavailable: "Approval age not available",
  pendingRecommendation: "Review the pending approval from the approvals screen.",
  blockedTitle: (name) => `Blocked workflow: ${name}`,
  blockedExplanation: "The stage is blocked according to the workflow engine.",
  blockedRecommendation: "Resolve the cause of the block from the stages screen. AI does not complete the stage.",
  endDateTitle: "Planned end date passed",
  endDateExplanation: "The planned end date has passed while work is incomplete according to the stage counter.",
  plannedEnd: (date) => `Planned end: ${date}`,
  progress: (completed, total) => `Progress: ${completed}/${total}`,
  endDateRecommendation: "Review the closing plan or update dates through the approved actions in the system.",
};

/**
 * Deterministic project risks. Labels are Arabic by default; pass locale "en" for English.
 * Field names keep the `_ar` suffix and hold the text in the requested language.
 */
export function collectDeterministicRisks(
  facts: ProjectAiFacts,
  now = new Date(),
  locale: Locale = "ar",
): DeterministicRisk[] {
  const c = locale === "en" ? RISK_COPY_EN : RISK_COPY_AR;
  const risks: DeterministicRisk[] = [];

  for (const stage of facts.stages) {
    if (stage.deadlineState === "OVERDUE" || stage.visual === "overdue") {
      risks.push({
        type: "OVERDUE_STAGE",
        severity: "high",
        title_ar: c.overdueTitle(stage.nameAr),
        explanation_ar: c.overdueExplanation(stage.nameAr),
        evidence: [
          c.stage(stage.nameAr),
          stage.dueAt ? c.dueAt(stage.dueAt) : c.noDueAt,
          c.status(stage.engineStatus),
        ],
        recommendation_ar: c.overdueRecommendation,
      });
    } else if (stage.deadlineState === "DUE_SOON") {
      risks.push({
        type: "DUE_SOON",
        severity: "medium",
        title_ar: c.dueSoonTitle(stage.nameAr),
        explanation_ar: c.dueSoonExplanation(stage.nameAr),
        evidence: [c.stage(stage.nameAr), stage.dueAt ? c.dueAt(stage.dueAt) : c.noDueAt],
        recommendation_ar: c.dueSoonRecommendation,
      });
    }

    const openStatuses = ["ready", "in_progress", "waiting_approval"];
    if (openStatuses.includes(stage.engineStatus) && !stage.responsibleLabel) {
      risks.push({
        type: "MISSING_ASSIGNEE",
        severity: "medium",
        title_ar: c.missingAssigneeTitle(stage.nameAr),
        explanation_ar: c.missingAssigneeExplanation,
        evidence: [c.stage(stage.nameAr), c.status(stage.engineStatus)],
        recommendation_ar: c.missingAssigneeRecommendation,
      });
    }

    if (stage.openApprovalId || stage.visual === "waiting_approval" || stage.engineStatus === "waiting_approval") {
      const ageH = hoursSince(stage.approvalStartedAt, now);
      const longPending = ageH != null && ageH >= AI_LIMITS.pendingApprovalHoursHigh;
      risks.push({
        type: longPending ? "LONG_PENDING_APPROVAL" : "PENDING_APPROVAL",
        severity: longPending ? "high" : "medium",
        title_ar: longPending ? c.longPendingTitle(stage.nameAr) : c.pendingTitle(stage.nameAr),
        explanation_ar: longPending ? c.longPendingExplanation : c.pendingExplanation,
        evidence: [
          c.stage(stage.nameAr),
          stage.openApprovalTitle ? c.request(stage.openApprovalTitle) : c.openApproval,
          ageH != null ? c.ageHours(Math.floor(ageH)) : c.ageUnavailable,
        ],
        recommendation_ar: c.pendingRecommendation,
      });
    }

    if (stage.blockReason || stage.visual === "blocked" || stage.engineStatus === "blocked") {
      risks.push({
        type: "BLOCKED_WORKFLOW",
        severity: "high",
        title_ar: c.blockedTitle(stage.nameAr),
        explanation_ar: stage.blockReason ?? c.blockedExplanation,
        evidence: [c.stage(stage.nameAr), stage.blockReason ?? c.status(stage.engineStatus)],
        recommendation_ar: c.blockedRecommendation,
      });
    }
  }

  if (facts.planned_end_date) {
    const until = hoursUntil(`${facts.planned_end_date}T23:59:59.000Z`, now);
    const incomplete = facts.total_stages === 0 || facts.completed_stages < facts.total_stages;
    if (until != null && until < 0 && incomplete) {
      risks.push({
        type: "PROJECT_END_DATE_RISK",
        severity: "high",
        title_ar: c.endDateTitle,
        explanation_ar: c.endDateExplanation,
        evidence: [c.plannedEnd(facts.planned_end_date), c.progress(facts.completed_stages, facts.total_stages)],
        recommendation_ar: c.endDateRecommendation,
      });
    }
  }

  return dedupeRisks(risks);
}

function dedupeRisks(risks: DeterministicRisk[]): DeterministicRisk[] {
  const seen = new Set<string>();
  const out: DeterministicRisk[] = [];
  for (const r of risks) {
    const key = `${r.type}:${r.title_ar}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export function healthLabelAr(health: AiHealth): string {
  if (health === "healthy") return "مستقر";
  if (health === "attention") return "يحتاج متابعة";
  if (health === "at_risk") return "معرّض للخطر";
  return "حرج";
}

const HEALTH_LABEL_EN: Record<string, string> = {
  healthy: "Stable",
  attention: "Needs follow-up",
  at_risk: "At risk",
  critical: "Critical",
};

/** Health label in the given locale; Arabic by default. */
export function healthLabel(health: AiHealth, locale: Locale = "ar"): string {
  return locale === "en" ? (HEALTH_LABEL_EN[health] ?? HEALTH_LABEL_EN.critical) : healthLabelAr(health);
}

export function severityLabelAr(severity: AiSeverity): string {
  if (severity === "low") return "منخفض";
  if (severity === "medium") return "متوسط";
  if (severity === "high") return "مرتفع";
  return "حرج";
}

export function riskTypeLabelAr(type: AiRiskType): string {
  const map: Record<AiRiskType, string> = {
    OVERDUE_STAGE: "مرحلة متأخرة",
    DUE_SOON: "قرب الاستحقاق",
    PENDING_APPROVAL: "موافقة معلّقة",
    LONG_PENDING_APPROVAL: "موافقة معلّقة طويلاً",
    MISSING_ASSIGNEE: "بدون مسؤول",
    PROJECT_END_DATE_RISK: "خطر تاريخ الانتهاء",
    BLOCKED_WORKFLOW: "مسار متوقف",
  };
  return map[type];
}
