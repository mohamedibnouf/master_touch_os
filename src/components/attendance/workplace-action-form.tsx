"use client";

import { useActionState } from "react";
import type { WorkplaceSaveState } from "@/server/use-cases/attendance";

export function WorkplaceActionForm({
  action,
  children,
  className,
  testId,
}: {
  action: (prev: WorkplaceSaveState, formData: FormData) => Promise<WorkplaceSaveState>;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  const [state, formAction] = useActionState<WorkplaceSaveState, FormData>(action, null);
  return (
    <form action={formAction} className={className} data-testid={testId}>
      {children}
      {state && !state.ok && state.message ? (
        <p className="text-sm text-danger" data-testid="workplace-action-error">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
