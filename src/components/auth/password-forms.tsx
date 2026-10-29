"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Field, Input } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/client";
import { changePasswordAction, requestPasswordResetAction } from "@/modules/auth/password-actions";
import type { PasswordFormState } from "@/lib/auth/password-policy";

const INITIAL: PasswordFormState = { ok: false, message: null };

function Submit({ label, pending, testId }: { label: string; pending: string; testId: string }) {
  const status = useFormStatus();
  return (
    <Button type="submit" className="h-11 w-full text-[0.9375rem]" data-testid={testId}>
      {status.pending ? pending : label}
    </Button>
  );
}

function Notice({ state }: { state: PasswordFormState }) {
  if (!state.message) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      data-testid="password-form-message"
      className={
        state.ok
          ? "rounded-[var(--radius-control)] border border-success-border bg-success-soft px-3 py-2.5 text-sm text-success"
          : "rounded-[var(--radius-control)] border border-danger-border bg-danger-soft px-3 py-2.5 text-sm text-danger"
      }
    >
      {state.message}
    </p>
  );
}

export function ForgotPasswordForm() {
  const { t } = useI18n();
  const [state, action] = useActionState(requestPasswordResetAction, INITIAL);
  return (
    <form action={action} className="space-y-5" data-testid="forgot-password-form">
      <Field label={t.auth.forgot.email}>
        <Input name="email" type="email" required autoComplete="email" dir="ltr" className="h-11" />
      </Field>
      <p className="text-xs leading-relaxed text-muted">{t.auth.forgot.employeeNote}</p>
      <Notice state={state} />
      <Submit label={t.auth.forgot.submit} pending={t.auth.forgot.submitting} testId="forgot-password-submit" />
      <Link href="/login" className="block text-center text-sm font-medium text-primary hover:underline">
        {t.auth.forgot.back}
      </Link>
    </form>
  );
}

export function ChangePasswordForm({ requireCurrent }: { requireCurrent: boolean }) {
  const { t } = useI18n();
  const [state, action] = useActionState(changePasswordAction, INITIAL);
  return (
    <form action={action} className="space-y-5" data-testid="change-password-form">
      {requireCurrent ? (
        <Field label={t.auth.change.current}>
          <Input name="current" type="password" required autoComplete="current-password" className="h-11" />
        </Field>
      ) : null}
      <Field label={t.auth.change.newPassword} hint={t.auth.change.hint}>
        <Input name="password" type="password" required minLength={8} autoComplete="new-password" className="h-11" />
      </Field>
      <Field label={t.auth.change.confirm}>
        <Input name="confirm" type="password" required minLength={8} autoComplete="new-password" className="h-11" />
      </Field>
      <Notice state={state} />
      <Submit label={t.auth.change.submit} pending={t.auth.change.submitting} testId="change-password-submit" />
    </form>
  );
}
