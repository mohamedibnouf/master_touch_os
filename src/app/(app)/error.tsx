"use client";

import { RotateCcw } from "lucide-react";
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
    <Card className="p-6 md:p-6">
      <h1 className="text-lg font-semibold text-ink">{copy.title}</h1>
      <p className="mt-2 text-sm text-muted">{copy.body}</p>
      {error.digest ? (
        <p className="mt-2 text-xs text-muted">{format(te.reference, { digest: error.digest })}</p>
      ) : null}
      <Button type="button" className="mt-4 gap-2" onClick={() => reset()}>
        <RotateCcw className="h-4 w-4" aria-hidden />
        {te.retry}
      </Button>
    </Card>
  );
}
