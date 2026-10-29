import { Card, EmptyState } from "@/components/ui/primitives";
import { auditActionLabel, auditEntityLabel } from "@/lib/ui/audit-action-labels";
import { intlLocale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

export type ProjectActivityItem = {
  id: string;
  action: string;
  entityType: string;
  createdAt: string;
  actorLabel: string | null;
  automaticDetail: string | null;
};

export async function ProjectActivityTimeline({ items }: { items: ProjectActivityItem[] }) {
  const { t, locale } = await getI18n();
  const copy = t.projectWorkflow.activity;
  return (
    <Card data-testid="project-activity-timeline">
      <h2 className="mb-3 font-semibold text-ink">{copy.title}</h2>
      {items.length === 0 ? (
        <EmptyState title={copy.empty} />
      ) : (
        <ol className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className="border-s-2 border-line ps-3 text-sm">
              <p className="text-xs tabular-nums text-muted">
                {new Date(item.createdAt).toLocaleString(intlLocale(locale), { timeZone: "Asia/Riyadh" })}
              </p>
              <p className="text-ink">{auditActionLabel(item.action)}</p>
              {item.automaticDetail ? <p className="text-xs text-primary">{item.automaticDetail}</p> : null}
              <p className="text-xs text-muted">
                {auditEntityLabel(item.entityType)}
                {item.actorLabel ? ` · ${item.actorLabel}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
