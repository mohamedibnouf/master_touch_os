import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/password-forms";
import { getI18n } from "@/lib/i18n/server";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const { t } = await getI18n();
  const params = await searchParams;
  return (
    <AuthShell title={t.auth.forgot.title} description={t.auth.forgot.description} testId="forgot-password-page">
      {params.expired ? (
        <p className="mb-5 rounded-[var(--radius-control)] border border-warning-border bg-warning-soft px-3 py-2.5 text-sm text-warning">
          {t.auth.forgot.expired}
        </p>
      ) : null}
      <ForgotPasswordForm />
    </AuthShell>
  );
}
