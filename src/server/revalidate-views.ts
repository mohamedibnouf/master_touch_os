import "server-only";

import { refresh, revalidatePath } from "next/cache";

/**
 * Revalidates the given pages after a Server Action mutation and asks the client
 * router to refresh the page the user is on, so status changes (e.g. Draft →
 * Pending approval) appear without a manual reload. `refresh()` only works inside
 * a Server Action; elsewhere it is skipped and only the paths are revalidated.
 */
export function revalidateViews(...paths: Array<string | null | undefined | false>): void {
  try {
    refresh();
  } catch {
    // Not running inside a Server Action (route handler, job) — path revalidation is enough.
  }
  for (const path of new Set(paths.filter((p): p is string => typeof p === "string" && p.length > 0))) {
    revalidatePath(path);
  }
}
