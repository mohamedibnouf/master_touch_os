import { GOOGLE_DRIVE_FILE_SCOPE } from "./google-picker-config";

export const DRIVE_AI_ACCESS_MESSAGE_AR =
  "تعذر الوصول إلى الملف عبر حساب Google الحالي. قد تحتاج إلى إعادة تفويض Google Drive أو اختيار الحساب الذي يحتوي الملف.";

export const DRIVE_AI_ACCESS_MESSAGE_EN =
  "This Google Drive file could not be accessed with the current Google account. Re-authorize Google Drive or choose the account that has the file.";

export const DRIVE_AI_SAME_FILE_REQUIRED_AR =
  "يجب اختيار نفس ملف Google Drive الأصلي المرتبط بهذا المستند. لم يتم إنشاء إصدار جديد.";

export type GisTokenPrompt = "" | "consent" | "select_account";

export function planGisTokenRequest(input: {
  interactive: boolean;
  hasCachedValidToken: boolean;
}): { useCache: boolean; prompt: GisTokenPrompt; clearCache: boolean } {
  if (input.interactive) {
    return { useCache: false, prompt: "select_account", clearCache: true };
  }
  if (input.hasCachedValidToken) {
    return { useCache: true, prompt: "", clearCache: false };
  }
  return { useCache: false, prompt: "", clearCache: false };
}

export function isDriveAiAuthRecoveryCode(code: string | null | undefined): boolean {
  return code === "DRIVE_NOT_FOUND" || code === "DRIVE_FORBIDDEN";
}

export function driveAiRecoveryVisibility(input: {
  recoveryUsed: boolean;
  errorCode: string | null | undefined;
}): { showRecovery: boolean } {
  return {
    showRecovery: !input.recoveryUsed && isDriveAiAuthRecoveryCode(input.errorCode),
  };
}

export function canRetryDriveAnalysisAfterPicker(input: {
  recoveryUsed: boolean;
  pickerMatchesAuthorizedFile: boolean;
}): boolean {
  return input.recoveryUsed && input.pickerMatchesAuthorizedFile;
}

export function assertPickerMatchesAuthorizedFile(
  selectedFileId: string | null | undefined,
  authorizedFileId: string | null | undefined,
): { ok: true } | { ok: false; messageAr: string } {
  if (!authorizedFileId || !selectedFileId || selectedFileId !== authorizedFileId) {
    return { ok: false, messageAr: DRIVE_AI_SAME_FILE_REQUIRED_AR };
  }
  return { ok: true };
}

/** Cloud project number prefix of a Web OAuth client ID. Not a secret. */
export function googlePickerAppIdFromClientId(clientId: string): string | null {
  const match = clientId.trim().match(/^(\d+)-/);
  return match?.[1] && match[1].length >= 6 ? match[1] : null;
}

export function driveFileScopeUnchanged(scope: string): boolean {
  return scope === GOOGLE_DRIVE_FILE_SCOPE;
}

const SAFE_GOOGLE_REASON = /^[A-Za-z0-9._-]{1,64}$/;

export function safeGoogleDriveErrorReason(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") return null;
  const rec = error as { status?: unknown; errors?: unknown; message?: unknown };
  const nested = Array.isArray(rec.errors) ? rec.errors[0] : null;
  const reason =
    (nested && typeof nested === "object" && "reason" in nested
      ? (nested as { reason?: unknown }).reason
      : null) ?? rec.status;
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim();
  if (!SAFE_GOOGLE_REASON.test(trimmed)) return null;
  if (/token|bearer|ya29|secret|key/i.test(trimmed)) return null;
  return trimmed;
}
