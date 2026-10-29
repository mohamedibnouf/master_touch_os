"use client";

import type { ButtonHTMLAttributes } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

/**
 * Submit button that reacts the moment its form's Server Action starts: it disables
 * itself (no double submits) and shows a spinner until the action settles.
 * Rendered by <Button type="submit">, so every form gets it without changes.
 */
export function PendingSubmit({ children, disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { pending } = useFormStatus();
  return (
    <button {...props} type="submit" disabled={disabled || pending} aria-busy={pending || undefined} data-pending={pending || undefined}>
      {pending ? <Loader2 aria-hidden className="size-4 shrink-0 animate-spin" /> : null}
      {children}
    </button>
  );
}
