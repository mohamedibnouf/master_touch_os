/** Period statuses whose entries an employee may see as a payslip (/my/payslips). */
export const PAYSLIP_VISIBLE_PERIOD_STATUSES = ["locked", "paid"] as const;

export function isPayslipVisibleStatus(status: string | null | undefined): boolean {
  return (PAYSLIP_VISIBLE_PERIOD_STATUSES as readonly string[]).includes(String(status ?? ""));
}
