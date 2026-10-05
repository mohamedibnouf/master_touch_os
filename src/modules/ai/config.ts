import "server-only";

import { AI_LIMITS } from "./limits";
import { createMockAiProvider } from "./provider/mock";
import { createOpenAIProvider } from "./provider/openai";
import type { AiProvider } from "./provider/types";
import { getAiPlatformConfig, readAiApiKeyFromEnv } from "./config-env";

export {
  getAiPlatformConfig,
  isAiKillSwitchOff,
  type AiPlatformConfig,
  type AiProviderId,
} from "./config-env";

export function createPlatformAiProvider(): AiProvider | null {
  const cfg = getAiPlatformConfig();
  if (!cfg.enabled) return null;
  if (cfg.provider === "mock") return createMockAiProvider();
  if (cfg.provider === "openai" && cfg.hasApiKey) {
    return createOpenAIProvider({
      apiKey: readAiApiKeyFromEnv(),
      model: cfg.model ?? AI_LIMITS.defaultModel,
      documentModel: cfg.documentModel ?? cfg.model ?? AI_LIMITS.defaultModel,
      baseUrl: cfg.baseUrl ?? "https://api.openai.com/v1",
    });
  }
  return null;
}
