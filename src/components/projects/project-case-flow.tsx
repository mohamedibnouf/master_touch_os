"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, Check, Circle, Clock, Lock, Shield } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { displayInitials } from "@/lib/ui/initials";
import { formatRiyadhDateTimeAr } from "@/modules/projects/deadline";
import { cn } from "@/lib/utils";
import type { WorkflowViewNode } from "@/server/use-cases/project-workflow";

const ICON: Record<WorkflowViewNode["visual"], typeof Check> = {
  completed: Check,
  current: Circle,
  waiting_approval: Clock,
  changes_requested: AlertTriangle,
  rejected: AlertTriangle,
  blocked: AlertTriangle,
  overdue: AlertTriangle,
  upcoming: Lock,
};

function nodeTone(node: WorkflowViewNode) {
  if (node.visual === "completed") return "success" as const;
  if (node.visual === "overdue" || node.visual === "rejected" || node.visual === "blocked") return "danger" as const;
  if (node.deadlineState === "DUE_SOON" || node.visual === "waiting_approval" || node.visual === "changes_requested") {
    return "warning" as const;
  }
  if (node.visual === "current") return "info" as const;
  return "neutral" as const;
}

function connectorClass(node: WorkflowViewNode) {
  if (node.visual === "completed") return "bg-success";
  if (node.visual === "overdue") return "bg-danger/70";
  if (node.visual === "current" || node.visual === "waiting_approval") return "bg-primary";
  return "bg-line";
}

function ResponsibleBlock({ node }: { node: WorkflowViewNode }) {
  const label = node.responsibleLabel ?? "غير محدد";
  return (
    <div className="flex min-w-0 items-center gap-2 sm:justify-end">
      <span
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-strong text-[11px] font-semibold text-ink"
        aria-hidden
      >
        {node.assignmentKind === "role" || node.assignmentKind === "department" ? (
          <Shield className="h-3.5 w-3.5 text-muted" />
        ) : (
          displayInitials(label)
        )}
      </span>
      <div className="min-w-0 sm:text-end">
        <p className="text-[11px] text-muted">المسؤول</p>
        <p className="truncate text-sm font-medium text-ink" dir="auto">
          {label}
        </p>
        {node.assignmentSubtitle ? <p className="truncate text-xs text-muted">{node.assignmentSubtitle}</p> : null}
      </div>
    </div>
  );
}

export function ProjectCaseFlow({ children }: { children: ReactNode }) {
  return (
    <ol className="space-y-0" data-testid="project-workflow-timeline">
      {children}
    </ol>
  );
}

export function CaseFlowStep({
  node,
  current,
  isLast,
  children,
}: {
  node: WorkflowViewNode;
  current: boolean;
  isLast: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(current);
  const tone = nodeTone(node);
  const Icon = ICON[node.visual];
  const seq = String(node.sequence).padStart(2, "0");

  return (
    <li className="flex gap-3">
      <div className="flex w-8 shrink-0 flex-col items-center">
        <button
          type="button"
          aria-expanded={open}
          aria-current={current ? "step" : undefined}
          aria-label={`${seq} ${node.nameAr} — ${node.visualLabel}`}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-full border text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
            tone === "success" && "border-success bg-success text-white",
            tone === "info" && "border-primary bg-primary text-white",
            tone === "warning" && "border-warning bg-warning-soft text-warning",
            tone === "danger" && "border-danger bg-danger-soft text-danger",
            tone === "neutral" && "border-line bg-surface-muted text-muted",
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </button>
        {!isLast ? <span className={cn("mt-1 w-px min-h-8 flex-1", connectorClass(node))} aria-hidden /> : null}
      </div>
      <div
        className={cn(
          "mb-3 min-w-0 flex-1 rounded-[var(--radius-surface)] border px-3 py-3",
          current && node.visual !== "overdue" && node.deadlineState !== "DUE_SOON" && "border-info-border bg-info-soft/70",
          current && node.deadlineState === "DUE_SOON" && "border-warning-border bg-warning-soft",
          node.visual === "overdue" && "border-danger-border bg-danger-soft",
          !current && node.visual === "completed" && "border-line bg-surface-muted/50",
          !current && node.visual === "upcoming" && "border-line bg-white",
          !current && node.visual !== "completed" && node.visual !== "upcoming" && node.visual !== "overdue" && "border-line bg-white",
        )}
      >
        <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <button type="button" className="min-w-0 text-start" onClick={() => setOpen((v) => !v)}>
            <p className="text-[11px] tabular-nums text-muted">{seq}</p>
            <p className="truncate text-sm font-semibold text-ink" dir="auto">
              {node.nameAr}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Badge tone={tone === "info" ? "info" : tone === "neutral" ? "neutral" : tone}>
                {current && node.visual !== "overdue" ? "المرحلة الحالية" : node.visualLabel}
              </Badge>
              {node.requiresApproval ? <Badge tone="info">يتطلب اعتماد</Badge> : null}
              {node.deadlineState === "DUE_SOON" ? <Badge tone="warning">اقترب موعد الانتهاء</Badge> : null}
              {node.latestOfficialCode === "A" || node.latestOfficialCode === "B" ? (
                <Badge tone="success">تم الاعتماد</Badge>
              ) : null}
              {node.latestOfficialCode === "C" ? <Badge tone="warning">يتطلب تعديل</Badge> : null}
              {node.latestOfficialCode === "D" ? <Badge tone="danger">مرفوض</Badge> : null}
            </div>
          </button>
          <div className="min-w-0 sm:max-w-[15rem]">
            <ResponsibleBlock node={node} />
            {node.dueAt ? (
              <p className="mt-1 text-xs text-muted sm:text-end">موعد الإغلاق {formatRiyadhDateTimeAr(node.dueAt)}</p>
            ) : null}
            {node.remainingLabel && node.deadlineState === "ON_TRACK" ? (
              <p className="text-xs text-muted sm:text-end">متبقي {node.remainingLabel}</p>
            ) : null}
            {node.deadlineState === "DUE_SOON" && node.remainingLabel ? (
              <p className="text-xs text-warning sm:text-end">متبقي {node.remainingLabel}</p>
            ) : null}
            {node.overdueSinceLabel ? (
              <p className="text-xs text-danger sm:text-end">متأخرة منذ {node.overdueSinceLabel}</p>
            ) : null}
          </div>
        </div>
        {open ? (
          <div className="mt-3 border-t border-line pt-3">
            {node.visual === "completed" && node.completedAt ? (
              <p className="mb-2 text-xs text-muted">
                اكتملت {formatRiyadhDateTimeAr(node.completedAt)}
                {node.completedByLabel ? ` · ${node.completedByLabel}` : ""}
              </p>
            ) : null}
            {children}
          </div>
        ) : null}
      </div>
    </li>
  );
}
