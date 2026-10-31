"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/client";

export function PerformancePrintButton() {
  const { t } = useI18n();
  return (
    <Button
      type="button"
      variant="secondary"
      className="print:hidden"
      data-testid="perf-print"
      onClick={() => window.print()}
    >
      <Printer className="h-4 w-4" aria-hidden />
      {t.tasksPerformance.print}
    </Button>
  );
}
