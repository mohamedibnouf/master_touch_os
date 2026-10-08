import { z } from "zod";
import { managementInsightSchema } from "./schemas";
import { receivedKind, summarizeZodIssues, type SafeZodIssue } from "./document-analysis-contract";

/** OpenAI Structured Outputs name: letters, numbers, underscore only. */
export const MANAGEMENT_INSIGHTS_SCHEMA_NAME = "management_insights";
export const MANAGEMENT_INSIGHTS_SCHEMA_VERSION = "management-insights:v2";

export const MANAGEMENT_INSIGHTS_OPENAI_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline_ar", "items", "generated_at", "data_as_of"],
  properties: {
    headline_ar: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title_ar", "explanation_ar", "href"],
        properties: {
          title_ar: { type: "string" },
          explanation_ar: { type: "string" },
          href: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
      },
    },
    generated_at: { type: "string" },
    data_as_of: { type: "string" },
  },
} as const;

export function managementInsightResponseInstructions(): string {
  return [
    "Return exactly one JSON object with these required keys:",
    "headline_ar (non-empty Arabic string explaining the supplied counts),",
    "items (array of objects { title_ar: string, explanation_ar: string, href: string or null }; max 8; use [] when none),",
    "generated_at (ISO-8601 timestamp string),",
    "data_as_of (copy facts.data_as_of exactly).",
    "Do not use insight_items as the output key. The output key is items.",
    "Do not invent projects, counts, or recommendations beyond explaining the supplied facts.",
    "Do not omit keys. Do not wrap JSON in markdown fences.",
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

/**
 * Safe, explicit shape alignment only:
 * - insight_items → items (model echoing the facts payload key)
 * - missing items → []
 * - omitted/empty href → null
 * - trim Arabic strings
 * Does not invent headline_ar or project recommendations.
 */
export function normalizeManagementInsightShape(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const rec = { ...(value as Record<string, unknown>) };
  if (typeof rec.headline_ar === "string") rec.headline_ar = rec.headline_ar.trim();
  if (typeof rec.generated_at === "string") rec.generated_at = rec.generated_at.trim();
  if (typeof rec.data_as_of === "string") rec.data_as_of = rec.data_as_of.trim();
  if ((!("items" in rec) || rec.items == null) && Array.isArray(rec.insight_items)) {
    rec.items = rec.insight_items;
  }
  if (Array.isArray(rec.items)) {
    rec.items = rec.items.map((item) => asItem(item) ?? item);
  }
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
