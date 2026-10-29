"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowLeft } from "lucide-react";
import { signInAction } from "@/modules/auth/actions";
import { Button, Field, Input } from "@/components/ui/primitives";
import { EMPLOYEE_LOGIN_FAILURE_AR, LOGIN_RATE_LIMIT_AR } from "@/lib/auth/employee-login";
import { useI18n } from "@/lib/i18n/client";

function SubmitButton() {
  const { t } = useI18n();
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="h-11 w-full text-[0.9375rem]" data-testid="login-submit">
      {pending ? t.auth.submitting : t.auth.submit}
      {pending ? null : <ArrowLeft className="size-4 ltr:-scale-x-100" aria-hidden />}
    </Button>
  );
}

export function LoginForm({ nextPath = "" }: { nextPath?: string }) {
  const { t } = useI18n();
  const [state, formAction] = useActionState(signInAction, { error: null as string | null });
  // The action returns its canonical Arabic messages; show them in the active language.
  const error =
    state.error === EMPLOYEE_LOGIN_FAILURE_AR
      ? t.auth.failure
      : state.error === LOGIN_RATE_LIMIT_AR
        ? t.auth.rateLimited
        : state.error;

  return (
    <form action={formAction} className="space-y-5" data-testid="login-form">
      {nextPath ? <input type="hidden" name="next" value={nextPath} /> : null}
      <Field label={t.auth.identifier}>
        <Input
          name="identifier"
          type="text"
          required
          autoComplete="username"
          inputMode="text"
          dir="auto"
          className="h-11"
          data-testid="login-identifier"
        />
      </Field>
      <Field label={t.auth.password}>
        <Input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="h-11"
          data-testid="login-password"
        />
      </Field>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs leading-relaxed text-muted">{t.auth.identifierHint}</p>
        <Link
          href="/auth/forgot-password"
          className="shrink-0 text-xs font-medium text-primary hover:underline"
          data-testid="login-forgot-password"
        >
          {t.auth.forgotLink}
        </Link>
      </div>
      {error ? (
        <p
          className="rounded-[var(--radius-control)] border border-danger-border bg-danger-soft px-3 py-2.5 text-sm text-danger"
          role="alert"
          data-testid="login-error"
        >
          {error}
        </p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
