"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/client";

export function PrintReportButton() {
  const { t } = useI18n();
  return (
    <Button
      type="button"
      variant="primary"
      className="print:hidden"
      data-testid="report-print-button"
      onClick={() => window.print()}
    >
      <Printer className="h-4 w-4" aria-hidden />
      {t.management.report.print}
    </Button>
  );
}
