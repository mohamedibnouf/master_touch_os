import { AI_LIMITS } from "./limits";

export type AiProviderId = "none" | "mock" | "openai";

export type AiPlatformConfig = {
  enabled: boolean;
  provider: AiProviderId;
  model: string | null;
  documentModel: string | null;
  baseUrl: string | null;
  hasApiKey: boolean;
};

const DISABLED: AiPlatformConfig = {
  enabled: false,
  provider: "none",
  model: null,
  documentModel: null,
  baseUrl: null,
  hasApiKey: false,
};

function envFlag(name: string): boolean | null {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "off") return false;
  if (raw === "true" || raw === "1" || raw === "on") return true;
  return null;
}

export function isAiKillSwitchOff(): boolean {
  return envFlag("AI_ENABLED") === false;
}

function normalizeProvider(raw: string): AiProviderId {
  const v = raw.toLowerCase().trim();
  if (v === "mock" || v === "openai" || v === "none") return v;
  return "none";
}

export function readAiApiKeyFromEnv(): string {
  return (
    process.env.OPENAI_API_KEY ||
    process.env.MANAGEMENT_AI_API_KEY ||
    process.env.DOCUMENT_AI_API_KEY ||
    ""
  );
}

/**
 * Unified AI configuration from process.env.
 * Never reads NEXT_PUBLIC_OPENAI_API_KEY.
 */
export function getAiPlatformConfig(): AiPlatformConfig {
  if (isAiKillSwitchOff()) return DISABLED;

  const provider = normalizeProvider(
    process.env.AI_PROVIDER ||
      process.env.MANAGEMENT_AI_PROVIDER ||
      process.env.DOCUMENT_AI_PROVIDER ||
      "none",
  );
  const apiKey = readAiApiKeyFromEnv();
  const model =
    process.env.AI_MODEL ||
    process.env.MANAGEMENT_AI_MODEL ||
    process.env.DOCUMENT_AI_MODEL ||
    AI_LIMITS.defaultModel;
  const documentModel = process.env.AI_DOCUMENT_MODEL || process.env.DOCUMENT_AI_MODEL || model;
  const baseUrl =
    process.env.AI_BASE_URL ||
    process.env.MANAGEMENT_AI_BASE_URL ||
    process.env.DOCUMENT_AI_BASE_URL ||
    "https://api.openai.com/v1";

  if (provider === "mock") {
    return {
      enabled: true,
      provider: "mock",
      model: "mock-v1",
      documentModel: "mock-doc-v1",
      baseUrl: null,
      hasApiKey: false,
    };
  }

  if (provider === "openai" && apiKey.length >= 8) {
    return {
      enabled: true,
      provider: "openai",
      model,
      documentModel,
      baseUrl,
      hasApiKey: true,
    };
  }

  return DISABLED;
}
