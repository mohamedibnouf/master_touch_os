import "server-only";

import type { ManagementAIProvider } from "./schema";
import { MANAGEMENT_AI_LIMITS as L } from "./limits";
import { createMockManagementAIProvider } from "./mock-provider";
import { createOpenAICompatibleProvider } from "./openai-compatible";
import { getAiPlatformConfig, isAiKillSwitchOff } from "@/modules/ai/config-env";

export type ManagementAIConfig = {
  provider: "none" | "mock" | "openai";
  enabled: boolean;
  model: string | null;
  baseUrl: string | null;
  hasApiKey: boolean;
};

export function getManagementAIConfig(): ManagementAIConfig {
  if (isAiKillSwitchOff()) {
    return { provider: "none", enabled: false, model: null, baseUrl: null, hasApiKey: false };
  }
  const platform = getAiPlatformConfig();
  if (platform.enabled && (platform.provider === "mock" || platform.provider === "openai")) {
    return {
      provider: platform.provider,
      enabled: true,
      model: platform.model,
      baseUrl: platform.baseUrl,
      hasApiKey: platform.hasApiKey,
    };
  }
  const provider = (process.env.MANAGEMENT_AI_PROVIDER ?? "none").toLowerCase();
  const normalized =
    provider === "mock" || provider === "openai" || provider === "none" ? provider : "none";
  const apiKey = process.env.MANAGEMENT_AI_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  const model = process.env.MANAGEMENT_AI_MODEL ?? process.env.AI_MODEL ?? L.defaultModel;
  const baseUrl = process.env.MANAGEMENT_AI_BASE_URL ?? "https://api.openai.com/v1";

  if (normalized === "mock") {
    return { provider: "mock", enabled: true, model: "mock-v1", baseUrl: null, hasApiKey: false };
  }
  if (normalized === "openai" && apiKey.length >= 8) {
    return {
      provider: "openai",
      enabled: true,
      model,
      baseUrl,
      hasApiKey: true,
    };
  }
  return {
    provider: "none",
    enabled: false,
    model: null,
    baseUrl: null,
    hasApiKey: false,
  };
}

export function createManagementAIProvider(): ManagementAIProvider | null {
  const cfg = getManagementAIConfig();
  if (!cfg.enabled) return null;
  if (cfg.provider === "mock") return createMockManagementAIProvider();
  if (cfg.provider === "openai" && cfg.hasApiKey) {
    return createOpenAICompatibleProvider({
      apiKey: process.env.OPENAI_API_KEY || process.env.MANAGEMENT_AI_API_KEY || "",
      model: cfg.model ?? L.defaultModel,
      baseUrl: cfg.baseUrl ?? "https://api.openai.com/v1",
    });
  }
  return null;
}
