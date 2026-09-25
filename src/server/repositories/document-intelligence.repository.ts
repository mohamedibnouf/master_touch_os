import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BusinessCaseExtraction,
  DocumentIntelligenceStatus,
  DocumentIntelligenceType,
} from "@/modules/document-intelligence/schema";
import { DOCUMENT_AI_LIMITS } from "@/modules/document-intelligence/limits";

export type DocumentIntelligenceRow = {
  id: string;
  organization_id: string;
  document_id: string;
  document_version_id: string;
  intelligence_type: DocumentIntelligenceType;
  schema_version: string;
  status: DocumentIntelligenceStatus;
  provider: string;
  model: string | null;
  extraction_payload: BusinessCaseExtraction;
  extraction_warnings: string[];
  character_count: number;
  chunk_count: number;
  error_message: string | null;
  source_checksum: string | null;
  created_by: string;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
};

export class DocumentIntelligenceRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async getCurrentForVersion(
    organizationId: string,
    documentVersionId: string,
    intelligenceType: DocumentIntelligenceType = "BUSINESS_CASE",
  ): Promise<DocumentIntelligenceRow | null> {
    const { data, error } = await this.supabase
      .from("document_intelligence")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("document_version_id", documentVersionId)
      .eq("intelligence_type", intelligenceType)
      .eq("schema_version", DOCUMENT_AI_LIMITS.schemaVersion)
      .in("status", ["PENDING", "PROCESSING", "EXTRACTED", "VERIFIED"])
      .maybeSingle();
    if (error) {
      console.error("[doc-intel] getCurrent failed:", JSON.stringify(error));
      return null;
    }
    return data as DocumentIntelligenceRow | null;
  }

  async insertProcessing(input: {
    organizationId: string;
    documentId: string;
    documentVersionId: string;
    createdBy: string;
    sourceChecksum: string | null;
    intelligenceType?: DocumentIntelligenceType;
  }): Promise<DocumentIntelligenceRow | null> {
    const { data, error } = await this.supabase
      .from("document_intelligence")
      .insert({
        organization_id: input.organizationId,
        document_id: input.documentId,
        document_version_id: input.documentVersionId,
        intelligence_type: input.intelligenceType ?? "BUSINESS_CASE",
        schema_version: DOCUMENT_AI_LIMITS.schemaVersion,
        status: "PROCESSING",
        provider: "none",
        created_by: input.createdBy,
        source_checksum: input.sourceChecksum,
      })
      .select("*")
      .single();
    if (error) {
      // Unique conflict → concurrent analyze
      console.error("[doc-intel] insertProcessing failed:", JSON.stringify(error));
      return null;
    }
    return data as DocumentIntelligenceRow;
  }

  async markFailed(id: string, organizationId: string, message: string): Promise<void> {
    await this.supabase
      .from("document_intelligence")
      .update({ status: "FAILED", error_message: message.slice(0, 500) })
      .eq("id", id)
      .eq("organization_id", organizationId);
  }

  async markExtracted(input: {
    id: string;
    organizationId: string;
    provider: string;
    model: string | null;
    payload: BusinessCaseExtraction;
    warnings: string[];
    characterCount: number;
    chunkCount: number;
  }): Promise<DocumentIntelligenceRow | null> {
    const { data, error } = await this.supabase
      .from("document_intelligence")
      .update({
        status: "EXTRACTED",
        provider: input.provider,
        model: input.model,
        extraction_payload: input.payload,
        extraction_warnings: input.warnings,
        character_count: input.characterCount,
        chunk_count: input.chunkCount,
        error_message: null,
      })
      .eq("id", input.id)
      .eq("organization_id", input.organizationId)
      .select("*")
      .single();
    if (error) {
      console.error("[doc-intel] markExtracted failed:", JSON.stringify(error));
      return null;
    }
    return data as DocumentIntelligenceRow;
  }

  async verifyViaRpc(intelligenceId: string): Promise<DocumentIntelligenceRow | null> {
    const { data, error } = await this.supabase.rpc("verify_document_intelligence", {
      p_intelligence_id: intelligenceId,
    });
    if (error) {
      console.error("[doc-intel] verify RPC failed:", JSON.stringify(error));
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    return (row as DocumentIntelligenceRow | null) ?? null;
  }

  async supersedeOthers(
    organizationId: string,
    documentVersionId: string,
    keepId: string,
    intelligenceType: DocumentIntelligenceType = "BUSINESS_CASE",
  ): Promise<void> {
    await this.supabase
      .from("document_intelligence")
      .update({ status: "SUPERSEDED" })
      .eq("organization_id", organizationId)
      .eq("document_version_id", documentVersionId)
      .eq("intelligence_type", intelligenceType)
      .neq("id", keepId)
      .in("status", ["EXTRACTED", "VERIFIED", "PENDING", "PROCESSING"]);
  }
}
