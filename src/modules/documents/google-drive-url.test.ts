import { describe, expect, it } from "vitest";
import { parseGoogleDriveUrl } from "./google-drive-url";
import { isValidGoogleDriveVersion, isValidStorageVersion, driveOpenHref, isStorageIntelligenceEligible } from "./file-source";
import { isStorageFileRequired, uploadDocumentSchema } from "./schemas";

const SAMPLE_ID = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";

describe("parseGoogleDriveUrl", () => {
  it("parses drive file/d URLs", () => {
    const parsed = parseGoogleDriveUrl(`https://drive.google.com/file/d/${SAMPLE_ID}/view?usp=sharing`);
    expect(parsed?.fileId).toBe(SAMPLE_ID);
    expect(parsed?.kind).toBe("file");
    expect(parsed?.canonicalUrl).toBe(`https://drive.google.com/file/d/${SAMPLE_ID}/view`);
  });

  it("parses Google Docs URLs", () => {
    const parsed = parseGoogleDriveUrl(`https://docs.google.com/document/d/${SAMPLE_ID}/edit`);
    expect(parsed?.kind).toBe("document");
    expect(parsed?.canonicalUrl).toBe(`https://docs.google.com/document/d/${SAMPLE_ID}/view`);
  });

  it("parses Sheets URLs", () => {
    const parsed = parseGoogleDriveUrl(`https://docs.google.com/spreadsheets/d/${SAMPLE_ID}/edit#gid=0`);
    expect(parsed?.kind).toBe("spreadsheets");
    expect(parsed?.canonicalUrl).toContain("/spreadsheets/d/");
  });

  it("parses Slides URLs", () => {
    const parsed = parseGoogleDriveUrl(`https://docs.google.com/presentation/d/${SAMPLE_ID}/edit`);
    expect(parsed?.kind).toBe("presentation");
  });

  it("parses open?id URLs", () => {
    const parsed = parseGoogleDriveUrl(`https://drive.google.com/open?id=${SAMPLE_ID}`);
    expect(parsed?.fileId).toBe(SAMPLE_ID);
    expect(parsed?.kind).toBe("file");
  });

  it("rejects javascript and data URLs", () => {
    expect(parseGoogleDriveUrl(`javascript:alert(1)`)).toBeNull();
    expect(parseGoogleDriveUrl(`data:text/html,hi`)).toBeNull();
  });

  it("rejects non-Google and lookalike hosts", () => {
    expect(parseGoogleDriveUrl(`https://evil.example/file/d/${SAMPLE_ID}/view`)).toBeNull();
    expect(parseGoogleDriveUrl(`https://drive.google.com.evil.com/file/d/${SAMPLE_ID}/view`)).toBeNull();
    expect(parseGoogleDriveUrl(`https://notgoogle.com/open?id=${SAMPLE_ID}`)).toBeNull();
    expect(parseGoogleDriveUrl(`http://drive.google.com/file/d/${SAMPLE_ID}/view`)).toBeNull();
  });

  it("rejects malformed or short file IDs", () => {
    expect(parseGoogleDriveUrl("https://drive.google.com/file/d/short/view")).toBeNull();
    expect(parseGoogleDriveUrl("https://drive.google.com/file/d/../etc/passwd/view")).toBeNull();
    expect(parseGoogleDriveUrl("https://drive.google.com/drive/folders/abc")).toBeNull();
  });
});

describe("document version dual-source model", () => {
  it("accepts legacy Storage versions", () => {
    expect(
      isValidStorageVersion({
        file_source: "storage",
        file_path: "org/proj/doc/A/file.pdf",
        mime_type: "application/pdf",
        size_bytes: 12,
        external_provider: null,
        external_file_id: null,
        external_url: null,
      }),
    ).toBe(true);
  });

  it("accepts Drive versions without MIME/size", () => {
    expect(
      isValidGoogleDriveVersion({
        file_source: "google_drive",
        file_path: null,
        mime_type: null,
        size_bytes: null,
        external_provider: "google_drive",
        external_file_id: SAMPLE_ID,
        external_url: `https://drive.google.com/file/d/${SAMPLE_ID}/view`,
      }),
    ).toBe(true);
  });

  it("exposes a Drive Open href for the current Drive version", () => {
    const href = driveOpenHref({
      file_source: "google_drive",
      external_url: `https://drive.google.com/file/d/${SAMPLE_ID}/view`,
    });
    expect(href).toContain(SAMPLE_ID);
  });

  it("keeps Storage intelligence eligible and Drive ineligible", () => {
    expect(isStorageIntelligenceEligible({ file_source: "storage", file_path: "org/a/b" })).toBe(true);
    expect(isStorageIntelligenceEligible({ file_source: "google_drive", file_path: null })).toBe(false);
  });

  it("rejects Drive rows that still use Storage path", () => {
    expect(
      isValidGoogleDriveVersion({
        file_source: "google_drive",
        file_path: "org/x",
        mime_type: null,
        size_bytes: null,
        external_provider: "google_drive",
        external_file_id: SAMPLE_ID,
        external_url: `https://drive.google.com/file/d/${SAMPLE_ID}/view`,
      }),
    ).toBe(false);
  });
});

describe("uploadDocumentSchema dual source", () => {
  it("requires a Drive URL and not a File for google_drive", () => {
    const parsed = uploadDocumentSchema.safeParse({
      title: "عقد",
      category: "contract",
      projectId: "550e8400-e29b-41d4-a716-446655440000",
      fileSource: "google_drive",
      driveUrl: `https://drive.google.com/file/d/${SAMPLE_ID}/view`,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.projectId).toBe("550e8400-e29b-41d4-a716-446655440000");
    }
    expect(isStorageFileRequired("google_drive")).toBe(false);
  });

  it("still requires File for storage source at the action boundary", () => {
    expect(isStorageFileRequired("storage")).toBe(true);
    expect(isStorageFileRequired(undefined)).toBe(true);
    const parsed = uploadDocumentSchema.safeParse({
      title: "ملف",
      category: "other",
      fileSource: "storage",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects Drive source without URL", () => {
    const parsed = uploadDocumentSchema.safeParse({
      title: "عقد",
      category: "contract",
      fileSource: "google_drive",
      driveUrl: "",
    });
    expect(parsed.success).toBe(false);
  });
});
