import { describe, expect, it } from "vitest";
import { GOOGLE_DRIVE_FILE_SCOPE } from "./google-picker-config";
import { classifyDocumentSource } from "@/modules/ai/classify-source";
import { nextOperationalRevision } from "./operational-revision";
import { readFileSync } from "node:fs";
import {
  assertPickerMatchesAuthorizedFile,
  canRetryDriveAnalysisAfterPicker,
  driveAiRecoveryVisibility,
  driveFileScopeUnchanged,
  googlePickerAppIdFromClientId,
  isDriveAiAuthRecoveryCode,
  planGisTokenRequest,
  safeGoogleDriveErrorReason,
  DRIVE_AI_ACCESS_MESSAGE_AR,
} from "./drive-ai-auth";

const AUTHORIZED = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";

describe("Drive AI GIS token plan", () => {
  it("1. uses a valid cached token without interactive prompt", () => {
    expect(planGisTokenRequest({ interactive: false, hasCachedValidToken: true })).toEqual({
      useCache: true,
      prompt: "",
      clearCache: false,
    });
  });

  it("2. requests a token with empty prompt when cache is empty", () => {
    expect(planGisTokenRequest({ interactive: false, hasCachedValidToken: false })).toEqual({
      useCache: false,
      prompt: "",
      clearCache: false,
    });
  });

  it("5-6. recovery clears cache and uses select_account", () => {
    expect(planGisTokenRequest({ interactive: true, hasCachedValidToken: true })).toEqual({
      useCache: false,
      prompt: "select_account",
      clearCache: true,
    });
  });
});

describe("Drive AI recovery UI state", () => {
  it("3-4. 404 and 403 expose recovery once", () => {
    expect(isDriveAiAuthRecoveryCode("DRIVE_NOT_FOUND")).toBe(true);
    expect(isDriveAiAuthRecoveryCode("DRIVE_FORBIDDEN")).toBe(true);
    expect(driveAiRecoveryVisibility({ recoveryUsed: false, errorCode: "DRIVE_NOT_FOUND" }).showRecovery).toBe(true);
    expect(driveAiRecoveryVisibility({ recoveryUsed: false, errorCode: "DRIVE_FORBIDDEN" }).showRecovery).toBe(true);
  });

  it("7. recovery is not shown again after it was used", () => {
    expect(driveAiRecoveryVisibility({ recoveryUsed: true, errorCode: "DRIVE_NOT_FOUND" }).showRecovery).toBe(false);
  });

  it("8-9. retry only after same-file picker match; mismatch fails closed", () => {
    expect(canRetryDriveAnalysisAfterPicker({ recoveryUsed: true, pickerMatchesAuthorizedFile: true })).toBe(true);
    expect(canRetryDriveAnalysisAfterPicker({ recoveryUsed: true, pickerMatchesAuthorizedFile: false })).toBe(false);
    expect(assertPickerMatchesAuthorizedFile("other-file-id-xxxxxxxx", AUTHORIZED).ok).toBe(false);
  });

  it("13-14. different Picker id rejected; same id accepted", () => {
    expect(assertPickerMatchesAuthorizedFile("attacker-file-id-xxxx", AUTHORIZED).ok).toBe(false);
    expect(assertPickerMatchesAuthorizedFile(AUTHORIZED, AUTHORIZED)).toEqual({ ok: true });
  });
});

describe("Drive AI auth safety", () => {
  it("11-12. recovery helpers never persist or log tokens", () => {
    const src = readFileSync("src/modules/documents/drive-ai-auth.ts", "utf8");
    const gis = readFileSync("src/modules/documents/google-gis.ts", "utf8");
    const picker = readFileSync("src/modules/documents/google-picker.ts", "utf8");
    expect(src).toContain("select_account");
    expect(src).not.toMatch(/localStorage|refresh_token/);
    expect(gis).toContain("plan.prompt");
    expect(gis).not.toMatch(/localStorage/);
    expect(picker).toContain("setAppId");
    expect(picker).toContain("interactive");
    expect(driveFileScopeUnchanged(GOOGLE_DRIVE_FILE_SCOPE)).toBe(true);
  });

  it("15. storage documents remain content-available", () => {
    expect(
      classifyDocumentSource({ fileSource: "storage", mimeType: "application/pdf", filePath: "org/a.pdf" }),
    ).toBe("CONTENT_AVAILABLE");
  });

  it("16. Google Docs remain export-required", () => {
    expect(
      classifyDocumentSource({
        fileSource: "google_drive",
        mimeType: "application/vnd.google-apps.document",
      }),
    ).toBe("DRIVE_FETCH_REQUIRED");
  });

  it("17. Sheets and Slides stay blocked", () => {
    expect(
      classifyDocumentSource({
        fileSource: "google_drive",
        mimeType: "application/vnd.google-apps.spreadsheet",
      }),
    ).toBe("UNSUPPORTED");
  });

  it("18. operational A→B helper unchanged", () => {
    expect(nextOperationalRevision("A")).toBe("B");
  });

  it("access message is recovery-oriented rather than deletion-only", () => {
    expect(DRIVE_AI_ACCESS_MESSAGE_AR).toContain("حساب Google");
  });

  it("derives Picker appId from OAuth client id digits only", () => {
    expect(googlePickerAppIdFromClientId("123456789012-abc.apps.googleusercontent.com")).toBe("123456789012");
    expect(googlePickerAppIdFromClientId("not-a-project.apps.googleusercontent.com")).toBeNull();
  });

  it("sanitizes Google error reasons", () => {
    expect(safeGoogleDriveErrorReason({ error: { status: "NOT_FOUND", errors: [{ reason: "notFound" }] } })).toBe(
      "notFound",
    );
    expect(safeGoogleDriveErrorReason({ error: { message: "ya29.secret" } })).toBeNull();
    expect(safeGoogleDriveErrorReason({ error: { status: "Bearer token leaked" } })).toBeNull();
  });
});
