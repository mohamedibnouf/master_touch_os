import Link from "next/link";
import { AlertTriangle, Check, Circle, Clock, Lock } from "lucide-react";
import type { WorkflowViewNode } from "@/server/use-cases/project-workflow";
import { cn } from "@/lib/utils";

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

export function WorkflowStageNode({
  node,
  href,
  selected,
  connector,
}: {
  node: WorkflowViewNode;
  href: string;
  selected: boolean;
  connector: boolean;
}) {
  const Icon = ICON[node.visual];
  return (
    <li className="flex min-w-0 flex-1 flex-col md:min-w-[9.5rem] md:max-w-[14rem]">
      <div className="flex gap-3 md:flex-col md:gap-2">
        <div className="flex flex-col items-center md:flex-row md:items-center">
          <Link
            href={href}
            aria-current={selected ? "step" : undefined}
            aria-label={`${node.nameAr} — ${node.visualLabel}`}
            className={cn(
              "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
              node.visual === "completed" && "border-success bg-success text-white",
              node.visual === "current" &&
                "border-navy bg-navy text-white motion-safe:shadow-[0_0_0_4px_rgba(15,40,80,0.12)]",
              node.visual === "waiting_approval" && "border-warning bg-warning/15 text-warning",
              (node.visual === "blocked" || node.visual === "rejected" || node.visual === "overdue") &&
                "border-danger bg-danger/10 text-danger",
              node.visual === "changes_requested" && "border-warning bg-warning/10 text-warning",
              node.visual === "upcoming" && "border-line bg-paper text-muted",
              selected && "ring-2 ring-navy/30",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
          </Link>
          {connector ? (
            <span
              aria-hidden
              className="mt-1 h-full w-px flex-1 bg-line md:mt-0 md:h-px md:w-full md:min-w-[1.5rem]"
            />
          ) : null}
        </div>
        <Link href={href} className="min-w-0 py-1 md:py-0">
          <p className="truncate text-sm font-medium text-ink">{node.nameAr}</p>
          <p className="text-xs text-muted">{node.visualLabel}</p>
          {node.overdueLabel ? <p className="text-xs text-danger">{node.overdueLabel}</p> : null}
        </Link>
      </div>
    </li>
  );
}
