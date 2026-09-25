import { daysBetweenYmd } from "@/modules/management/risk/date-utils";
import type { BusinessCaseExtraction, ComparisonFinding } from "./schema";

export type OperationalProjectSnapshot = {
  id: string;
  projectCode: string;
  nameAr: string;
  status: string;
  plannedEndDate: string | null;
  startDate: string | null;
  budget: number | null;
  contractValue: number | null;
};

/**
 * Deterministic comparison of VERIFIED Business Case facts vs operational project fields.
 * Does not invent missing mappings.
 */
export function compareBusinessCaseToProject(input: {
  extraction: BusinessCaseExtraction;
  project: OperationalProjectSnapshot | null;
  asOfDate: string;
}): ComparisonFinding[] {
  const out: ComparisonFinding[] = [];
  const { extraction: ex, project, asOfDate } = input;

  if (!project) {
    out.push({
      id: "no-project-link",
      severity: "LOW",
      titleAr: "لا يوجد مشروع تشغيلي مرتبط",
      titleEn: "No linked operational project",
      explanationAr: "المستند غير مرتبط بمشروع، لذلك لا تتوفر مقارنة حتمية للحقول التشغيلية.",
      explanationEn: "Document is not linked to a project, so operational field comparison is unavailable.",
      href: null,
    });
    return out;
  }

  const href = `/projects/${project.id}`;

  // Deadline vs planned_end_date
  const dated = ex.deadlines.filter((d) => d.dateYmd);
  if (dated.length === 0) {
    // no deterministic deadline comparison
  } else if (!project.plannedEndDate) {
    out.push({
      id: "deadline-no-planned-end",
      severity: "MEDIUM",
      titleAr: "موعد في دراسة الحالة بلا planned_end_date تشغيلي",
      titleEn: "Business Case deadline without operational planned_end_date",
      explanationAr: `دراسة الحالة تذكر موعداً (${dated[0]!.dateYmd}) بينما المشروع ${project.projectCode} بلا planned_end_date.`,
      explanationEn: `Business Case states deadline ${dated[0]!.dateYmd} but project ${project.projectCode} has no planned_end_date.`,
      href,
    });
  } else {
    for (const d of dated.slice(0, 5)) {
      const delta = daysBetweenYmd(d.dateYmd!, project.plannedEndDate);
      if (delta === 0) continue;
      const abs = Math.abs(delta);
      out.push({
        id: `deadline-delta-${d.dateYmd}`,
        severity: abs >= 14 ? "HIGH" : "MEDIUM",
        titleAr: "اختلاف بين موعد دراسة الحالة وتاريخ الانتهاء المخطط",
        titleEn: "Business Case deadline differs from planned_end_date",
        explanationAr:
          delta > 0
            ? `planned_end_date التشغيلي (${project.plannedEndDate}) بعد موعد دراسة الحالة (${d.dateYmd}) بـ ${delta} يوماً.`
            : `planned_end_date التشغيلي (${project.plannedEndDate}) قبل موعد دراسة الحالة (${d.dateYmd}) بـ ${abs} يوماً.`,
        explanationEn:
          delta > 0
            ? `Operational planned_end_date (${project.plannedEndDate}) is ${delta} days later than verified Business Case deadline (${d.dateYmd}).`
            : `Operational planned_end_date (${project.plannedEndDate}) is ${abs} days earlier than verified Business Case deadline (${d.dateYmd}).`,
        href,
      });
    }
  }

  // Past verified deadline while project still open
  for (const d of dated.slice(0, 5)) {
    if (!d.dateYmd) continue;
    const overdue = daysBetweenYmd(d.dateYmd, asOfDate);
    if (overdue >= 1 && ["active", "on_hold"].includes(project.status)) {
      out.push({
        id: `deadline-past-${d.dateYmd}`,
        severity: overdue >= 14 ? "HIGH" : "MEDIUM",
        titleAr: "موعد دراسة الحالة مضى والمشروع ما زال مفتوحاً",
        titleEn: "Verified Business Case deadline has passed while project remains open",
        explanationAr: `الموعد الموثّق ${d.dateYmd} مضى منذ ${overdue} يوماً والمشروع ${project.projectCode} بحالة ${project.status}.`,
        explanationEn: `Verified deadline ${d.dateYmd} was ${overdue} days ago and project ${project.projectCode} is still ${project.status}.`,
        href,
      });
    }
  }

  // Deliverables — no structured system mapping in V1
  if (ex.deliverables.length > 0) {
    out.push({
      id: "deliverables-no-mapping",
      severity: "LOW",
      titleAr: "لا يوجد ربط حتمي للمخرجات",
      titleEn: "No deterministic deliverable mapping",
      explanationAr: `دراسة الحالة تذكر ${ex.deliverables.length} مخرجاً، ولا يتوفر نموذج تشغيلي حتمي لربطها بسجلات النظام — لا يُستنتج أنها مفقودة.`,
      explanationEn: `Business Case lists ${ex.deliverables.length} deliverable(s); no deterministic operational mapping exists — do not claim they are missing.`,
      href,
    });
  }

  // Budget facts — only compare when operational budget exists AND extraction mentions explicit numbers is hard;
  // Prefer stating presence without inventing equality.
  if (ex.budgetFacts.length > 0 && project.budget == null && project.contractValue == null) {
    out.push({
      id: "budget-facts-no-ops",
      severity: "MEDIUM",
      titleAr: "وقائع ميزانية في دراسة الحالة بلا ميزانية تشغيلية",
      titleEn: "Budget facts in Business Case without operational budget fields",
      explanationAr: `دراسة الحالة تتضمن ${ex.budgetFacts.length} واقعة ميزانية بينما حقول budget/contract_value للمشروع فارغة.`,
      explanationEn: `Business Case has ${ex.budgetFacts.length} budget fact(s) while project budget/contract_value are empty.`,
      href,
    });
  }

  return out;
}
