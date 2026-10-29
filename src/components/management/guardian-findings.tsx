"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Badge, Button } from "@/components/ui/primitives";
import { format, intlLocale, pickLocalized } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/client";
import type { DurableFinding, GuardianFindingStatus } from "@/modules/ai/guardian/types";
import {
  assignGuardianFindingAction,
  enableGuardianAlertsAction,
  updateGuardianFindingStatusAction,
} from "@/server/use-cases/guardian-actions";

const SEVERITY_TONE: Record<string, "danger" | "warning" | "neutral"> = {
  CRITICAL: "danger",
  HIGH: "danger",
  MEDIUM: "warning",
  LOW: "neutral",
};

const STATUS_TONE: Record<GuardianFindingStatus, "neutral" | "info" | "warning" | "success"> = {
  open: "warning",
  acknowledged: "info",
  in_review: "info",
  resolved: "success",
  dismissed: "neutral",
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
  const { t, locale } = useI18n();
  const g = t.management.guardian;
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function fmtDate(value: string | null): string {
    if (!value) return g.noScanYet;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString(intlLocale(locale), { timeZone: "Asia/Riyadh" });
  }

  function act(findingId: string, status: GuardianFindingStatus) {
    setError(null);
    start(async () => {
      let reviewNote: string | null = null;
      if (status === "dismissed" || status === "resolved") {
        const entered = window.prompt(status === "dismissed" ? g.dismissPrompt : g.resolvePrompt);
        if (!entered || entered.trim().length < 3) {
          setError(status === "dismissed" ? g.dismissRequired : g.resolveRequired);
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
      <div className="mb-4 rounded-[var(--radius-control)] border border-line bg-surface-muted px-3 py-2.5 text-xs text-muted">
        <p>
          {format(g.lastScan, { value: lastScan.finishedAt ? fmtDate(lastScan.finishedAt) : g.noScanYet })}
          {lastScan.status ? ` — ${lastScan.status}` : ""}
          {lastScan.coverageComplete === false ? ` — ${g.partialCoverage}` : ""}
        </p>
        <p className="mt-1" data-testid="guardian-alert-status">
          {alerts.enabled ? g.alertsEnabled : alerts.baselineCompletedAt ? g.alertsPaused : g.alertsFirstRun}
        </p>
      </div>
      {!alerts.enabled && alerts.baselineCompletedAt ? (
        <div className="mb-3">
          <Button type="button" variant="outline" disabled={pending} onClick={enableAlerts}>
            {g.enableAlerts}
          </Button>
        </div>
      ) : null}
      {error ? (
        <p className="mb-3 rounded-[var(--radius-control)] bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {open.length === 0 ? (
        <p className="text-sm text-muted">{g.empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {open.map((f) => {
            const title = pickLocalized(locale, f.titleAr, f.titleEn);
            return (
              <li key={f.id} className="space-y-2 py-4" data-testid="guardian-finding-item">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={SEVERITY_TONE[f.severity] ?? "neutral"}>
                    {(t.management.severity as Record<string, string>)[f.severity] ?? f.severity}
                  </Badge>
                  <Badge tone={STATUS_TONE[f.status]}>{g.status[f.status]}</Badge>
                  <span className="font-mono text-xs text-muted" dir="ltr">
                    {f.ruleId}
                  </span>
                  {f.href ? (
                    <Link href={f.href} className="font-medium text-ink hover:text-primary hover:underline">
                      {title}
                    </Link>
                  ) : (
                    <span className="font-medium text-ink">{title}</span>
                  )}
                </div>
                <p className="text-sm text-ink">{pickLocalized(locale, f.explanationAr, f.explanationEn)}</p>
                <p className="text-xs text-muted">{f.recommendedActionAr}</p>
                <p className="text-xs text-muted">
                  {format(g.firstSeen, { date: fmtDate(f.firstSeenAt) })} ·{" "}
                  {format(g.lastSeen, { date: fmtDate(f.lastSeenAt) })}
                  {f.assignedReviewerId ? ` · ${g.assigned}` : ""}
                  {f.lastEmailNotifiedAt ? ` · ${g.emailSent}` : ` · ${g.noEmail}`}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button type="button" variant="outline" disabled={pending} onClick={() => act(f.id, "acknowledged")}>
                    {g.acknowledge}
                  </Button>
                  <Button type="button" variant="outline" disabled={pending} onClick={() => assign(f.id)}>
                    {g.review}
                  </Button>
                  <Button type="button" variant="ghost" disabled={pending} onClick={() => act(f.id, "dismissed")}>
                    {g.dismiss}
                  </Button>
                  <Button type="button" variant="success" disabled={pending} onClick={() => act(f.id, "resolved")}>
                    {g.resolve}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
