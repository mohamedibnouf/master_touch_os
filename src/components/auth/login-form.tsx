"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { signInAction } from "@/modules/auth/actions";
import { Button, Field, Input } from "@/components/ui/primitives";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending} data-testid="login-submit">
      {pending ? "جارٍ الدخول..." : "دخول"}
    </Button>
  );
}

export function LoginForm({ nextPath = "" }: { nextPath?: string }) {
  const [state, formAction] = useActionState(signInAction, { error: null as string | null });

  return (
    <form action={formAction} className="space-y-4" data-testid="login-form">
      {nextPath ? <input type="hidden" name="next" value={nextPath} /> : null}
      <Field label="الرقم الوظيفي">
        <Input
          name="identifier"
          type="text"
          required
          autoComplete="username"
          inputMode="text"
          data-testid="login-identifier"
        />
      </Field>
      <Field label="كلمة المرور">
        <Input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          data-testid="login-password"
        />
      </Field>
      <p className="text-xs text-muted">المديرون ومسؤولو المنصة يمكنهم إدخال البريد الإلكتروني في حقل الرقم الوظيفي.</p>
      {state.error ? (
        <p className="text-sm text-danger" data-testid="login-error">
          {state.error}
        </p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
