import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { DatabaseError } from "@/lib/errors";

// Deliberately not in a "use server" file: exporting it from one would expose it as a
// public Server Action that skips the BOOTSTRAP_ADMIN_EMAIL check done by the caller.
export async function bootstrapAdminIfNeeded(email: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { error } = await admin.rpc("bootstrap_platform_admin", { p_email: email });
  if (error && !error.message.includes("CONFLICT")) {
    throw new DatabaseError(error);
  }
}
