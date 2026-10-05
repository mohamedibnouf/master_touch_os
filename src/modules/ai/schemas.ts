import { z } from "zod";

export const aiHealthSchema = z.enum(["healthy", "attention", "at_risk", "critical"]);
export type AiHealth = z.infer<typeof aiHealthSchema>;

export const aiSeveritySchema = z.enum(["low", "medium", "high", "critical"]);
export type AiSeverity = z.infer<typeof aiSeveritySchema>;

export const aiRiskTypeSchema = z.enum([
  "OVERDUE_STAGE",
  "DUE_SOON",
  "PENDING_APPROVAL",
  "LONG_PENDING_APPROVAL",
  "MISSING_ASSIGNEE",
  "PROJECT_END_DATE_RISK",
  "BLOCKED_WORKFLOW",
]);
export type AiRiskType = z.infer<typeof aiRiskTypeSchema>;

export const projectIntelligenceSchema = z.object({
  health: aiHealthSchema,
  summary_ar: z.string().min(1).max(2000),
  progress_summary_ar: z.string().min(1).max(1000),
  current_stage_summary_ar: z.string().min(1).max(1000),
  blockers: z.array(z.string().max(400)).max(12),
  risks: z.array(z.string().max(400)).max(12),
  pending_decisions: z.array(z.string().max(400)).max(12),
  recommended_actions: z.array(z.string().max(400)).max(12),
  generated_at: z.string().min(1).max(40),
});
export type ProjectIntelligence = z.infer<typeof projectIntelligenceSchema>;

export const riskExplanationSchema = z.object({
  explanations: z
    .array(
      z.object({
        type: aiRiskTypeSchema,
        explanation_ar: z.string().min(1).max(1200),
        recommendation_ar: z.string().min(1).max(800),
      }),
    )
    .max(20),
});
export type RiskExplanation = z.infer<typeof riskExplanationSchema>;

export const deterministicRiskSchema = z.object({
  type: aiRiskTypeSchema,
  severity: aiSeveritySchema,
  title_ar: z.string().min(1).max(300),
  explanation_ar: z.string().min(1).max(1200),
  evidence: z.array(z.string().max(400)).max(12),
  recommendation_ar: z.string().min(1).max(800),
});
export type DeterministicRisk = z.infer<typeof deterministicRiskSchema>;

export const assistantAnswerSchema = z.object({
  answer_ar: z.string().min(1).max(4000),
  out_of_scope: z.boolean(),
});
export type AssistantAnswer = z.infer<typeof assistantAnswerSchema>;

export const documentCitationSchema = z.object({
  label_ar: z.string().max(200),
  page: z.number().int().positive().nullable(),
});

export const documentAnalysisSchema = z.object({
  summary_ar: z.string().min(1).max(3000),
  key_points: z.array(z.string().max(500)).max(20),
  obligations: z.array(z.string().max(500)).max(20),
  dates: z.array(z.string().max(300)).max(20),
  risks: z.array(z.string().max(500)).max(20),
  missing_information: z.array(z.string().max(500)).max(20),
  management_questions: z.array(z.string().max(500)).max(16),
  citations: z.array(documentCitationSchema).max(20),
});
export type DocumentAnalysis = z.infer<typeof documentAnalysisSchema>;

export const businessCaseAnalysisSchema = z.object({
  executive_summary_ar: z.string().min(1).max(3000),
  project_objectives: z.array(z.string().max(400)).max(20),
  scope_items: z.array(z.string().max(400)).max(20),
  key_requirements: z.array(z.string().max(400)).max(20),
  stakeholders: z.array(z.string().max(200)).max(20),
  important_dates: z.array(z.string().max(300)).max(20),
  dependencies: z.array(z.string().max(400)).max(16),
  risks: z.array(z.string().max(400)).max(16),
  assumptions: z.array(z.string().max(400)).max(16),
  missing_information: z.array(z.string().max(400)).max(16),
  management_questions: z.array(z.string().max(400)).max(16),
  recommended_followups: z.array(z.string().max(400)).max(16),
});
export type BusinessCaseAnalysis = z.infer<typeof businessCaseAnalysisSchema>;

export const executiveReportSchema = z.object({
  executive_summary_ar: z.string().min(1).max(3000),
  project_status_ar: z.string().min(1).max(400),
  progress_narrative_ar: z.string().min(1).max(800),
  current_stage_ar: z.string().min(1).max(400),
  overdue_stages_ar: z.array(z.string().max(300)).max(20),
  important_dates_ar: z.array(z.string().max(300)).max(20),
  pending_approvals_ar: z.array(z.string().max(400)).max(20),
  risks_ar: z.array(z.string().max(400)).max(20),
  required_decisions_ar: z.array(z.string().max(400)).max(16),
  recommendations_ar: z.array(z.string().max(400)).max(16),
  next_steps_ar: z.array(z.string().max(400)).max(16),
  generated_at: z.string().min(1).max(40),
  data_as_of: z.string().min(1).max(40),
});
export type ExecutiveReport = z.infer<typeof executiveReportSchema>;

export const managementInsightItemSchema = z.object({
  title_ar: z.string().min(1).max(300),
  explanation_ar: z.string().min(1).max(800),
  href: z.string().max(300).nullable(),
});

export const managementInsightSchema = z.object({
  headline_ar: z.string().min(1).max(400),
  items: z.array(managementInsightItemSchema).max(8),
  generated_at: z.string().min(1).max(40),
  data_as_of: z.string().min(1).max(40),
});
export type ManagementInsight = z.infer<typeof managementInsightSchema>;

export type ManagementInsightFacts = {
  followUpProjects: number;
  overdueStages: number;
  pendingApprovals: number;
  projectNotes: Array<{ id: string; nameAr: string; reasonAr: string; href: string }>;
  dataAsOf: string;
};

export type ProjectIntelligenceView = {
  intelligence: ProjectIntelligence;
  health: AiHealth;
  risks: DeterministicRisk[];
  facts: {
    completed_stages: number;
    total_stages: number;
    progress_percent: number;
    current_stage_name: string | null;
    planned_end_date: string | null;
  };
  cached: boolean;
  generatedAt: string;
  dataAsOf: string;
  disclaimerAr: string;
  promptVersion: string;
};

export const assistantRequestSchema = z.object({
  projectId: z.string().uuid(),
  question: z.string().trim().min(1).max(800),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(2000),
      }),
    )
    .max(6)
    .optional(),
});

export const projectIdRequestSchema = z.object({
  projectId: z.string().uuid(),
});

export const documentIdRequestSchema = z.object({
  documentId: z.string().uuid(),
  analysisType: z.enum(["document", "business_case"]).optional(),
});
