import { ValidationError } from "@/lib/errors";
import {
  managementAIRawResponseSchema,
  type ManagementAIFindingView,
  type ManagementAIRawResponse,
  type ManagementAIResult,
  type ManagementAIReviewView,
  type ManagementAITrustedContext,
} from "./schema";

function resolveSources(
  refs: string[],
  context: ManagementAITrustedContext,
  locale: "ar" | "en",
): Array<{ id: string; label: string; href: string | null }> {
  const out: Array<{ id: string; label: string; href: string | null }> = [];
  const seen = new Set<string>();
  for (const id of refs) {
    if (seen.has(id)) continue;
    seen.add(id);
    const src = context.sources[id];
    if (!src) continue; // drop unknown — never invent
    out.push({
      id,
      label: locale === "en" ? src.labelEn : src.labelAr,
      href: src.href,
    });
  }
  return out;
}

/**
 * Validate provider JSON and verify every citation against the trusted registry.
 * Unknown sourceRefs are dropped. Official risk severity cannot be overridden.
 */
export function validateAndGroundAIResponse(
  raw: unknown,
  context: ManagementAITrustedContext,
  meta: { provider: string; model: string | null },
): ManagementAIResult {
  const parsed = managementAIRawResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(
      "استجابة التحليل غير صالحة. حاول مرة أخرى.",
      "Analyst response failed validation. Please try again.",
      { issues: parsed.error.issues.slice(0, 5) },
    );
  }
  const data: ManagementAIRawResponse = parsed.data;
  const locale = context.locale;

  const findings: ManagementAIFindingView[] = [];
  for (const f of data.findings) {
    const sources = resolveSources(f.sourceRefs, context, locale);
    if (sources.length === 0 && f.sourceRefs.length > 0) {
      // All refs were fake — skip finding
      continue;
    }
    let isOfficialRisk = false;
    let severity = f.severity;
    const riskRefs = f.sourceRefs
      .map((id) => context.sources[id])
      .filter((s) => s && s.kind === "risk");
    if (riskRefs.length > 0) {
      isOfficialRisk = true;
      // Authoritative severity from risk engine — ignore model override
      severity = riskRefs[0]!.officialSeverity ?? severity;
    } else if (f.isOfficialRisk) {
      // Model claimed official risk without RISK_* citation — strip claim
      isOfficialRisk = false;
    }
    findings.push({
      title: f.title,
      explanation: f.explanation,
      severity,
      isOfficialRisk,
      sources,
    });
  }

  const suggestedReviews: ManagementAIReviewView[] = [];
  for (const r of data.suggestedReviews) {
    const sources = resolveSources(r.sourceRefs, context, locale);
    const href = sources.find((s) => s.href)?.href ?? null;
    suggestedReviews.push({
      label: r.label,
      href,
      sources,
    });
  }

  const limitations = [
    ...context.limitations,
    ...data.limitations,
    "AI analysis based on Master Touch system data only — human verification recommended.",
  ];

  return {
    summary: data.summary,
    findings,
    suggestedReviews,
    limitations: [...new Set(limitations)],
    asOfDate: context.asOfDate,
    generatedAt: context.generatedAt,
    provider: meta.provider,
    model: meta.model,
    disclaimerAr: "تحليل ذكاء اصطناعي مبني على بيانات نظام ماستر تاتش الحالية فقط.",
    disclaimerEn: "AI analysis based on current Master Touch system data only.",
  };
}
