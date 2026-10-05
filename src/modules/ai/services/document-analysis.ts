import { ValidationError } from "@/lib/errors";
import type { AiProvider } from "../provider/types";
import {
  businessCaseAnalysisSchema,
  documentAnalysisSchema,
  type BusinessCaseAnalysis,
  type DocumentAnalysis,
} from "../schemas";
import {
  AI_PROMPT_VERSIONS,
  buildBusinessCasePrompt,
  buildDocumentAnalysisPrompt,
  wrapUntrustedDocumentText,
} from "../prompts";
import { getCachedAiArtifact, hashAiInput, setCachedAiArtifact } from "../cache";
import { AI_DISCLAIMER_AR, AI_LIMITS } from "../limits";
import { truncateText } from "../security/sanitize";
import { classifyDocumentSource } from "../classify-source";

export type { DocumentSourceClass } from "../classify-source";
export { classifyDocumentSource };

export async function analyzeDocumentText(input: {
  provider: AiProvider;
  organizationId: string;
  documentId: string;
  versionId: string;
  analysisType: "document" | "business_case";
  text: string;
  pageCount: number | null;
  forceRefresh?: boolean;
}): Promise<{
  document?: DocumentAnalysis;
  businessCase?: BusinessCaseAnalysis;
  cached: boolean;
  disclaimerAr: string;
  promptVersion: string;
}> {
  const bounded = truncateText(input.text, AI_LIMITS.maxDocumentChars);
  if (bounded.text.trim().length < 20) {
    throw new ValidationError("تعذر استخراج نص قابل للتحليل من هذا المستند.", "No extractable text.", {
      aiCode: "NO_EXTRACTABLE_TEXT",
    });
  }

  const wrapped = wrapUntrustedDocumentText(bounded.text);
  const citations =
    input.pageCount && input.pageCount > 0
      ? [{ label_ar: `المصدر: صفحة ضمن ${input.pageCount}`, page: null as number | null }]
      : [];

  const inputHash = hashAiInput({
    v:
      input.analysisType === "business_case"
        ? AI_PROMPT_VERSIONS.businessCase
        : AI_PROMPT_VERSIONS.documentAnalysis,
    versionId: input.versionId,
    textHash: hashAiInput(bounded.text),
    model: input.provider.model,
  });

  const kind = input.analysisType === "business_case" ? "business_case" : "document_analysis";
  if (!input.forceRefresh) {
    const cached = getCachedAiArtifact<DocumentAnalysis | BusinessCaseAnalysis>({
      organizationId: input.organizationId,
      kind,
      targetId: `${input.documentId}:${input.versionId}`,
      inputHash,
    });
    if (cached) {
      if (input.analysisType === "business_case") {
        return {
          businessCase: cached.payload as BusinessCaseAnalysis,
          cached: true,
          disclaimerAr: AI_DISCLAIMER_AR,
          promptVersion: AI_PROMPT_VERSIONS.businessCase,
        };
      }
      return {
        document: cached.payload as DocumentAnalysis,
        cached: true,
        disclaimerAr: AI_DISCLAIMER_AR,
        promptVersion: AI_PROMPT_VERSIONS.documentAnalysis,
      };
    }
  }

  const userPayload = JSON.stringify({
    MASTER_TOUCH_CONTEXT: "DATA_ONLY",
    facts: { citation_pages: citations },
    document: wrapped,
  });

  if (input.analysisType === "business_case") {
    const structured = await input.provider.generateStructured({
      schemaName: "business-case",
      schema: businessCaseAnalysisSchema,
      systemPrompt: buildBusinessCasePrompt(),
      userPayload,
      modelKind: "document",
      timeoutMs: AI_LIMITS.documentTimeoutMs,
    });
    setCachedAiArtifact({
      organizationId: input.organizationId,
      kind: "business_case",
      targetId: `${input.documentId}:${input.versionId}`,
      inputHash,
      payload: structured.value,
    });
    return {
      businessCase: structured.value,
      cached: false,
      disclaimerAr: AI_DISCLAIMER_AR,
      promptVersion: AI_PROMPT_VERSIONS.businessCase,
    };
  }

  const structured = await input.provider.generateStructured({
    schemaName: "document-analysis",
    schema: documentAnalysisSchema,
    systemPrompt: buildDocumentAnalysisPrompt(),
    userPayload,
    modelKind: "document",
    timeoutMs: AI_LIMITS.documentTimeoutMs,
  });
  const document: DocumentAnalysis = {
    ...structured.value,
    citations: structured.value.citations.every((c) => c.page == null) ? citations : structured.value.citations,
  };
  setCachedAiArtifact({
    organizationId: input.organizationId,
    kind: "document_analysis",
    targetId: `${input.documentId}:${input.versionId}`,
    inputHash,
    payload: document,
  });
  return {
    document,
    cached: false,
    disclaimerAr: AI_DISCLAIMER_AR,
    promptVersion: AI_PROMPT_VERSIONS.documentAnalysis,
  };
}
