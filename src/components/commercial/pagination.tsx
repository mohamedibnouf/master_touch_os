import Link from "next/link";
import { Button } from "@/components/ui/primitives";
import { format, type Locale } from "@/lib/i18n/config";
import { commercialComponentLabels } from "./labels";

export function RegisterPagination({
  basePath,
  page,
  totalPages,
  params,
  locale = "ar",
}: {
  basePath: string;
  page: number;
  totalPages: number;
  params: Record<string, string | undefined>;
  /** Label locale; Arabic unless passed. */
  locale?: Locale;
}) {
  if (totalPages <= 1) return null;
  const l = commercialComponentLabels(locale);

  function href(p: number) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v) q.set(k, v);
    }
    q.set("page", String(p));
    const qs = q.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  return (
    <div className="mt-4 flex items-center justify-between gap-3">
      <p className="text-sm text-muted">
        {format(l.pageOf, { page, total: totalPages })}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)}>
            <Button variant="secondary" type="button">
              {l.previous}
            </Button>
          </Link>
        ) : null}
        {page < totalPages ? (
          <Link href={href(page + 1)}>
            <Button variant="secondary" type="button">
              {l.next}
            </Button>
          </Link>
        ) : null}
      </div>
    </div>
  );
}
