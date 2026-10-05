import type { AiProvider } from "../provider/types";
import { assistantAnswerSchema, type AssistantAnswer } from "../schemas";
import { buildAssistantPrompt, AI_PROMPT_VERSIONS } from "../prompts";
import { projectFactsForPrompt } from "../context/project-context";
import type { ProjectAiFacts } from "../health";
import { AI_LIMITS, AI_DISCLAIMER_AR } from "../limits";
import { truncateText } from "../security/sanitize";

const OUT_OF_SCOPE_AR =
  "المساعد الذكي مخصص لذكاء مشاريع ماستر تاتش (الحالة، المسار، المواعيد، الموافقات، المخاطر). لا يجيب عن أسئلة عامة خارج هذا النطاق.";

function looksOutOfScope(question: string): boolean {
  const q = question.toLowerCase();
  const jailbreak = [
    "ignore previous",
    "api key",
    "system prompt",
    "act as administrator",
    "chatgpt",
    "weather",
    "recipe",
  ];
  if (jailbreak.some((h) => q.includes(h))) return true;
  const projectHints = [
    "مشروع",
    "مرحلة",
    "موافق",
    "تأخير",
    "خطر",
    "مستند",
    "موعد",
    "تقدم",
    "deadline",
    "approval",
    "workflow",
    "stage",
  ];
  if (projectHints.some((h) => q.includes(h))) return false;
  return q.length < 8;
}

export async function answerProjectAssistant(input: {
  provider: AiProvider;
  facts: ProjectAiFacts;
  question: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<AssistantAnswer & { disclaimerAr: string; promptVersion: string }> {
  if (looksOutOfScope(input.question) && !input.question.includes("؟") && input.question.length > 40) {
    // still let the model classify; heuristic is only a fast-path for obvious jailbreaks
  }

  const history = (input.history ?? [])
    .slice(-AI_LIMITS.maxAssistantHistoryTurns)
    .map((m) => ({
      role: m.role,
      content: truncateText(m.content, 800).text,
    }));

  const boundedHistory = truncateText(JSON.stringify(history), AI_LIMITS.maxAssistantHistoryChars).text;

  const result = await input.provider.generateStructured({
    schemaName: "assistant",
    schema: assistantAnswerSchema,
    systemPrompt: buildAssistantPrompt(),
    userPayload: JSON.stringify({
      MASTER_TOUCH_CONTEXT: "DATA_ONLY",
      question: truncateText(input.question, AI_LIMITS.maxQuestionChars).text,
      history: boundedHistory,
      facts: {
        project_name_ar: input.facts.project_name_ar,
        project_code: input.facts.project_code,
        project_status: input.facts.project_status,
        current_stage_name: input.facts.current_stage_name,
        completed_stages: input.facts.completed_stages,
        total_stages: input.facts.total_stages,
        planned_end_date: input.facts.planned_end_date,
        stages: input.facts.stages.map((s) => ({
          nameAr: s.nameAr,
          visual: s.visual,
          deadlineState: s.deadlineState,
          dueAt: s.dueAt,
          responsibleLabel: s.responsibleLabel,
          engineStatus: s.engineStatus,
          blockReason: s.blockReason,
        })),
        documents: input.facts.documents,
      },
    }),
  });

  let answer = result.value;
  if (looksOutOfScope(input.question)) {
    answer = { answer_ar: OUT_OF_SCOPE_AR, out_of_scope: true };
  }

  void projectFactsForPrompt;
  return { ...answer, disclaimerAr: AI_DISCLAIMER_AR, promptVersion: AI_PROMPT_VERSIONS.assistant };
}
