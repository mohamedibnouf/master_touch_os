import { ValidationError } from "@/lib/errors";
import type {
  AiGenerateStructuredInput,
  AiGenerateTextInput,
  AiProvider,
  AiStructuredResult,
  AiTextResult,
} from "./types";

function usage() {
  return { promptTokens: 12, completionTokens: 40, totalTokens: 52 };
}

function factsFromPayload(userPayload: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(userPayload) as Record<string, unknown>;
    const facts = parsed.facts;
    if (facts && typeof facts === "object") return facts as Record<string, unknown>;
    return parsed;
  } catch {
    return {};
  }
}

function mockForSchema(schemaName: string, facts: Record<string, unknown>): unknown {
  const now = typeof facts.generated_at === "string" ? facts.generated_at : new Date().toISOString();
  const health = typeof facts.health === "string" ? facts.health : "attention";
  const stage = typeof facts.current_stage_name === "string" ? facts.current_stage_name : "المرحلة الحالية";
  const completed = Number(facts.completed_stages ?? 0);
  const total = Number(facts.total_stages ?? 0);
  const projectName = typeof facts.project_name_ar === "string" ? facts.project_name_ar : "المشروع";

  if (schemaName === "project-intelligence") {
    return {
      health,
      summary_ar: `ملخص حالة ${projectName} استناداً إلى بيانات النظام المعتمدة.`,
      progress_summary_ar: `تم إنجاز ${completed} من أصل ${total} مراحل.`,
      current_stage_summary_ar: `المرحلة الحالية: ${stage}.`,
      blockers: Array.isArray(facts.blocker_titles) ? facts.blocker_titles : [],
      risks: Array.isArray(facts.risk_titles) ? facts.risk_titles : [],
      pending_decisions: Array.isArray(facts.pending_titles) ? facts.pending_titles : [],
      recommended_actions: ["راجع الإشارات التشغيلية الظاهرة في بيانات المشروع.", "لا يُنفَّذ أي إجراء تلقائي من التحليل."],
      generated_at: now,
    };
  }

  if (schemaName === "risk-explanation") {
    return {
      explanations: Array.isArray(facts.risks)
        ? (facts.risks as Array<{ type?: string; title_ar?: string }>).map((r) => ({
            type: r.type ?? "BLOCKED_WORKFLOW",
            explanation_ar: `تفسير مستند إلى بيانات النظام: ${r.title_ar ?? "إشارة مخاطر"}.`,
            recommendation_ar: "راجع السجل التشغيلي واتخذ الإجراء من شاشات النظام المعتمدة.",
          }))
        : [],
    };
  }

  if (schemaName === "assistant") {
    return {
      answer_ar: `إجابة المساعد مبنية فقط على سياق المشروع المعتمد. المرحلة الحالية: ${stage}. التقدم: ${completed}/${total}.`,
      out_of_scope: false,
    };
  }

  if (schemaName === "document-analysis") {
    return {
      summary_ar: "ملخص المستند من النص المستخرج فقط.",
      key_points: ["نقطة مستخرجة من النص المتاح."],
      obligations: [],
      dates: [],
      risks: [],
      missing_information: ["قد توجد معلومات غير مذكورة صراحة في النص."],
      management_questions: ["ما القرار الإداري المطلوب بناءً على هذا المستند؟"],
      citations: Array.isArray(facts.citation_pages) ? facts.citation_pages : [],
    };
  }

  if (schemaName === "business-case") {
    return {
      executive_summary_ar: "ملخص تنفيذي مستخرج من نص دراسة الحالة فقط.",
      project_objectives: ["هدف مذكور في النص إن وُجد."],
      scope_items: [],
      key_requirements: [],
      stakeholders: [],
      important_dates: [],
      dependencies: [],
      risks: [],
      assumptions: [],
      missing_information: ["تعذر استكمال بعض الحقول من النص المتاح."],
      management_questions: ["ما نطاق المشروع المعتمد بعد مراجعة الدراسة؟"],
      recommended_followups: ["مراجعة بشرية للحقول المستخرجة قبل الاعتماد."],
    };
  }

  if (schemaName === "executive-report") {
    return {
      executive_summary_ar: `تقرير إداري لمشروع ${projectName}.`,
      project_status_ar: typeof facts.project_status_ar === "string" ? facts.project_status_ar : "نشط",
      progress_narrative_ar: `تم إنجاز ${completed} مراحل من أصل ${total}.`,
      current_stage_ar: stage,
      overdue_stages_ar: Array.isArray(facts.overdue_stage_names) ? facts.overdue_stage_names : [],
      important_dates_ar: Array.isArray(facts.important_dates) ? facts.important_dates : [],
      pending_approvals_ar: Array.isArray(facts.pending_approval_titles) ? facts.pending_approval_titles : [],
      risks_ar: Array.isArray(facts.risk_titles) ? facts.risk_titles : [],
      required_decisions_ar: ["لا قرارات تنفيذية صادرة عن الذكاء الاصطناعي."],
      recommendations_ar: ["راجع المراحل والموافقات من شاشات المشروع."],
      next_steps_ar: ["متابعة المرحلة الحالية عبر مسار العمل المعتمد."],
      generated_at: now,
      data_as_of: typeof facts.data_as_of === "string" ? facts.data_as_of : now,
    };
  }

  if (schemaName === "management-insights") {
    const items = Array.isArray(facts.insight_items) ? facts.insight_items : [];
    return {
      headline_ar: "رؤى إدارية مبنية على إشارات تشغيلية محسوبة.",
      executive_summary_ar: "الملخص مبني على المقاييس الحتمية المزوّدة دون اختراع أرقام.",
      items,
      observations: [],
      recommendations: [],
      limitations_ar: "التحليل استشاري ويعتمد على العينة المصرّح بها.",
      generated_at: now,
      data_as_of: typeof facts.data_as_of === "string" ? facts.data_as_of : now,
    };
  }

  return { summary_ar: "استجابة تجريبية.", generated_at: now };
}

export function createMockAiProvider(): AiProvider {
  return {
    id: "mock",
    model: "mock-v1",
    async generateText(input: AiGenerateTextInput): Promise<AiTextResult> {
      const facts = factsFromPayload(input.userPayload);
      const stage = typeof facts.current_stage_name === "string" ? facts.current_stage_name : "غير محددة";
      return {
        text: `المساعد مخصص لذكاء مشاريع ماستر تاتش. المرحلة الحالية حسب السياق: ${stage}.`,
        usage: usage(),
        model: "mock-v1",
        latencyMs: 8,
      };
    },
    async generateStructured<T>(input: AiGenerateStructuredInput<T>): Promise<AiStructuredResult<T>> {
      const facts = factsFromPayload(input.userPayload);
      const raw = mockForSchema(input.schemaName, facts);
      const parsed = input.schema.safeParse(raw);
      if (!parsed.success) {
        throw new ValidationError("استجابة المزود التجريبي غير مطابقة للمخطط.", "Mock provider output failed schema.");
      }
      return { value: parsed.data, usage: usage(), model: "mock-v1", latencyMs: 8 };
    },
  };
}

/** Test helper: provider that returns unparseable / invalid structured output. */
export function createInvalidStructuredMockProvider(): AiProvider {
  return {
    id: "mock",
    model: "mock-invalid",
    async generateText(): Promise<AiTextResult> {
      return { text: "x", usage: usage(), model: "mock-invalid", latencyMs: 1 };
    },
    async generateStructured<T>(input: AiGenerateStructuredInput<T>): Promise<AiStructuredResult<T>> {
      const parsed = input.schema.safeParse({ not: "valid" });
      if (!parsed.success) {
        throw new ValidationError("تعذر قراءة استجابة التحليل.", "Could not parse analysis response.");
      }
      return { value: parsed.data, usage: usage(), model: "mock-invalid", latencyMs: 1 };
    },
  };
}

export function createUnavailableMockProvider(): AiProvider {
  return {
    id: "mock",
    model: "mock-down",
    async generateText() {
      const { AppError } = await import("@/lib/errors");
      throw new AppError({
        code: "INTERNAL",
        status: 502,
        message: "provider down",
        userMessageAr: "تعذر إكمال التحليل حالياً. حاول مرة أخرى.",
        userMessageEn: "unavailable",
      });
    },
    async generateStructured() {
      const { AppError } = await import("@/lib/errors");
      throw new AppError({
        code: "INTERNAL",
        status: 504,
        message: "timeout",
        userMessageAr: "تعذر إكمال التحليل حالياً. حاول مرة أخرى.",
        userMessageEn: "timeout",
      });
    },
  };
}
