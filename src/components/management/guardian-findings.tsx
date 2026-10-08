"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Badge, Button } from "@/components/ui/primitives";
import type { DurableFinding, GuardianFindingStatus } from "@/modules/ai/guardian/types";
import {
  assignGuardianFindingAction,
  enableGuardianAlertsAction,
  updateGuardianFindingStatusAction,
} from "@/server/use-cases/guardian-actions";

const STATUS_AR: Record<GuardianFindingStatus, string> = {
  open: "مفتوح",
  acknowledged: "مُقرّ",
  in_review: "قيد المراجعة",
  resolved: "مُغلق",
  dismissed: "مُستبعد",
};

const SEVERITY_AR: Record<string, string> = {
  CRITICAL: "حرج",
  HIGH: "مرتفع",
  MEDIUM: "متوسط",
  LOW: "منخفض",
};

export function GuardianFindingsPanel({
  findings,
  lastScan,
  alerts,
}: {
  findings: DurableFinding[];
  lastScan: { finishedAt: string | null; status: string | null; coverageComplete: boolean | null };
  alerts: { enabled: boolean; baselineCompletedAt: string | null };
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function act(findingId: string, status: GuardianFindingStatus) {
    setError(null);
    start(async () => {
      let reviewNote: string | null = null;
      if (status === "dismissed" || status === "resolved") {
        const entered = window.prompt(status === "dismissed" ? "سبب الاستبعاد" : "ملاحظة التحقق من الإغلاق");
        if (!entered || entered.trim().length < 3) {
          setError(status === "dismissed" ? "الاستبعاد يتطلب سبباً." : "الإغلاق يتطلب ملاحظة تحقق.");
          return;
        }
        reviewNote = entered.trim();
      }
      const res = await updateGuardianFindingStatusAction({ findingId, status, reviewNote });
      if (!res.ok) setError(res.error);
      else window.location.reload();
    });
  }

  function assign(findingId: string) {
    setError(null);
    start(async () => {
      const res = await assignGuardianFindingAction({ findingId });
      if (!res.ok) setError(res.error);
      else window.location.reload();
    });
  }

  function enableAlerts() {
    setError(null);
    start(async () => {
      const res = await enableGuardianAlertsAction();
      if (!res.ok) setError(res.error);
      else window.location.reload();
    });
  }

  const open = findings.filter((f) => f.status === "open" || f.status === "acknowledged" || f.status === "in_review");

  return (
    <div data-testid="guardian-findings">
      <p className="mb-3 text-xs text-muted">
        آخر مسح للحارس: {lastScan.finishedAt ?? "لا يوجد بعد"}
        {lastScan.status ? ` — ${lastScan.status}` : ""}
        {lastScan.coverageComplete === false ? " — التغطية جزئية ولم تُغلق نتائج غير المرصودة" : ""}
      </p>
      <p className="mb-3 text-xs text-muted" data-testid="guardian-alert-status">
        {alerts.enabled
          ? "تنبيهات البريد الحرجة مفعّلة بعد اعتماد المسح الأساسي."
          : alerts.baselineCompletedAt
            ? "المسح الأساسي مكتمل. التنبيهات متوقفة حتى التفعيل اليدوي."
            : "التشغيل الأول يحفظ النتائج دون إرسال بريد."}
      </p>
      {!alerts.enabled && alerts.baselineCompletedAt ? (
        <div className="mb-3">
          <Button type="button" variant="outline" disabled={pending} onClick={enableAlerts}>
            تفعيل تنبيهات البريد الحرجة
          </Button>
        </div>
      ) : null}
      {error ? <p className="mb-2 text-sm text-danger">{error}</p> : null}
      {open.length === 0 ? (
        <p className="text-sm text-muted">لا توجد نتائج مفتوحة في سجل الحارس.</p>
      ) : (
        <ul className="divide-y divide-line">
          {open.map((f) => (
            <li key={f.id} className="space-y-2 py-4" data-testid="guardian-finding-item">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={f.severity === "LOW" ? "neutral" : "danger"}>{SEVERITY_AR[f.severity] ?? f.severity}</Badge>
                <Badge tone="neutral">{STATUS_AR[f.status]}</Badge>
                <span className="text-xs text-muted">{f.ruleId}</span>
                {f.href ? (
                  <Link href={f.href} className="font-medium text-navy underline">
                    {f.titleAr}
                  </Link>
                ) : (
                  <span className="font-medium text-navy">{f.titleAr}</span>
                )}
              </div>
              <p className="text-sm text-ink">{f.explanationAr}</p>
              <p className="text-xs text-muted">{f.recommendedActionAr}</p>
              <p className="text-xs text-muted">
                أول رصد: {f.firstSeenAt} · آخر رصد: {f.lastSeenAt}
                {f.assignedReviewerId ? " · معيّن للمراجعة" : ""}
                {f.lastEmailNotifiedAt ? " · بريد مُرسل" : " · بدون بريد بعد"}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={pending} onClick={() => act(f.id, "acknowledged")}>
                  إقرار
                </Button>
                <Button type="button" variant="outline" disabled={pending} onClick={() => assign(f.id)}>
                  قيد المراجعة
                </Button>
                <Button type="button" variant="outline" disabled={pending} onClick={() => act(f.id, "dismissed")}>
                  استبعاد
                </Button>
                <Button type="button" variant="outline" disabled={pending} onClick={() => act(f.id, "resolved")}>
                  إغلاق
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
