import { z } from "zod";

const optionalUuid = z.union([z.string().uuid(), z.literal("")]).optional();

export const uploadDocumentSchema = z
  .object({
    title: z.string().trim().min(2).max(240),
    category: z.string().min(2).max(60),
    projectId: optionalUuid,
    documentId: optionalUuid,
    confidentiality: z.enum(["internal", "confidential", "restricted"]).default("internal"),
    fileSource: z.enum(["storage", "google_drive"]).default("storage"),
    driveUrl: z.string().trim().max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.fileSource === "google_drive" && !value.driveUrl) {
      ctx.addIssue({ code: "custom", message: "drive_url_required", path: ["driveUrl"] });
    }
  });

export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;

export function isStorageFileRequired(fileSource: string | undefined): boolean {
  return fileSource !== "google_drive";
}
