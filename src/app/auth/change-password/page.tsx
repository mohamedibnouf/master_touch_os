import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { ChangePasswordForm } from "@/components/auth/password-forms";
import { Button } from "@/components/ui/primitives";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { mustChangePassword } from "@/lib/auth/password-policy";
import { signOutAction } from "@/modules/auth/actions";
import { getI18n } from "@/lib/i18n/server";

export default async function ChangePasswordPage() {
  const { t } = await getI18n();
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect("/login");

  const forced = mustChangePassword(claims.user_metadata);
  const fromRecovery = Array.isArray(claims.amr) && claims.amr.some((m) => (m as { method?: string }).method === "recovery");
  const description = forced
    ? t.auth.change.descriptionForced
    : fromRecovery
      ? t.auth.change.descriptionRecovery
      : t.auth.change.description;

  return (
    <AuthShell title={t.auth.change.title} description={description} testId="change-password-page">
      <ChangePasswordForm requireCurrent={!forced && !fromRecovery} />
      <form action={signOutAction} className="mt-4">
        <Button type="submit" variant="ghost" className="w-full">
          {t.auth.change.signOut}
        </Button>
      </form>
    </AuthShell>
  );
}
