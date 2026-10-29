/**
 * `approval_requests.title_en` arrives with migration 086. Until it is applied,
 * selecting the column fails (42703 / schema cache), so reads try with it and
 * fall back to the historical projection without it.
 */

type PgLikeError = { code?: string | null; message?: string | null } | null | undefined;

export function isMissingTitleEnColumnError(error: PgLikeError): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  if (!/title_en/i.test(message)) return false;
  return error.code === "42703" || error.code === "PGRST204" || /does not exist|schema cache|column/i.test(message);
}

/** Remembers a missing column briefly so every request does not pay for a failed attempt. */
const MISSING_TTL_MS = 60_000;
let missingSince: number | null = null;

export function resetTitleEnColumnCacheForTests(): void {
  missingSince = null;
}

/**
 * Runs `run(true)` (projection including `title_en`) and, when the column does
 * not exist yet, re-runs `run(false)` with the old projection.
 */
export async function selectWithOptionalTitleEn<R extends { error: PgLikeError }>(
  run: (withTitleEn: boolean) => PromiseLike<R>,
): Promise<R> {
  if (missingSince !== null && Date.now() - missingSince < MISSING_TTL_MS) {
    return run(false);
  }
  const first = await run(true);
  if (isMissingTitleEnColumnError(first.error)) {
    missingSince = Date.now();
    return run(false);
  }
  missingSince = null;
  return first;
}

/** Appends `, title_en` to an approval_requests column list when enabled. */
export function approvalTitleColumns(columns: string, withTitleEn: boolean): string {
  return withTitleEn ? `${columns}, title_en` : columns;
}

/** True when an RPC error means 086 (set_approval_request_title_en) is not applied yet. */
export function isMissingTitleEnRpcError(error: PgLikeError): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    (/set_approval_request_title_en|title_en/i.test(message) && /does not exist|schema cache|could not find/i.test(message))
  );
}

type RpcClient = {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ error: { code?: string | null; message?: string | null } | null }>;
};

/**
 * Stores the English approval title through the 086 RPC. Best-effort: before
 * 086 is applied the function does not exist, which is logged and ignored so
 * approval creation keeps working.
 */
export async function setApprovalRequestTitleEn(
  supabase: RpcClient,
  requestId: string,
  titleEn: string | null | undefined,
  warn: (message: string, detail: Record<string, unknown>) => void,
): Promise<void> {
  const value = titleEn?.trim();
  if (!value) return;
  try {
    const { error } = await supabase.rpc("set_approval_request_title_en", {
      p_request_id: requestId,
      p_title_en: value.slice(0, 240),
    });
    if (!error) return;
    if (isMissingTitleEnRpcError(error)) {
      warn("set_approval_request_title_en unavailable (apply migration 086); English title skipped", {
        detail: error.message ?? null,
      });
      return;
    }
    warn("Failed to store English approval title", { detail: error.message ?? null });
  } catch (error) {
    warn("Failed to store English approval title", { detail: error instanceof Error ? error.message : String(error) });
  }
}
