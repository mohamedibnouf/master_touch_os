import { ValidationError } from "@/lib/errors";
import { driveDownloadUrl, type DriveAiFetchPlan } from "./drive-ai-content";

export type DriveFetchResult = {
  buffer: Uint8Array;
  extractMime: string;
  byteLength: number;
};

function mapDriveHttpError(status: number): ValidationError {
  if (status === 401) {
    return new ValidationError(
      "انتهت صلاحية تفويض Google Drive. أعد التفويض ثم حاول مرة أخرى.",
      "Google Drive authorization expired. Sign in again and retry.",
      { aiCode: "DRIVE_TOKEN_REQUIRED", httpStatus: status },
    );
  }
  if (status === 403) {
    return new ValidationError(
      "لا يمكن قراءة هذا الملف من Google Drive بصلاحيات التطبيق الحالية.",
      "This Google Drive file cannot be read with the current app authorization.",
      { aiCode: "DRIVE_FORBIDDEN", httpStatus: status },
    );
  }
  if (status === 404) {
    return new ValidationError(
      "ملف Google Drive غير موجود أو تم حذفه.",
      "The Google Drive file was not found or was deleted.",
      { aiCode: "DRIVE_NOT_FOUND", httpStatus: status },
    );
  }
  return new ValidationError(
    "تعذر تنزيل ملف Google Drive.",
    "The Google Drive file could not be downloaded.",
    { aiCode: "DRIVE_FETCH_FAILED", httpStatus: status },
  );
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ValidationError("حجم الملف يتجاوز حد التحليل.", "The file exceeds the analysis size limit.", {
      aiCode: "OVERSIZED",
    });
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      throw new ValidationError("حجم الملف يتجاوز حد التحليل.", "The file exceeds the analysis size limit.", {
        aiCode: "OVERSIZED",
      });
    }
    return buf;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ValidationError("حجم الملف يتجاوز حد التحليل.", "The file exceeds the analysis size limit.", {
        aiCode: "OVERSIZED",
      });
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function fetchDriveFileBytes(input: {
  fileId: string;
  accessToken: string;
  plan: DriveAiFetchPlan;
  maxBytes: number;
  fetchImpl?: typeof fetch;
}): Promise<DriveFetchResult> {
  const url = driveDownloadUrl(input.fileId, input.plan);
  const fetchFn = input.fetchImpl ?? fetch;
  const response = await fetchFn(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
    },
    redirect: "error",
  });

  if (!response.ok) {
    throw mapDriveHttpError(response.status);
  }

  const buffer = await readBoundedBody(response, input.maxBytes);
  if (buffer.byteLength === 0) {
    throw new ValidationError("ملف Google Drive فارغ.", "The Google Drive file is empty.", {
      aiCode: "NO_EXTRACTABLE_TEXT",
    });
  }

  return {
    buffer,
    extractMime: input.plan.extractMime,
    byteLength: buffer.byteLength,
  };
}
