"use client";

import Link from "next/link";
import { Home, RotateCcw } from "lucide-react";
import { Button, Card } from "@/components/ui/primitives";
import { appErrorBoundaryCopy } from "@/lib/errors/boundary-copy";
import { format } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t, locale } = useI18n();
  const te = t.workspace.errors;
  const copy = appErrorBoundaryCopy(error, locale);
  return (
    <Card className="mx-auto max-w-lg p-6 md:p-6">
      <h1 className="text-lg font-semibold text-ink">{copy.title}</h1>
      <p className="mt-2 text-sm text-muted">{copy.body}</p>
      {error.digest ? (
        <p className="mt-2 text-xs text-muted">{format(te.reference, { digest: error.digest })}</p>
      ) : null}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button type="button" className="gap-2" onClick={() => reset()}>
          <RotateCcw className="h-4 w-4" aria-hidden />
          {te.retry}
        </Button>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-muted md:min-h-10"
        >
          <Home className="h-4 w-4" aria-hidden />
          {te.home}
        </Link>
      </div>
    </Card>
  );
}
