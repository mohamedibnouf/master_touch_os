import "server-only";

import { isPostgresUuid } from "@/lib/postgres-uuid";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function markOwnedNotificationRead(
  id: string,
): Promise<{ ok: true } | { ok: false; status: 400 | 401 | 403 | 500 }> {
  const ctx = await getAuthContext();
  if (!ctx) return { ok: false, status: 401 };
  try {
    authorize(ctx, "notification.read");
  } catch {
    return { ok: false, status: 403 };
  }
  if (!isPostgresUuid(id)) return { ok: false, status: 400 };
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("recipient_profile_id", ctx.userId);
  if (error) return { ok: false, status: 500 };
  return { ok: true };
}
