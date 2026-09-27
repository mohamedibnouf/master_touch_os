"use client";

import { appErrorBoundaryCopy } from "@/lib/errors/boundary-copy";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const copy = appErrorBoundaryCopy(error);
  return (
    <div className="rounded-lg border border-line bg-white p-6">
      <h1 className="text-lg font-semibold text-navy">{copy.title}</h1>
      <p className="mt-2 text-sm text-muted">{copy.body}</p>
      {error.digest ? <p className="mt-2 text-xs text-muted">مرجع: {error.digest}</p> : null}
      <button
        type="button"
        className="mt-4 inline-flex min-h-11 items-center justify-center rounded-md bg-navy px-4 text-sm text-white"
        onClick={() => reset()}
      >
        إعادة المحاولة
      </button>
    </div>
  );
}
