import { redirect } from "next/navigation";
import { getAuthContext } from "@/server/context";
import { AppShell } from "@/components/layout/app-shell";
import { isDisabledInteractiveAccount } from "@/lib/auth/interactive-account";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await getAuthContext();
  if (!ctx) {
    redirect("/login");
  }
  if (isDisabledInteractiveAccount(ctx)) {
    const supabase = await createServerSupabaseClient();
    await supabase.auth.signOut();
    redirect("/login?disabled=1");
  }

  return <AppShell ctx={ctx}>{children}</AppShell>;
}
