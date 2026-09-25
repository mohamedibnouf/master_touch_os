import { z } from "zod";
import { MANAGEMENT_AI_LIMITS as L } from "./limits";

export const managementAIModeSchema = z.enum([
  "executive_brief",
  "attention",
  "project_risks",
  "approvals",
  "procurement",
  "commercial",
  "people",
  "payroll",
  "meeting_brief",
  "free_question",
]);

export type ManagementAIMode = z.infer<typeof managementAIModeSchema>;

export const managementAIRequestSchema = z.object({
  mode: managementAIModeSchema,
  question: z
    .string()
    .trim()
    .max(L.maxQuestionChars)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  locale: z.enum(["ar", "en"]).default("ar"),
});

export type ManagementAIRequest = z.infer<typeof managementAIRequestSchema>;

/** Raw provider JSON before citation verification. */
export const managementAIRawResponseSchema = z.object({
  summary: z.string().min(1).max(4000),
  findings: z
    .array(
      z.object({
        title: z.string().min(1).max(300),
        explanation: z.string().min(1).max(2000),
        severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
        sourceRefs: z.array(z.string().min(1).max(64)).max(12),
        /** Must never invent a new official risk severity override. */
        isOfficialRisk: z.boolean().optional(),
      }),
    )
    .max(L.maxResponseFindings),
  suggestedReviews: z
    .array(
      z.object({
        label: z.string().min(1).max(300),
        sourceRefs: z.array(z.string().min(1).max(64)).max(8),
      }),
    )
    .max(L.maxSuggestedReviews),
  limitations: z.array(z.string().max(500)).max(12),
});

export type ManagementAIRawResponse = z.infer<typeof managementAIRawResponseSchema>;

export type ManagementAISourceRef = {
  id: string;
  kind: "risk" | "metric" | "brief" | "activity" | "project" | "approval";
  labelAr: string;
  labelEn: string;
  href: string | null;
  /** Official RiskFinding severity when kind=risk — authoritative. */
  officialSeverity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
};

export type ManagementAITrustedContext = {
  asOfDate: string;
  generatedAt: string;
  organizationNameAr: string;
  organizationNameEn: string;
  locale: "ar" | "en";
  mode: ManagementAIMode;
  question: string | null;
  /** Compact JSON-safe payload sent to the model (DATA only). */
  data: Record<string, unknown>;
  /** Registry for citation verification — never invent IDs outside this map. */
  sources: Record<string, ManagementAISourceRef>;
  limitations: string[];
};

export type ManagementAIFindingView = {
  title: string;
  explanation: string;
  /** Presentational severity hint from model — never overrides official risk. */
  severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  /** True only when finding cites an official RiskFinding and severity matches. */
  isOfficialRisk: boolean;
  sources: Array<{ id: string; label: string; href: string | null }>;
};

export type ManagementAIReviewView = {
  label: string;
  href: string | null;
  sources: Array<{ id: string; label: string; href: string | null }>;
};

export type ManagementAIResult = {
  summary: string;
  findings: ManagementAIFindingView[];
  suggestedReviews: ManagementAIReviewView[];
  limitations: string[];
  asOfDate: string;
  generatedAt: string;
  provider: string;
  model: string | null;
  disclaimerAr: string;
  disclaimerEn: string;
};

export type ManagementAIProviderInput = {
  systemPrompt: string;
  userPayload: string;
  locale: "ar" | "en";
};

export type ManagementAIProvider = {
  readonly id: string;
  readonly model: string | null;
  analyze(input: ManagementAIProviderInput): Promise<ManagementAIRawResponse>;
};
