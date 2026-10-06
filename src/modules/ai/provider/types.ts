import type { z } from "zod";

export type AiProviderObserve = {
  operation?: string;
  organizationId?: string;
  documentId?: string;
  versionId?: string;
};

export type AiGenerateTextInput = {
  systemPrompt: string;
  userPayload: string;
  timeoutMs?: number;
  observe?: AiProviderObserve;
};

export type AiGenerateStructuredInput<T> = {
  schemaName: string;
  schema: z.ZodType<T>;
  systemPrompt: string;
  userPayload: string;
  timeoutMs?: number;
  modelKind?: "default" | "document";
  observe?: AiProviderObserve;
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
