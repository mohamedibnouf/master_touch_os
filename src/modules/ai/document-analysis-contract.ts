import { z } from "zod";
import { documentAnalysisSchema, businessCaseAnalysisSchema } from "./schemas";

/** OpenAI Structured Outputs name: letters, numbers, underscore only. */
export const DOCUMENT_ANALYSIS_SCHEMA_NAME = "document_analysis";
export const BUSINESS_CASE_SCHEMA_NAME = "business_case_analysis";

const STRING_ARRAY = {
  type: "array",
  items: { type: "string" },
} as const;

/**
 * Canonical JSON Schema for document analysis.
 * Mirrors `documentAnalysisSchema`. Source of truth for prompt + Structured Outputs.
 * Server still validates with Zod.
 */
export const DOCUMENT_ANALYSIS_OPENAI_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary_ar",
    "key_points",
    "obligations",
    "dates",
    "risks",
    "missing_information",
    "management_questions",
    "citations",
  ],
  properties: {
    summary_ar: { type: "string" },
    key_points: STRING_ARRAY,
    obligations: STRING_ARRAY,
    dates: STRING_ARRAY,
    risks: STRING_ARRAY,
    missing_information: STRING_ARRAY,
    management_questions: STRING_ARRAY,
    citations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label_ar", "page"],
        properties: {
          label_ar: { type: "string" },
          page: { type: ["integer", "null"] },
        },
      },
    },
  },
} as const;

const BC_STRING_ARRAY = STRING_ARRAY;

export const BUSINESS_CASE_OPENAI_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "executive_summary_ar",
    "project_objectives",
    "scope_items",
    "key_requirements",
    "stakeholders",
    "important_dates",
    "dependencies",
    "risks",
    "assumptions",
    "missing_information",
    "management_questions",
    "recommended_followups",
  ],
  properties: {
    executive_summary_ar: { type: "string" },
    project_objectives: BC_STRING_ARRAY,
    scope_items: BC_STRING_ARRAY,
    key_requirements: BC_STRING_ARRAY,
    stakeholders: BC_STRING_ARRAY,
    important_dates: BC_STRING_ARRAY,
    dependencies: BC_STRING_ARRAY,
    risks: BC_STRING_ARRAY,
    assumptions: BC_STRING_ARRAY,
    missing_information: BC_STRING_ARRAY,
    management_questions: BC_STRING_ARRAY,
    recommended_followups: BC_STRING_ARRAY,
  },
} as const;

const DOCUMENT_ARRAY_KEYS = [
  "key_points",
  "obligations",
  "dates",
  "risks",
  "missing_information",
  "management_questions",
  "citations",
] as const;

export function documentAnalysisResponseInstructions(): string {
  return [
    "Return exactly one JSON object with these required keys:",
    "summary_ar (non-empty string, Arabic preferred),",
    "key_points, obligations, dates, risks, missing_information, management_questions (arrays of strings; use [] when none),",
    "citations (array of objects { label_ar: string, page: integer or null }).",
    "risks must be strings, never objects.",
    "Do not omit keys. Do not wrap JSON in markdown fences.",
  ].join(" ");
}

export function extractChatMessageContent(message: { content?: unknown } | undefined): string | null {
  const content = message?.content;
  if (typeof content === "string") {
    const trimmed = content.trim();
    return trimmed.length ? trimmed : null;
  }
  if (Array.isArray(content)) {
    const parts = content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part && typeof (part as { text?: unknown }).text === "string") {
          return (part as { text: string }).text;
        }
        return "";
      })
      .join("");
    const trimmed = parts.trim();
    return trimmed.length ? trimmed : null;
  }
  return null;
}

export function stripMarkdownJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function receivedKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export type SafeZodIssue = {
  path: string;
  code: string;
  expected: string | null;
  received: string;
};

export function summarizeZodIssues(error: z.ZodError): SafeZodIssue[] {
  return error.issues.slice(0, 20).map((issue) => {
    const rec = issue as { code: string; path: PropertyKey[]; expected?: unknown; message?: string };
    const receivedMatch = typeof rec.message === "string" ? rec.message.match(/received ([A-Za-z]+)/i) : null;
    return {
      path: rec.path.map(String).join(".") || "(root)",
      code: rec.code,
      expected: typeof rec.expected === "string" ? rec.expected : null,
      received: receivedMatch?.[1]?.toLowerCase() ?? receivedKind("input" in issue ? (issue as { input?: unknown }).input : undefined),
    };
  });
}

export function normalizeDocumentAnalysisShape(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const rec = { ...(value as Record<string, unknown>) };
  if (typeof rec.summary_ar === "string") rec.summary_ar = rec.summary_ar.trim();
  for (const key of DOCUMENT_ARRAY_KEYS) {
    if (!(key in rec) || rec[key] == null) rec[key] = [];
  }
  if (Array.isArray(rec.citations)) {
    rec.citations = rec.citations.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const citation = { ...(item as Record<string, unknown>) };
      if (!("page" in citation) || citation.page === undefined) citation.page = null;
      if (typeof citation.label_ar === "string") citation.label_ar = citation.label_ar.trim();
      return citation;
    });
  }
  return rec;
}

export function parseDocumentAnalysisJson(raw: string): { ok: true; value: unknown } | { ok: false; reason: "empty" | "json" } {
  const stripped = stripMarkdownJsonFence(raw);
  if (!stripped) return { ok: false, reason: "empty" };
  try {
    return { ok: true, value: JSON.parse(stripped) };
  } catch {
    return { ok: false, reason: "json" };
  }
}

export function validateDocumentAnalysisPayload(raw: unknown):
  | { ok: true; value: z.infer<typeof documentAnalysisSchema> }
  | { ok: false; issues: SafeZodIssue[] } {
  const normalized = normalizeDocumentAnalysisShape(raw);
  const parsed = documentAnalysisSchema.safeParse(normalized);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, issues: summarizeZodIssues(parsed.error) };
}

export function validateBusinessCasePayload(raw: unknown):
  | { ok: true; value: z.infer<typeof businessCaseAnalysisSchema> }
  | { ok: false; issues: SafeZodIssue[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, issues: [{ path: "(root)", code: "invalid_type", expected: "object", received: receivedKind(raw) }] };
  }
  const rec = { ...(raw as Record<string, unknown>) };
  const keys = BUSINESS_CASE_OPENAI_JSON_SCHEMA.required;
  for (const key of keys) {
    if (key === "executive_summary_ar") {
      if (typeof rec[key] === "string") rec[key] = rec[key].trim();
      continue;
    }
    if (!(key in rec) || rec[key] == null) rec[key] = [];
  }
  const parsed = businessCaseAnalysisSchema.safeParse(rec);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, issues: summarizeZodIssues(parsed.error) };
}

export function jsonSchemaForStructuredName(schemaName: string): Record<string, unknown> | null {
  if (schemaName === "document-analysis") return DOCUMENT_ANALYSIS_OPENAI_JSON_SCHEMA as unknown as Record<string, unknown>;
  if (schemaName === "business-case") return BUSINESS_CASE_OPENAI_JSON_SCHEMA as unknown as Record<string, unknown>;
  return null;
}
