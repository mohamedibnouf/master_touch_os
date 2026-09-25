import { ValidationError } from "@/lib/errors";
import {
  businessCaseExtractionSchema,
  type BusinessCaseExtraction,
  type DocumentChunk,
  type ExtractedFact,
} from "./schema";

function filterFact(fact: ExtractedFact | null | undefined, validIds: Set<string>): ExtractedFact | null {
  if (!fact) return null;
  const refs = fact.evidenceRefs.filter((id) => validIds.has(id));
  if (refs.length === 0) return null;
  return { value: fact.value, evidenceRefs: refs };
}

function filterFacts(facts: ExtractedFact[], validIds: Set<string>): ExtractedFact[] {
  return facts
    .map((f) => filterFact(f, validIds))
    .filter((f): f is ExtractedFact => Boolean(f));
}

/**
 * Validate extraction JSON and drop any facts citing unknown chunk IDs.
 */
export function validateBusinessCaseExtraction(
  raw: unknown,
  chunks: DocumentChunk[],
): BusinessCaseExtraction {
  const parsed = businessCaseExtractionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(
      "استجابة استخراج المستند غير صالحة.",
      "Document extraction response failed validation.",
      { issues: parsed.error.issues.slice(0, 5) },
    );
  }
  const validIds = new Set(chunks.map((c) => c.id));
  const data = parsed.data;

  const deadlines = data.deadlines
    .map((d) => {
      const base = filterFact(d, validIds);
      if (!base) return null;
      return { ...base, dateYmd: d.dateYmd ?? null };
    })
    .filter((d): d is NonNullable<typeof d> => Boolean(d));

  return {
    documentTitle: filterFact(data.documentTitle ?? null, validIds),
    projectName: filterFact(data.projectName ?? null, validIds),
    summary: data.summary ?? "",
    objectives: filterFacts(data.objectives, validIds),
    deliverables: filterFacts(data.deliverables, validIds),
    milestones: filterFacts(data.milestones, validIds),
    deadlines,
    budgetFacts: filterFacts(data.budgetFacts, validIds),
    stakeholders: filterFacts(data.stakeholders, validIds),
    assumptions: filterFacts(data.assumptions, validIds),
    dependencies: filterFacts(data.dependencies, validIds),
    explicitRisks: filterFacts(data.explicitRisks, validIds),
    requiredApprovals: filterFacts(data.requiredApprovals, validIds),
    actionItems: filterFacts(data.actionItems, validIds),
    ambiguities: data.ambiguities ?? [],
  };
}
