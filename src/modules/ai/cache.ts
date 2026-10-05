import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";

export type AiArtifactKind =
  | "project_intelligence"
  | "executive_report"
  | "document_analysis"
  | "business_case"
  | "management_insights";

type MemoryEntry = { hash: string; payload: unknown; createdAt: string };
const memory = new Map<string, MemoryEntry>();

export function hashAiInput(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function memKey(orgId: string, kind: string, targetId: string): string {
  return `${orgId}:${kind}:${targetId}`;
}

export function getCachedAiArtifact<T>(input: {
  organizationId: string;
  kind: AiArtifactKind;
  targetId: string;
  inputHash: string;
}): { payload: T; createdAt: string } | null {
  const hit = memory.get(memKey(input.organizationId, input.kind, input.targetId));
  if (!hit || hit.hash !== input.inputHash) return null;
  return { payload: hit.payload as T, createdAt: hit.createdAt };
}

export function setCachedAiArtifact(input: {
  organizationId: string;
  kind: AiArtifactKind;
  targetId: string;
  inputHash: string;
  payload: unknown;
}): string {
  const createdAt = new Date().toISOString();
  memory.set(memKey(input.organizationId, input.kind, input.targetId), {
    hash: input.inputHash,
    payload: input.payload,
    createdAt,
  });
  return createdAt;
}

export function clearAiCacheForTests(): void {
  memory.clear();
}

/**
 * Best-effort persistence. Missing tables (migration 075 not applied) are ignored.
 * Never stores raw prompts or credentials.
 */
export async function persistAiRun(input: {
  supabase: SupabaseClient;
  organizationId: string;
  actorUserId: string;
  projectId?: string | null;
  documentId?: string | null;
  analysisType: string;
  provider: string;
  model: string | null;
  promptVersion: string;
  status: "succeeded" | "failed";
  latencyMs: number;
  inputChars: number;
  outputChars: number;
  promptTokens: number | null;
  completionTokens: number | null;
  errorCategory?: string | null;
  artifactKind?: AiArtifactKind | null;
  artifact?: unknown;
  inputHash?: string | null;
}): Promise<void> {
  try {
    const { error } = await input.supabase.from("ai_runs").insert({
      organization_id: input.organizationId,
      actor_user_id: input.actorUserId,
      project_id: input.projectId ?? null,
      document_id: input.documentId ?? null,
      analysis_type: input.analysisType,
      provider: input.provider,
      model: input.model,
      prompt_version: input.promptVersion,
      status: input.status,
      latency_ms: input.latencyMs,
      input_chars_estimate: input.inputChars,
      output_chars_estimate: input.outputChars,
      prompt_tokens: input.promptTokens,
      completion_tokens: input.completionTokens,
      error_category: input.errorCategory ?? null,
      input_hash: input.inputHash ?? null,
      completed_at: new Date().toISOString(),
    });
    if (error) {
      logger.info("ai_runs persist skipped", { code: error.code ?? "unknown", analysisType: input.analysisType });
    }
  } catch {
    logger.info("ai_runs persist skipped", { analysisType: input.analysisType });
  }

  if (input.status === "succeeded" && input.artifactKind && input.artifact) {
    try {
      await input.supabase.from("ai_artifacts").insert({
        organization_id: input.organizationId,
        kind: input.artifactKind,
        project_id: input.projectId ?? null,
        document_id: input.documentId ?? null,
        prompt_version: input.promptVersion,
        model: input.model,
        input_hash: input.inputHash ?? null,
        payload: input.artifact,
        created_by: input.actorUserId,
      });
    } catch {
      logger.info("ai_artifacts persist skipped", { kind: input.artifactKind });
    }
  }
}
