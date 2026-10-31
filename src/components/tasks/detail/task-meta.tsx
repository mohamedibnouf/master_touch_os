import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, Bot, CalendarCheck, CalendarPlus, Link2, UserRound } from "lucide-react";
import type { Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/dictionaries/ar";
import type { TaskDetail } from "@/modules/tasks/types";
import { formatRiyadhDateTime, personName } from "./detail-format";
import { PersonAvatar } from "./person-avatar";

/** Read-only facts: linked record, source, creator and timestamps (server component). */
export function TaskMeta({ detail, t, locale }: { detail: TaskDetail; t: Dictionary; locale: Locale }) {
  const { task, createdBy, entityHref } = detail;
  const ts = t.tasksDetail.side;
  const entityLabel = task.entity_type ? t.tasks.entityType[task.entity_type] : null;
  const creatorName = createdBy ? personName(createdBy, locale, t.tasksDetail.unknownPerson) : t.tasksDetail.system;

  return (
    <dl className="space-y-3 text-sm" data-testid="task-meta">
      <Row icon={<Link2 aria-hidden className="h-3.5 w-3.5" />} label={ts.linkedRecord}>
        {entityLabel ? (
          entityHref ? (
            <Link
              href={entityHref}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-info-border bg-info-soft px-2.5 py-0.5 text-xs font-medium text-primary transition-colors hover:border-primary"
              data-testid="task-linked-record"
            >
              <span className="truncate">{entityLabel}</span>
              <ArrowUpRight aria-hidden className="h-3 w-3 shrink-0 rtl:-scale-x-100" />
            </Link>
          ) : (
            <span className="inline-flex rounded-full bg-surface-strong px-2.5 py-0.5 text-xs font-medium text-ink">
              {entityLabel}
            </span>
          )
        ) : (
          <span className="text-muted">{ts.noLinkedRecord}</span>
        )}
      </Row>
      <Row icon={<Bot aria-hidden className="h-3.5 w-3.5" />} label={ts.source}>
        {t.tasks.source[task.source]}
      </Row>
      <Row icon={<UserRound aria-hidden className="h-3.5 w-3.5" />} label={ts.createdBy}>
        <span className="inline-flex items-center gap-1.5">
          {createdBy ? <PersonAvatar name={creatorName} seed={createdBy.profile_id} size="sm" /> : null}
          <span dir="auto">{creatorName}</span>
        </span>
      </Row>
      <Row icon={<CalendarPlus aria-hidden className="h-3.5 w-3.5" />} label={ts.createdAt}>
        <time dateTime={task.created_at}>{formatRiyadhDateTime(task.created_at, locale)}</time>
      </Row>
      {task.completed_at ? (
        <Row icon={<CalendarCheck aria-hidden className="h-3.5 w-3.5" />} label={ts.completedAt}>
          <time dateTime={task.completed_at} className="text-success">
            {formatRiyadhDateTime(task.completed_at, locale)}
          </time>
        </Row>
      ) : null}
    </dl>
  );
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="flex shrink-0 items-center gap-1.5 pt-0.5 text-xs font-medium text-muted">
        {icon}
        {label}
      </dt>
      <dd className="min-w-0 text-end text-sm text-ink">{children}</dd>
    </div>
  );
}
