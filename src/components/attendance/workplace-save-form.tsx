"use client";

import { useActionState } from "react";
import {
  upsertWorkplaceLocationAction,
  type WorkplaceSaveState,
} from "@/server/use-cases/attendance";

export function WorkplaceSaveForm({
  children,
  className,
  testId,
}: {
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  const [state, formAction] = useActionState<WorkplaceSaveState, FormData>(upsertWorkplaceLocationAction, null);
  return (
    <form action={formAction} className={className} data-testid={testId}>
      {children}
      {state && !state.ok && state.message ? (
        <p className="text-sm text-danger" data-testid="workplace-save-error">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
