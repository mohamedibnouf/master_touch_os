import { buildManagementAnalystSystemPrompt } from "./prompt";
import type { ManagementAIProvider, ManagementAIResult, ManagementAITrustedContext } from "./schema";
import { validateAndGroundAIResponse } from "./validate-response";

export async function runManagementAIAnalysis(input: {
  provider: ManagementAIProvider;
  context: ManagementAITrustedContext;
}): Promise<ManagementAIResult> {
  const systemPrompt = buildManagementAnalystSystemPrompt(input.context.locale);
  const userPayload = JSON.stringify({
    organization: {
      nameAr: input.context.organizationNameAr,
      nameEn: input.context.organizationNameEn,
    },
    asOfDate: input.context.asOfDate,
    generatedAt: input.context.generatedAt,
    data: input.context.data,
    sources: input.context.sources,
    builtInLimitations: input.context.limitations,
  });

  const raw = await input.provider.analyze({
    systemPrompt,
    userPayload,
    locale: input.context.locale,
  });

  return validateAndGroundAIResponse(raw, input.context, {
    provider: input.provider.id,
    model: input.provider.model,
  });
}
