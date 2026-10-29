import type { ReactNode } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/primitives";

export type RegisterColumn = {
  key: string;
  header: string;
  className?: string;
};

export function RegisterTable({
  columns,
  rows,
  emptyTitle = "لا توجد سجلات.",
  getRowHref,
}: {
  columns: RegisterColumn[];
  rows: Record<string, ReactNode>[];
  emptyTitle?: string;
  getRowHref?: (row: Record<string, ReactNode>, index: number) => string | null;
}) {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-paper text-start text-muted">
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={`px-4 py-3 font-medium ${col.className ?? ""}`}>
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
                <tr key={idx} className="hover:bg-paper/60">
                  {cells.map((cell, i) => (
                    <td key={columns[i].key} className="border-t border-line px-4 py-3">
                      {i === 0 ? (
                        <Link href={href} className="font-medium text-navy underline">
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
