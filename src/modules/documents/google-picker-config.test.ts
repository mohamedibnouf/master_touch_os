import { describe, expect, it } from "vitest";
import { parseServerEnvRecord } from "@/lib/env";
import {
  GOOGLE_DRIVE_FILE_SCOPE,
  isGooglePickerReady,
  readGooglePickerPublicConfig,
} from "./google-picker-config";
import {
  GOOGLE_PICKER_ERROR_AR,
  mapGisTokenClientError,
  mapGisTokenResponseError,
} from "./google-picker-errors";
import {
  DRIVE_DOCUMENT_FORM_FIELDS,
  driveKindFromMimeType,
  driveSubmitIncludesTokenField,
  normalizeGooglePickerDocument,
} from "./google-picker-normalize";
import { canonicalGoogleDriveUrl, parseGoogleDriveUrl } from "./google-drive-url";
import { isStorageFileRequired, uploadDocumentSchema } from "./schemas";
import { isStorageIntelligenceEligible } from "./file-source";
import { assertProjectBelongsToOrganization } from "./project-scope";
import { notificationEntityHref } from "@/lib/notifications/href";

const SAMPLE_ID = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";
const validBase = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_test_anon_key_value",
};

describe("Google Picker feature flag", () => {
  it("A. keeps manual URL mode when picker is disabled", () => {
    const config = readGooglePickerPublicConfig({
      NEXT_PUBLIC_GOOGLE_PICKER_ENABLED: "false",
      NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: "placeholder.apps.googleusercontent.com",
      NEXT_PUBLIC_GOOGLE_PICKER_API_KEY: "placeholder-key",
    });
    expect(isGooglePickerReady(config)).toBe(false);
  });

  it("B. falls back when Client ID is missing", () => {
    const config = readGooglePickerPublicConfig({
      NEXT_PUBLIC_GOOGLE_PICKER_ENABLED: "true",
      NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: "",
      NEXT_PUBLIC_GOOGLE_PICKER_API_KEY: "placeholder-key",
    });
    expect(isGooglePickerReady(config)).toBe(false);
  });

  it("C. falls back when API key is missing", () => {
    const config = readGooglePickerPublicConfig({
      NEXT_PUBLIC_GOOGLE_PICKER_ENABLED: "true",
      NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: "placeholder.apps.googleusercontent.com",
      NEXT_PUBLIC_GOOGLE_PICKER_API_KEY: "   ",
    });
    expect(isGooglePickerReady(config)).toBe(false);
  });

  it("N. parses enabled only as exact true plus both identifiers", () => {
    expect(
      isGooglePickerReady(
        readGooglePickerPublicConfig({
          NEXT_PUBLIC_GOOGLE_PICKER_ENABLED: "true",
          NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: "placeholder.apps.googleusercontent.com",
          NEXT_PUBLIC_GOOGLE_PICKER_API_KEY: "placeholder-key",
        }),
      ),
    ).toBe(true);
    expect(
      isGooglePickerReady(
        readGooglePickerPublicConfig({
          NEXT_PUBLIC_GOOGLE_PICKER_ENABLED: "TRUE",
          NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: "placeholder.apps.googleusercontent.com",
          NEXT_PUBLIC_GOOGLE_PICKER_API_KEY: "placeholder-key",
        }),
      ),
    ).toBe(false);
  });

  it("builds when Google public vars are omitted", () => {
    expect(parseServerEnvRecord({ ...validBase }).success).toBe(true);
  });

  it("accepts placeholder Google public vars without secrets", () => {
    const parsed = parseServerEnvRecord({
      ...validBase,
      NEXT_PUBLIC_GOOGLE_PICKER_ENABLED: "true",
      NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: "placeholder.apps.googleusercontent.com",
      NEXT_PUBLIC_GOOGLE_PICKER_API_KEY: "placeholder-restricted-picker-key",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("GOOGLE_OAUTH_CLIENT_SECRET");
    }
  });
});

describe("Google Picker normalization", () => {
  it("D/E. normalizes Drive files, Docs, Sheets, and Slides to canonical URLs", () => {
    const file = normalizeGooglePickerDocument({
      id: SAMPLE_ID,
      name: "عقد.pdf",
      mimeType: "application/pdf",
    });
    expect(file?.canonicalUrl).toBe(canonicalGoogleDriveUrl("file", SAMPLE_ID));
    expect(file?.fileId).toBe(SAMPLE_ID);

    expect(driveKindFromMimeType("application/vnd.google-apps.document")).toBe("document");
    expect(
      normalizeGooglePickerDocument({
        id: SAMPLE_ID,
        name: "Doc",
        mimeType: "application/vnd.google-apps.document",
      })?.canonicalUrl,
    ).toBe(`https://docs.google.com/document/d/${SAMPLE_ID}/view`);
    expect(
      normalizeGooglePickerDocument({
        id: SAMPLE_ID,
        name: "Sheet",
        mimeType: "application/vnd.google-apps.spreadsheet",
      })?.canonicalUrl,
    ).toContain("/spreadsheets/d/");
    expect(
      normalizeGooglePickerDocument({
        id: SAMPLE_ID,
        name: "Deck",
        mimeType: "application/vnd.google-apps.presentation",
      })?.kind,
    ).toBe("presentation");
  });

  it("F. rejects malicious URLs, folders, and short ids", () => {
    expect(parseGoogleDriveUrl(`javascript:alert(1)`)).toBeNull();
    expect(
      normalizeGooglePickerDocument({
        id: SAMPLE_ID,
        url: "https://evil.example/file",
        mimeType: "application/vnd.google-apps.folder",
      }),
    ).toBeNull();
    expect(normalizeGooglePickerDocument({ id: "short", name: "x" })).toBeNull();
    expect(
      normalizeGooglePickerDocument({
        url: `https://evil.example/file/d/${SAMPLE_ID}/view`,
        name: "x",
      }),
    ).toBeNull();
  });
});

describe("Drive and Storage submit contracts", () => {
  it("G. accepts Drive source with canonical URL", () => {
    const parsed = uploadDocumentSchema.safeParse({
      title: "عقد",
      category: "contract",
      fileSource: "google_drive",
      driveUrl: `https://drive.google.com/file/d/${SAMPLE_ID}/view`,
    });
    expect(parsed.success).toBe(true);
  });

  it("H. still requires a File for Storage at the action boundary", () => {
    expect(isStorageFileRequired("storage")).toBe(true);
  });

  it("I. project organization protection is unchanged", () => {
    const orgA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const orgB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    expect(() =>
      assertProjectBelongsToOrganization(
        { id: "11111111-1111-1111-1111-111111111111", organization_id: orgB },
        orgA,
      ),
    ).toThrow();
  });

  it("J. Drive form fields never include an access token", () => {
    expect(driveSubmitIncludesTokenField(DRIVE_DOCUMENT_FORM_FIELDS)).toBe(false);
    const parsed = uploadDocumentSchema.safeParse({
      title: "عقد",
      category: "contract",
      fileSource: "google_drive",
      driveUrl: `https://drive.google.com/file/d/${SAMPLE_ID}/view`,
      access_token: "should-be-stripped",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("access_token");
    }
  });

  it("K. maps GIS cancel, popup, and deny to Arabic messages", () => {
    expect(mapGisTokenClientError({ type: "popup_closed_by_user" })).toBe("sign_in_cancelled");
    expect(mapGisTokenClientError({ type: "popup_failed_to_open" })).toBe("popup_blocked");
    expect(mapGisTokenResponseError("access_denied")).toBe("denied");
    expect(GOOGLE_PICKER_ERROR_AR.sign_in_cancelled).toContain("إلغاء");
    expect(GOOGLE_PICKER_ERROR_AR.picker_cancelled).toContain("اختيار");
  });

  it("L. document notification href is unchanged", () => {
    expect(notificationEntityHref("document", "doc-1")).toBe("/documents/doc-1");
  });

  it("M. intelligence eligibility is unchanged", () => {
    expect(isStorageIntelligenceEligible({ file_source: "storage", file_path: "a/b" })).toBe(true);
    expect(isStorageIntelligenceEligible({ file_source: "google_drive", file_path: null })).toBe(false);
  });

  it("uses drive.file scope only", () => {
    expect(GOOGLE_DRIVE_FILE_SCOPE).toBe("https://www.googleapis.com/auth/drive.file");
  });
});
