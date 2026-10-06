import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { StorageError, ValidationError } from "@/lib/errors";
import { operationalStorageObjectPath } from "@/modules/documents/operational-revision";

export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/vnd.ms-excel",
  "text/plain",
]);

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export class StorageService {
  constructor(private readonly supabase: SupabaseClient) {}

  validate(file: File): void {
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ValidationError("حجم الملف يتجاوز 50 ميجابايت.", "The file exceeds 50 MB.");
    }
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      throw new ValidationError("نوع الملف غير مسموح.", "This file type is not allowed.");
    }
  }

  async upload(input: {
    organizationId: string;
    projectId: string | null;
    documentId: string;
    revision: string;
    file: File;
  }): Promise<{ path: string; checksum: string }> {
    this.validate(input.file);
    const safeName = input.file.name.replace(/[^a-zA-Z0-9._-أ-ي]/g, "_");
    const path = operationalStorageObjectPath({
      organizationId: input.organizationId,
      projectId: input.projectId,
      documentId: input.documentId,
      revision: input.revision,
      safeFileName: safeName,
    });

    const buffer = new Uint8Array(await input.file.arrayBuffer());
    const checksum = await sha256(buffer);

    const { error } = await this.supabase.storage.from("documents").upload(path, buffer, {
      contentType: input.file.type,
      upsert: false,
    });

    if (error) {
      throw new StorageError(error);
    }

    return { path, checksum };
  }

  async signedUrl(path: string, expiresIn = 120): Promise<string> {
    const { data, error } = await this.supabase.storage.from("documents").createSignedUrl(path, expiresIn);
    if (error || !data?.signedUrl) {
      throw new StorageError(error);
    }
    return data.signedUrl;
  }
}

async function sha256(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data as unknown as BufferSource);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
