"use client";

export function PrintReportButton() {
  return (
    <button
      type="button"
      className="rounded-md bg-navy px-4 py-2 text-sm font-medium text-white print:hidden"
      data-testid="report-print-button"
      onClick={() => window.print()}
    >
      طباعة
    </button>
  );
}
