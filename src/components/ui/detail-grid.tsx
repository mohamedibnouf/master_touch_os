import type { ReactNode } from "react";

export function DetailGrid({
  items,
}: {
  items: Array<{ label: string; value: ReactNode; testId?: string }>;
}) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 rounded-[var(--radius-control)] bg-paper/80 px-3 py-2.5">
          <dt className="text-[11px] font-medium text-muted">{item.label}</dt>
          <dd className="mt-1 break-words text-sm font-medium text-navy" dir="auto" data-testid={item.testId}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
