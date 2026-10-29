import type { ReactNode } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/primitives";
import type { Locale } from "@/lib/i18n/config";
import { commercialComponentLabels } from "./labels";

export type RegisterColumn = {
  key: string;
  header: string;
  className?: string;
};

export function RegisterTable({
  columns,
  rows,
  emptyTitle,
  getRowHref,
  locale = "ar",
}: {
  columns: RegisterColumn[];
  rows: Record<string, ReactNode>[];
  emptyTitle?: string;
  getRowHref?: (row: Record<string, ReactNode>, index: number) => string | null;
  /** Locale for the default empty-state label; Arabic unless passed. */
  locale?: Locale;
}) {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle ?? commercialComponentLabels(locale).noRecords} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-surface-muted text-start text-xs text-muted">
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={`px-4 py-3 text-start font-medium ${col.className ?? ""}`}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const href = getRowHref?.(row, idx);
            const cells = columns.map((col) => (
              <td key={col.key} className="border-t border-line px-4 py-3">
                {row[col.key]}
              </td>
            ));
            if (href) {
              return (
                <tr key={idx} className="hover:bg-surface-muted">
                  {cells.map((cell, i) => (
                    <td key={columns[i].key} className="border-t border-line px-4 py-3">
                      {i === 0 ? (
                        <Link href={href} className="font-medium text-primary hover:underline">
                          {row[columns[i].key]}
                        </Link>
                      ) : (
                        row[columns[i].key]
                      )}
                    </td>
                  ))}
                </tr>
              );
            }
            return (
              <tr key={idx} className="border-t border-line">
                {cells}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
