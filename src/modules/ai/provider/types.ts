import type { z } from "zod";
import type { Locale } from "@/lib/i18n/config";

export type AiProviderObserve = {
  operation?: string;
  organizationId?: string;
  documentId?: string;
  versionId?: string;
  pipeline?: string;
  promptVersion?: string;
  schemaVersion?: string;
  correlationId?: string;
};

export type AiGenerateTextInput = {
  systemPrompt: string;
  userPayload: string;
  timeoutMs?: number;
  observe?: AiProviderObserve;
  /**
   * Requested output language (Arabic by default). Real providers get the language through the
   * system prompt; the mock provider uses this to pick its canned Arabic or English content.
   */
  locale?: Locale;
};

export type AiGenerateStructuredInput<T> = {
  schemaName: string;
  schema: z.ZodType<T>;
  systemPrompt: string;
  userPayload: string;
  /** See AiGenerateTextInput.locale. */
  locale?: Locale;
  timeoutMs?: number;
  modelKind?: "default" | "document";
  observe?: AiProviderObserve;
  jsonSchema?: Record<string, unknown> | null;
};

export type AiUsageMeta = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

export type AiStructuredResult<T> = {
  value: T;
  usage: AiUsageMeta;
  model: string;
  latencyMs: number;
};

export type AiTextResult = {
  text: string;
  usage: AiUsageMeta;
  model: string;
  latencyMs: number;
};

export type AiProvider = {
  readonly id: "mock" | "openai";
  readonly model: string;
  generateText(input: AiGenerateTextInput): Promise<AiTextResult>;
  generateStructured<T>(input: AiGenerateStructuredInput<T>): Promise<AiStructuredResult<T>>;
};
