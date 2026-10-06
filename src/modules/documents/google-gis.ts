import "client-only";

import { GOOGLE_DRIVE_FILE_SCOPE } from "./google-picker-config";
import { mapGisTokenClientError, mapGisTokenResponseError, type GooglePickerUiError } from "./google-picker-errors";
import { loadGoogleIdentityScript } from "./google-script-loader";
import { planGisTokenRequest } from "./drive-ai-auth";

type CachedToken = { accessToken: string; expiresAt: number };

let cached: CachedToken | null = null;

function tokenStillValid(now = Date.now()): boolean {
  return Boolean(cached && cached.expiresAt - 60_000 > now);
}

export function clearGoogleAccessToken(): void {
  cached = null;
}

export async function requestGoogleDriveFileAccessToken(
  clientId: string,
  options?: { interactive?: boolean },
): Promise<string> {
  const plan = planGisTokenRequest({
    interactive: Boolean(options?.interactive),
    hasCachedValidToken: tokenStillValid(),
  });
  if (plan.clearCache) cached = null;
  if (plan.useCache && cached) return cached.accessToken;

  await loadGoogleIdentityScript();
  const oauth = window.google?.accounts?.oauth2;
  if (!oauth) throw Object.assign(new Error("script_failed"), { code: "script_failed" as const });

  const accessToken = await new Promise<string>((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_DRIVE_FILE_SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(Object.assign(new Error("token_error"), { code: mapGisTokenResponseError(response.error) }));
          return;
        }
        const ttlMs = Math.max(30, Number(response.expires_in ?? 3600)) * 1000;
        cached = { accessToken: response.access_token, expiresAt: Date.now() + ttlMs };
        resolve(response.access_token);
      },
      error_callback: (error) => {
        reject(Object.assign(new Error("token_error"), { code: mapGisTokenClientError(error) }));
      },
    });
    client.requestAccessToken({ prompt: plan.prompt });
  });

  return accessToken;
}

export function googlePickerErrorFromUnknown(error: unknown): GooglePickerUiError {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: string }).code;
    if (code === "script_failed") return "script_failed";
    if (
      code === "popup_blocked" ||
      code === "sign_in_cancelled" ||
      code === "token_error" ||
      code === "token_expired" ||
      code === "denied" ||
      code === "network"
    ) {
      return code;
    }
  }
  if (error instanceof Error && error.message === "script_failed") return "script_failed";
  return "token_error";
}
