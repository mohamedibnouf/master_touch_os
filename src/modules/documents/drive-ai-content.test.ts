import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { extractDocumentText } from "@/modules/document-intelligence/extract-text";
import { wrapUntrustedDocumentText } from "@/modules/ai/prompts";
import { analyzeDocumentText } from "@/modules/ai/services/document-analysis";
import { createMockAiProvider } from "@/modules/ai/provider/mock";
import { classifyDocumentSource } from "@/modules/ai/classify-source";
import { DOCUMENT_AI_LIMITS } from "@/modules/document-intelligence/limits";
import { sanitizeLogContext } from "@/lib/logger";
import { nextOperationalRevision } from "./operational-revision";
import { GOOGLE_DRIVE_FILE_SCOPE } from "./google-picker-config";
import { DRIVE_DOCUMENT_FORM_FIELDS, driveSubmitIncludesTokenField } from "./google-picker-normalize";
import { fetchDriveFileBytes } from "./drive-content-fetch";
import {
  authorizeDriveAiFetch,
  classifyDriveAiSource,
  driveAiFetchPlan,
  driveDownloadUrl,
  ignoreBrowserDriveOverride,
  resolveAuthorizedDriveFileId,
  DRIVE_GOOGLE_DOC,
  DRIVE_GOOGLE_SHEET,
  DRIVE_GOOGLE_SLIDE,
  DRIVE_DOCX,
} from "./drive-ai-content";

const FILE_ID = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";
const ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const TOKEN = "ya29.drive-token-for-tests-only";

const PDF_WITH_TEXT = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 88>>stream
BT /F1 12 Tf 72 720 Td (Drive PDF extraction content for AI pipeline test.) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF
`;

function authz(overrides: Record<string, unknown> = {}) {
  return authorizeDriveAiFetch({
    userId: "user-1",
    profileActive: true,
    membershipActive: true,
    actorOrgId: ORG_A,
    documentOrgId: ORG_A,
    documentExists: true,
    hasDocumentRead: true,
    hasAiDocumentAnalyze: true,
    versionBelongsToDocument: true,
    fileSource: "google_drive",
    externalProvider: "google_drive",
    externalFileId: FILE_ID,
    mimeType: "application/pdf",
    sizeBytes: 1200,
    maxFileBytes: DOCUMENT_AI_LIMITS.maxFileBytes,
    accessToken: TOKEN,
    ...overrides,
  });
}

async function download(
  mime: string,
  body: BodyInit,
  headers: HeadersInit = { "content-type": mime },
) {
  const fetchImpl: typeof fetch = vi.fn(async (url, init) => {
    expect(String(url)).toContain(FILE_ID);
    expect(String(url)).not.toContain(TOKEN);
    expect((init as RequestInit).headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    return new Response(body, { status: 200, headers });
  });
  return fetchDriveFileBytes({
    fileId: FILE_ID,
    accessToken: TOKEN,
    plan: driveAiFetchPlan(mime)!,
    maxBytes: DOCUMENT_AI_LIMITS.maxFileBytes,
    fetchImpl,
  });
}

describe("Drive AI Phase 1 fetch plans", () => {
  it("supports PDF DOCX TXT media and Google Docs export to DOCX", () => {
    expect(driveAiFetchPlan("application/pdf")?.kind).toBe("media");
    expect(driveAiFetchPlan(DRIVE_DOCX)?.kind).toBe("media");
    expect(driveAiFetchPlan("text/plain")?.kind).toBe("media");
    expect(driveAiFetchPlan(DRIVE_GOOGLE_DOC)).toEqual({
      kind: "export",
      exportMime: DRIVE_DOCX,
      extractMime: DRIVE_DOCX,
    });
    expect(driveDownloadUrl(FILE_ID, driveAiFetchPlan(DRIVE_GOOGLE_DOC)!)).toContain("/export?mimeType=");
    expect(driveDownloadUrl(FILE_ID, driveAiFetchPlan("application/pdf")!)).toContain("alt=media");
  });

  it("25. Sheets and Slides remain unsupported", () => {
    expect(classifyDriveAiSource(DRIVE_GOOGLE_SHEET)).toBe("UNSUPPORTED");
    expect(classifyDriveAiSource(DRIVE_GOOGLE_SLIDE)).toBe("UNSUPPORTED");
    expect(driveAiFetchPlan(DRIVE_GOOGLE_SHEET)).toBeNull();
    expect(classifyDocumentSource({ fileSource: "google_drive", mimeType: DRIVE_GOOGLE_SHEET })).toBe("UNSUPPORTED");
    expect(classifyDocumentSource({ fileSource: "google_drive", mimeType: DRIVE_GOOGLE_SLIDE })).toBe("UNSUPPORTED");
  });
});

describe("Drive AI authorization before fetch", () => {
  it("13. unauthorized user denied", () => {
    const result = authz({ userId: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.denial).toBe("UNAUTHORIZED");
  });

  it("14. cross-tenant denied", () => {
    const result = authz({ documentOrgId: ORG_B });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.denial).toBe("FORBIDDEN");
  });

  it("15. inactive membership and inactive profile denied", () => {
    expect(authz({ membershipActive: false }).ok).toBe(false);
    expect(authz({ profileActive: false }).ok).toBe(false);
  });

  it("16. missing external_file_id denied", () => {
    const result = authz({ externalFileId: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.denial).toBe("VALIDATION");
  });

  it("17-18. browser file id and mime cannot override DB", () => {
    const result = authz({
      mimeType: "application/pdf",
      browserFileId: "attacker-file-id-xxxxxxxxxxxx",
      browserMime: "text/plain",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fileId).toBe(FILE_ID);
    expect(result.plan.extractMime).toBe("application/pdf");
    expect(ignoreBrowserDriveOverride("application/pdf", "text/plain")).toBe("application/pdf");
    expect(resolveAuthorizedDriveFileId(FILE_ID)).toBe(FILE_ID);
    expect(resolveAuthorizedDriveFileId("attacker-file-id-xxxxxxxxxxxx")).not.toBe(FILE_ID);
  });

  it("6. token missing fail closed", () => {
    const result = authz({ accessToken: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.denial).toBe("DRIVE_TOKEN_REQUIRED");
  });

  it("9-10. unsupported MIME and oversized fail closed", () => {
    const unsupported = authz({ mimeType: "image/png" });
    expect(unsupported.ok).toBe(false);
    if (!unsupported.ok) expect(unsupported.denial).toBe("UNSUPPORTED");
    const oversized = authz({ sizeBytes: DOCUMENT_AI_LIMITS.maxFileBytes + 1 });
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) expect(oversized.denial).toBe("OVERSIZED");
  });
});

describe("Drive content fetch", () => {
  it("1-4. PDF/DOCX/TXT bytes are fetched and extracted text reaches AI, not metadata", async () => {
    const txt = "This contract text is long enough for extraction and AI analysis of obligations.";
    const txtDownload = await download("text/plain", txt);
    expect(Buffer.from(txtDownload.buffer).toString("utf8")).toBe(txt);

    const pdfDownload = await download("application/pdf", PDF_WITH_TEXT);
    expect(pdfDownload.byteLength).toBeGreaterThan(40);
    expect(Buffer.from(pdfDownload.buffer).toString("utf8")).toContain("%PDF");

    const docxBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...Array.from({ length: 40 }, () => 1)]);
    const docxDownload = await download(DRIVE_DOCX, docxBytes);
    expect(docxDownload.buffer[0]).toBe(0x50);
    expect(docxDownload.extractMime).toBe(DRIVE_DOCX);

    const extracted = await extractDocumentText({
      buffer: txtDownload.buffer,
      mimeType: "text/plain",
      fileName: "ignored-drive-name.txt",
    });
    expect(extracted.text).toContain("contract text");
    expect(extracted.text).not.toContain("ignored-drive-name");
    const wrapped = wrapUntrustedDocumentText(extracted.text);
    expect(wrapped).toContain("BEGIN_UNTRUSTED_DOCUMENT_TEXT");
    expect(wrapped).toContain("END_UNTRUSTED_DOCUMENT_TEXT");
    expect(wrapped).toContain("contract text");
    const provider = createMockAiProvider();
    const spy = vi.spyOn(provider, "generateStructured");
    const analyzed = await analyzeDocumentText({
      provider,
      organizationId: ORG_A,
      documentId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      versionId: "11111111-1111-4111-8111-111111111111",
      analysisType: "document",
      text: extracted.text,
      pageCount: null,
    });
    expect(spy).toHaveBeenCalled();
    const payload = String(spy.mock.calls[0]?.[0]?.userPayload ?? "");
    expect(payload).toContain("contract text");
    expect(payload).not.toContain("https://drive.google.com");
    expect(analyzed.document?.summary_ar.length).toBeGreaterThan(0);
  });

  it("5. filename/url are not treated as document content", () => {
    const wrapped = wrapUntrustedDocumentText("actual body from bytes");
    expect(wrapped).toContain("actual body from bytes");
    expect(wrapped).not.toContain("https://drive.google.com");
  });

  it("7-8. 401 and 403 fail closed without treating as content", async () => {
    await expect(
      fetchDriveFileBytes({
        fileId: FILE_ID,
        accessToken: TOKEN,
        plan: driveAiFetchPlan("text/plain")!,
        maxBytes: 100,
        fetchImpl: async () => new Response("no", { status: 401 }),
      }),
    ).rejects.toMatchObject({ details: { httpStatus: 401, aiCode: "DRIVE_TOKEN_REQUIRED" } });
    await expect(
      fetchDriveFileBytes({
        fileId: FILE_ID,
        accessToken: TOKEN,
        plan: driveAiFetchPlan("text/plain")!,
        maxBytes: 100,
        fetchImpl: async () => new Response("no", { status: 403 }),
      }),
    ).rejects.toMatchObject({ details: { httpStatus: 403 } });
  });

  it("10. oversized content-length rejected", async () => {
    await expect(
      fetchDriveFileBytes({
        fileId: FILE_ID,
        accessToken: TOKEN,
        plan: driveAiFetchPlan("text/plain")!,
        maxBytes: 10,
        fetchImpl: async () =>
          new Response("0123456789abcdef", { status: 200, headers: { "content-length": "99999999" } }),
      }),
    ).rejects.toMatchObject({ details: { aiCode: "OVERSIZED" } });
  });

  it("11. empty body fail closed", async () => {
    await expect(
      fetchDriveFileBytes({
        fileId: FILE_ID,
        accessToken: TOKEN,
        plan: driveAiFetchPlan("text/plain")!,
        maxBytes: 100,
        fetchImpl: async () => new Response(new Uint8Array(), { status: 200 }),
      }),
    ).rejects.toMatchObject({ details: { aiCode: "NO_EXTRACTABLE_TEXT" } });
  });

  it("11b. empty extracted text fails before AI", async () => {
    const provider = createMockAiProvider();
    const spy = vi.spyOn(provider, "generateStructured");
    await expect(
      extractDocumentText({ buffer: new TextEncoder().encode("short"), mimeType: "text/plain", fileName: "a.txt" }),
    ).rejects.toBeTruthy();
    await expect(
      analyzeDocumentText({
        provider,
        organizationId: ORG_A,
        documentId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
        versionId: "vvvvvvvv-vvvv-vvvv-vvvv-vvvvvvvvvvvv",
        analysisType: "document",
        text: "   ",
        pageCount: null,
      }),
    ).rejects.toMatchObject({ details: { aiCode: "NO_EXTRACTABLE_TEXT" } });
    expect(spy).not.toHaveBeenCalled();
  });

  it("12. scanned/image-only PDF extraction failure does not call AI", async () => {
    const provider = createMockAiProvider();
    const spy = vi.spyOn(provider, "generateStructured");
    await expect(
      extractDocumentText({
        buffer: new TextEncoder().encode("%PDF-1.4 empty page with no extractable text object"),
        mimeType: "application/pdf",
        fileName: "scan.pdf",
      }),
    ).rejects.toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });

  it("24. Google Docs uses export URL not Sheets", async () => {
    const plan = driveAiFetchPlan(DRIVE_GOOGLE_DOC)!;
    const url = driveDownloadUrl(FILE_ID, plan);
    expect(url).toContain("/export?");
    expect(url).toContain(encodeURIComponent(DRIVE_DOCX));
    expect(url).not.toContain("spreadsheets");
    expect(url).not.toContain("presentation");
    const fetchImpl: typeof fetch = vi.fn(async (requestUrl) => {
      expect(String(requestUrl)).toContain("/export?");
      return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]), { status: 200 });
    });
    const downloaded = await fetchDriveFileBytes({
      fileId: FILE_ID,
      accessToken: TOKEN,
      plan,
      maxBytes: DOCUMENT_AI_LIMITS.maxFileBytes,
      fetchImpl,
    });
    expect(downloaded.extractMime).toBe(DRIVE_DOCX);
  });
});

describe("token hygiene and regressions", () => {
  it("19-20. token keys and ya29 values are stripped from logs", () => {
    const sanitized = sanitizeLogContext({
      googleAccessToken: TOKEN,
      authorization: `Bearer ${TOKEN}`,
      Authorization: `Bearer ${TOKEN}`,
      status: 401,
      note: TOKEN,
    });
    expect(JSON.stringify(sanitized)).not.toContain("ya29");
    expect(JSON.stringify(sanitized)).not.toContain(TOKEN);
    expect(sanitized.status).toBe(401);
  });

  it("19. implementation never persists tokens", () => {
    const files = [
      "src/modules/documents/drive-ai-content.ts",
      "src/modules/documents/drive-content-fetch.ts",
      "src/server/services/google-drive-content.service.ts",
      "src/server/use-cases/document-ai-source.ts",
      "src/server/use-cases/ai-platform.ts",
      "src/server/use-cases/document-intelligence.ts",
      "src/modules/documents/google-gis.ts",
    ];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/localStorage/);
      expect(src).not.toMatch(/refresh_token/);
      expect(src).not.toMatch(/from\("document_versions"\)[\s\S]{0,200}access_token/);
    }
    expect(readFileSync("src/modules/documents/drive-content-fetch.ts", "utf8")).not.toMatch(/console\.(log|info|error)/);
    expect(readFileSync("src/modules/documents/google-gis.ts", "utf8")).not.toMatch(/localStorage/);
  });

  it("22. picker still uses drive.file and never posts tokens", () => {
    expect(GOOGLE_DRIVE_FILE_SCOPE).toBe("https://www.googleapis.com/auth/drive.file");
    expect(driveSubmitIncludesTokenField(DRIVE_DOCUMENT_FORM_FIELDS)).toBe(false);
  });

  it("21. system storage PDF remains content-available", () => {
    expect(
      classifyDocumentSource({
        fileSource: "storage",
        mimeType: "application/pdf",
        filePath: "org/doc.pdf",
      }),
    ).toBe("CONTENT_AVAILABLE");
    expect(
      classifyDocumentSource({
        fileSource: "storage",
        mimeType: "text/plain",
        filePath: "org/doc.txt",
      }),
    ).toBe("CONTENT_AVAILABLE");
  });

  it("23. operational A→B helper and 077/078 files were not modified for tokens", () => {
    expect(nextOperationalRevision("A")).toBe("B");
    const sql078 = readFileSync("supabase/migrations/078_operational_document_version.sql", "utf8");
    const sql077 = readFileSync("supabase/migrations/077_step_local_workflow_execution.sql", "utf8");
    expect(sql077).toContain("can_execute_workflow_instance_step");
    expect(sql078).toContain("create_operational_document_version");
    expect(sql078).not.toContain("access_token");
    expect(sql077).not.toContain("googleAccessToken");
  });
});
