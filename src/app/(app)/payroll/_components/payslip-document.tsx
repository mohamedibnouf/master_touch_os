import { Badge } from "@/components/ui/primitives";
import { format, pickLocalized, type Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/dictionaries/ar";
import { formatPeriodLabel, formatSar } from "@/lib/payroll/format";
import type { PayrollDeduction, PayrollEarning, PayrollEntry, PayrollPeriod } from "@/types/models";

type Line = Pick<PayrollEarning | PayrollDeduction, "id" | "description_ar" | "description_en" | "amount" | "is_manual">;

function paymentTone(status: string): "neutral" | "success" | "warning" {
  if (status === "paid") return "success";
  if (status === "partial") return "warning";
  return "neutral";
}

function LinesTable({
  title,
  lines,
  emptyText,
  totalLabel,
  total,
  tone,
  rowTestId,
  showManual,
  manualLabel,
  locale,
}: {
  title: string;
  lines: Line[];
  emptyText: string;
  totalLabel: string;
  total: number;
  tone: "earning" | "deduction";
  rowTestId?: string;
  showManual: boolean;
  manualLabel: string;
  locale: Locale;
}) {
  return (
    <section className="min-w-0 break-inside-avoid">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <table className="w-full text-sm">
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={2} className="py-3 text-muted">
                {emptyText}
              </td>
            </tr>
          ) : (
            lines.map((row) => (
              <tr key={row.id} className="border-b border-line" data-testid={rowTestId}>
                <td className="py-2 pe-3 text-ink">
                  {pickLocalized(locale, row.description_ar, row.description_en)}
                  {showManual && row.is_manual ? <Badge className="ms-2 print:hidden">{manualLabel}</Badge> : null}
                </td>
                <td className="py-2 text-end tabular-nums text-ink">{formatSar(row.amount, locale)}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-line">
            <th scope="row" className="pt-2.5 text-start font-semibold text-ink">
              {totalLabel}
            </th>
            <td
              className={`pt-2.5 text-end font-semibold tabular-nums ${tone === "deduction" ? "text-danger" : "text-ink"}`}
            >
              {formatSar(total, locale)}
            </td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

/** Printable payslip: header + employee meta, earnings vs deductions, prominent net pay. */
export function PayslipDocument({
  entry,
  period,
  earnings,
  deductions,
  t,
  locale,
  netTestId,
  earningRowTestId,
  deductionRowTestId,
  showManual = false,
}: {
  entry: PayrollEntry;
  period: PayrollPeriod | null;
  earnings: Line[];
  deductions: Line[];
  t: Dictionary["payroll"];
  locale: Locale;
  netTestId: string;
  earningRowTestId?: string;
  deductionRowTestId?: string;
  showManual?: boolean;
}) {
  const tp = t.payslip;
  const tc = t.common;
  const paymentLabel =
    entry.payment_status in tc.paymentStatus
      ? tc.paymentStatus[entry.payment_status as keyof typeof tc.paymentStatus]
      : entry.payment_status;

  return (
    <article className="mt-surface overflow-hidden print:border print:border-line print:shadow-none">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-surface-muted px-4 py-4 md:px-6">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{tp.documentTitle}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
            {period ? format(tp.periodLabel, { period: formatPeriodLabel(period.year, period.month) }) : "—"}
          </p>
        </div>
        <div className="text-end">
          <p className="text-xs text-muted">{tp.paymentStatus}</p>
          <Badge className="mt-1" tone={paymentTone(entry.payment_status)}>
            {paymentLabel}
          </Badge>
        </div>
      </header>

      <dl className="grid gap-x-6 gap-y-3 border-b border-line px-4 py-4 text-sm sm:grid-cols-2 md:px-6 lg:grid-cols-4 print:grid-cols-4">
        <div className="min-w-0">
          <dt className="text-xs text-muted">{tp.employee}</dt>
          <dd className="mt-0.5 truncate font-medium text-ink">{entry.employee_name ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{tp.employeeNumber}</dt>
          <dd className="mt-0.5 font-mono text-ink">{entry.employee_number ?? "—"}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">{tp.department}</dt>
          <dd className="mt-0.5 truncate text-ink">{entry.department_name ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{tp.payPeriod}</dt>
          <dd className="mt-0.5 tabular-nums text-ink">
            {period ? format(tc.periodRange, { start: period.period_start, end: period.period_end }) : "—"}
          </dd>
        </div>
      </dl>

      <div className="grid gap-6 px-4 py-5 md:px-6 lg:grid-cols-2 print:grid-cols-2">
        <LinesTable
          title={tp.earnings}
          lines={earnings}
          emptyText={tp.noEarnings}
          totalLabel={tc.gross}
          total={entry.gross_pay}
          tone="earning"
          rowTestId={earningRowTestId}
          showManual={showManual}
          manualLabel={tc.manual}
          locale={locale}
        />
        <LinesTable
          title={tp.deductions}
          lines={deductions}
          emptyText={tp.noDeductions}
          totalLabel={tp.totalDeductions}
          total={entry.total_deductions}
          tone="deduction"
          rowTestId={deductionRowTestId}
          showManual={showManual}
          manualLabel={tc.manual}
          locale={locale}
        />
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-primary-soft px-4 py-4 md:px-6 print:bg-transparent">
        <p className="text-sm font-semibold text-primary">{tp.netPay}</p>
        <p className="text-2xl font-semibold tabular-nums tracking-tight text-primary md:text-3xl" data-testid={netTestId}>
          {formatSar(entry.net_pay, locale)}
        </p>
      </footer>
    </article>
  );
}
