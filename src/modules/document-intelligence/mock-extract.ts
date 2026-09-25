import { businessCaseExtractionSchema, type BusinessCaseExtraction, type DocumentChunk } from "./schema";

/**
 * Deterministic mock extractor for CI/E2E — no paid LLM.
 * Pulls simple patterns from chunk text and always cites real chunk IDs.
 */
export function mockExtractBusinessCase(chunks: DocumentChunk[]): BusinessCaseExtraction {
  const all = chunks.map((c) => c.text).join("\n");
  const firstChunk = chunks[0]?.id ?? "DOC_CHUNK_001";

  const dateMatch = all.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  const objectives: BusinessCaseExtraction["objectives"] = [];
  if (/objectiv/i.test(all) || /هدف/i.test(all)) {
    objectives.push({
      value: "Document states project objectives (mock extract).",
      evidenceRefs: [firstChunk],
    });
  }

  const deliverables: BusinessCaseExtraction["deliverables"] = [];
  if (/deliverable/i.test(all) || /مخرج/i.test(all)) {
    deliverables.push({
      value: "Document states deliverables (mock extract).",
      evidenceRefs: [firstChunk],
    });
  }

  // Intentionally include a bogus ref — server validation must drop it.
  deliverables.push({
    value: "Bogus deliverable with fake evidence",
    evidenceRefs: ["DOC_CHUNK_FAKE"],
  });

  const deadlines: BusinessCaseExtraction["deadlines"] = [];
  if (dateMatch) {
    deadlines.push({
      value: `Stated deadline ${dateMatch[1]}`,
      evidenceRefs: [firstChunk],
      dateYmd: dateMatch[1],
    });
  }

  const raw = {
    documentTitle: { value: "Business Case (mock)", evidenceRefs: [firstChunk] },
    projectName: /project/i.test(all)
      ? { value: "Named project in document (mock)", evidenceRefs: [firstChunk] }
      : null,
    summary: all.slice(0, 400) || "Empty summary",
    objectives,
    deliverables,
    milestones: [],
    deadlines,
    budgetFacts: /budget|SAR|cost/i.test(all)
      ? [{ value: "Budget/cost language present (mock).", evidenceRefs: [firstChunk] }]
      : [],
    stakeholders: [],
    assumptions: [],
    dependencies: [],
    explicitRisks: /risk/i.test(all)
      ? [{ value: "Explicit risk language present (mock).", evidenceRefs: [firstChunk] }]
      : [],
    requiredApprovals: [],
    actionItems: [],
    ambiguities: all.includes("Ignore previous instructions")
      ? ["Document contains instruction-like text; treated as data only."]
      : [],
  };

  return businessCaseExtractionSchema.parse(raw);
}
