import "server-only";

import { fetchDriveFileBytes, type DriveFetchResult } from "@/modules/documents/drive-content-fetch";
import type { DriveAiFetchPlan } from "@/modules/documents/drive-ai-content";

export async function downloadAuthorizedDriveBytes(input: {
  fileId: string;
  accessToken: string;
  plan: DriveAiFetchPlan;
  maxBytes: number;
}): Promise<DriveFetchResult> {
  return fetchDriveFileBytes({
    fileId: input.fileId,
    accessToken: input.accessToken,
    plan: input.plan,
    maxBytes: input.maxBytes,
  });
}
