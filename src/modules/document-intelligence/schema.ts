import { z } from "zod";

export const extractedFactSchema = z.object({
  value: z.string().min(1).max(2000),
  evidenceRefs: z.array(z.string().min(1).max(64)).max(8),
});

export type ExtractedFact = z.infer<typeof extractedFactSchema>;

export const businessCaseExtractionSchema = z.object({
  documentTitle: extractedFactSchema.nullable().optional(),
  projectName: extractedFactSchema.nullable().optional(),
  summary: z.string().max(4000).default(""),
  objectives: z.array(extractedFactSchema).max(40).default([]),
  deliverables: z.array(extractedFactSchema).max(40).default([]),
  milestones: z.array(extractedFactSchema).max(40).default([]),
  deadlines: z
    .array(
      extractedFactSchema.extend({
        dateYmd: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional(),
      }),
    )
    .max(40)
    .default([]),
  budgetFacts: z.array(extractedFactSchema).max(40).default([]),
  stakeholders: z.array(extractedFactSchema).max(40).default([]),
  assumptions: z.array(extractedFactSchema).max(40).default([]),
  dependencies: z.array(extractedFactSchema).max(40).default([]),
  explicitRisks: z.array(extractedFactSchema).max(40).default([]),
  requiredApprovals: z.array(extractedFactSchema).max(40).default([]),
  actionItems: z.array(extractedFactSchema).max(40).default([]),
  ambiguities: z.array(z.string().max(1000)).max(30).default([]),
});

export type BusinessCaseExtraction = z.infer<typeof businessCaseExtractionSchema>;

export type DocumentChunk = {
  id: string;
  text: string;
  startChar: number;
  endChar: number;
};

export type DocumentTextExtraction = {
  text: string;
  characterCount: number;
  extractionMethod: "txt" | "pdf" | "docx" | "none";
  warnings: string[];
  pageCount: number | null;
};

export type DocumentIntelligenceStatus =
  | "PENDING"
  | "PROCESSING"
  | "EXTRACTED"
  | "VERIFIED"
  | "FAILED"
  | "SUPERSEDED";

export type DocumentIntelligenceType = "BUSINESS_CASE" | "PROJECT_BRIEF" | "GENERAL_PROJECT_DOCUMENT";

export type ComparisonFinding = {
  id: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  titleAr: string;
  titleEn: string;
  explanationAr: string;
  explanationEn: string;
  href: string | null;
};
