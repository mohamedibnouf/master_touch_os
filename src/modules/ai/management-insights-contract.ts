import { z } from "zod";
import { managementInsightSchema } from "./schemas";
import { receivedKind, summarizeZodIssues, type SafeZodIssue } from "./document-analysis-contract";

export const MANAGEMENT_INSIGHTS_SCHEMA_NAME = "management_insights";
export const MANAGEMENT_INSIGHTS_SCHEMA_VERSION = "management-insights:v3";

const STRING_OR_NULL = { anyOf: [{ type: "string" }, { type: "null" }] } as const;

export const MANAGEMENT_INSIGHTS_OPENAI_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "headline_ar",
    "executive_summary_ar",
    "items",
    "observations",
    "recommendations",
    "limitations_ar",
    "generated_at",
    "data_as_of",
  ],
  properties: {
    headline_ar: { type: "string" },
    executive_summary_ar: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title_ar", "explanation_ar", "href"],
        properties: {
          title_ar: { type: "string" },
          explanation_ar: { type: "string" },
          href: STRING_OR_NULL,
        },
      },
    },
    observations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["issue_key", "title_ar", "explanation_ar", "evidence_ref"],
        properties: {
          issue_key: { type: "string" },
          title_ar: { type: "string" },
          explanation_ar: { type: "string" },
          evidence_ref: STRING_OR_NULL,
        },
      },
    },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "priority",
          "problem_ar",
          "evidence_ar",
          "impact_ar",
          "action_ar",
          "owner_role_ar",
          "timeframe_ar",
          "record_ref",
          "href",
        ],
        properties: {
          priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
          problem_ar: { type: "string" },
          evidence_ar: { type: "string" },
          impact_ar: { type: "string" },
          action_ar: { type: "string" },
          owner_role_ar: STRING_OR_NULL,
          timeframe_ar: STRING_OR_NULL,
          record_ref: STRING_OR_NULL,
          href: STRING_OR_NULL,
        },
      },
    },
    limitations_ar: { type: "string" },
    generated_at: { type: "string" },
    data_as_of: { type: "string" },
  },
} as const;

export function managementInsightResponseInstructions(): string {
  return [
    "Return exactly one JSON object with required keys:",
    "headline_ar, executive_summary_ar, items, observations, recommendations, limitations_ar, generated_at, data_as_of.",
    "The output key is items.",
    "items: { title_ar, explanation_ar, href string or null }.",
    "observations: { issue_key, title_ar, explanation_ar, evidence_ref metric key or project id or null }.",
    "recommendations: { priority: critical|high|medium|low, problem_ar, evidence_ar, impact_ar, action_ar, owner_role_ar, timeframe_ar, record_ref, href }.",
    "Copy data_as_of from facts.data_as_of. generated_at must be ISO-8601.",
    "Do not invent counts, percentages, budgets, dates, or projects. Use only MASTER_TOUCH_CONTEXT facts.",
    "timeframe_ar is a recommendation, not a system deadline. owner_role_ar must be from facts.allowed_roles_ar or null.",
    "Empty arrays are required when there is no item. Do not wrap JSON in markdown.",
  ].join(" ");
}

function asItem(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = { ...(raw as Record<string, unknown>) };
  if (typeof rec.title_ar === "string") rec.title_ar = rec.title_ar.trim();
  if (typeof rec.explanation_ar === "string") rec.explanation_ar = rec.explanation_ar.trim();
  if (!("href" in rec) || rec.href === undefined || rec.href === "") rec.href = null;
  return rec;
}

export function normalizeManagementInsightShape(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const rec = { ...(value as Record<string, unknown>) };
  if (typeof rec.headline_ar === "string") rec.headline_ar = rec.headline_ar.trim();
  if (typeof rec.executive_summary_ar === "string") rec.executive_summary_ar = rec.executive_summary_ar.trim();
  if (typeof rec.limitations_ar === "string") rec.limitations_ar = rec.limitations_ar.trim();
  if (typeof rec.generated_at === "string") rec.generated_at = rec.generated_at.trim();
  if (typeof rec.data_as_of === "string") rec.data_as_of = rec.data_as_of.trim();
  if ((!("items" in rec) || rec.items == null) && Array.isArray(rec.insight_items)) {
    rec.items = rec.insight_items;
  }
  if (!("observations" in rec)) rec.observations = [];
  if (!("recommendations" in rec)) rec.recommendations = [];
  if (Array.isArray(rec.items)) rec.items = rec.items.map((item) => asItem(item) ?? item);
  return rec;
}

export function validateManagementInsightPayload(raw: unknown):
  | { ok: true; value: z.infer<typeof managementInsightSchema> }
  | { ok: false; issues: SafeZodIssue[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      issues: [{ path: "(root)", code: "invalid_type", expected: "object", received: receivedKind(raw) }],
    };
  }
  const parsed = managementInsightSchema.safeParse(normalizeManagementInsightShape(raw));
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, issues: summarizeZodIssues(parsed.error) };
}
