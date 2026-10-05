"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { FormActionState } from "@/server/forms/form-state";

function FormBusyNote() {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return <p className="text-sm text-muted">جارٍ التنفيذ… يرجى الانتظار.</p>;
}

function FormError({ state }: { state: FormActionState }) {
  if (!state || !state.message) return null;
  if (state.ok) {
    return (
      <p className="text-sm text-ink" data-testid="form-action-success">
        {state.message}
      </p>
    );
  }
  return (
    <p className="text-sm text-danger" data-testid="form-action-error">
      {state.message}
    </p>
  );
}

export function ServerActionForm({
  action,
  children,
  className,
  testId,
}: {
  action: (prev: FormActionState, formData: FormData) => Promise<FormActionState>;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  const [state, formAction, pending] = useActionState<FormActionState, FormData>(action, null);
  return (
    <form action={formAction} className={className} data-testid={testId} aria-busy={pending}>
      <fieldset disabled={pending} className="min-w-0 border-0 p-0">
        {children}
      </fieldset>
      <FormBusyNote />
      <FormError state={state} />
    </form>
  );
}
