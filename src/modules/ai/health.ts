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

export function collectDeterministicRisks(facts: ProjectAiFacts, now = new Date()): DeterministicRisk[] {
  const risks: DeterministicRisk[] = [];

  for (const stage of facts.stages) {
    if (stage.deadlineState === "OVERDUE" || stage.visual === "overdue") {
      risks.push({
        type: "OVERDUE_STAGE",
        severity: "high",
        title_ar: `مرحلة متأخرة: ${stage.nameAr}`,
        explanation_ar: `المرحلة «${stage.nameAr}» متأخرة حسب موعد النظام.`,
        evidence: [
          `المرحلة: ${stage.nameAr}`,
          stage.dueAt ? `موعد الإغلاق: ${stage.dueAt}` : "لا يوجد موعد مخزّن",
          `الحالة: ${stage.engineStatus}`,
        ],
        recommendation_ar: "راجع سبب التأخير من شاشة مسار العمل، ولا يغيّر الذكاء الاصطناعي الموعد.",
      });
    } else if (stage.deadlineState === "DUE_SOON") {
      risks.push({
        type: "DUE_SOON",
        severity: "medium",
        title_ar: `مرحلة قاربت الاستحقاق: ${stage.nameAr}`,
        explanation_ar: `المرحلة «${stage.nameAr}» ضمن نافذة التنبيه.`,
        evidence: [
          `المرحلة: ${stage.nameAr}`,
          stage.dueAt ? `موعد الإغلاق: ${stage.dueAt}` : "لا يوجد موعد مخزّن",
        ],
        recommendation_ar: "تابع المسؤول المعيّن قبل حلول الموعد.",
      });
    }

    const openStatuses = ["ready", "in_progress", "waiting_approval"];
    if (openStatuses.includes(stage.engineStatus) && !stage.responsibleLabel) {
      risks.push({
        type: "MISSING_ASSIGNEE",
        severity: "medium",
        title_ar: `بدون مسؤول: ${stage.nameAr}`,
        explanation_ar: "المرحلة النشطة بلا مسؤول ظاهر في السياق المعتمد.",
        evidence: [`المرحلة: ${stage.nameAr}`, `الحالة: ${stage.engineStatus}`],
        recommendation_ar: "عيّن مسؤولاً للمرحلة عبر صلاحيات إدارة الفريق في النظام.",
      });
    }

    if (stage.openApprovalId || stage.visual === "waiting_approval" || stage.engineStatus === "waiting_approval") {
      const ageH = hoursSince(stage.approvalStartedAt, now);
      const longPending = ageH != null && ageH >= AI_LIMITS.pendingApprovalHoursHigh;
      risks.push({
        type: longPending ? "LONG_PENDING_APPROVAL" : "PENDING_APPROVAL",
        severity: longPending ? "high" : "medium",
        title_ar: longPending ? `موافقة معلّقة طويلاً: ${stage.nameAr}` : `موافقة معلّقة: ${stage.nameAr}`,
        explanation_ar: longPending
          ? "توجد موافقة معلّقة تجاوزت حد المتابعة التشغيلية المحسوب في التطبيق."
          : "توجد موافقة معلّقة على المرحلة.",
        evidence: [
          `المرحلة: ${stage.nameAr}`,
          stage.openApprovalTitle ? `الطلب: ${stage.openApprovalTitle}` : "موافقة مفتوحة",
          ageH != null ? `عمر تقريبي بالساعات: ${Math.floor(ageH)}` : "عمر الموافقة غير متاح",
        ],
        recommendation_ar: "راجع الموافقة المعلقة من شاشة الاعتمادات المعتمدة.",
      });
    }

    if (stage.blockReason || stage.visual === "blocked" || stage.engineStatus === "blocked") {
      risks.push({
        type: "BLOCKED_WORKFLOW",
        severity: "high",
        title_ar: `مسار متوقف: ${stage.nameAr}`,
        explanation_ar: stage.blockReason ?? "المرحلة في حالة توقف حسب محرك مسار العمل.",
        evidence: [`المرحلة: ${stage.nameAr}`, stage.blockReason ?? `الحالة: ${stage.engineStatus}`],
        recommendation_ar: "عالج سبب التوقف من شاشة المراحل. الذكاء الاصطناعي لا يُكمل المرحلة.",
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
        title_ar: "تجاوز تاريخ الانتهاء المخطط",
        explanation_ar: "تاريخ الانتهاء المخطط قد مضى بينما العمل غير مكتمل حسب عدّاد المراحل.",
        evidence: [
          `الانتهاء المخطط: ${facts.planned_end_date}`,
          `التقدم: ${facts.completed_stages}/${facts.total_stages}`,
        ],
        recommendation_ar: "راجع خطة الإغلاق أو حدّث التواريخ عبر الإجراءات المعتمدة في النظام.",
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
