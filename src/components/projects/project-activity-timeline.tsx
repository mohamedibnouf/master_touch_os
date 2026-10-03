import { Card, EmptyState } from "@/components/ui/primitives";
import { auditActionLabel, auditEntityLabel } from "@/lib/ui/audit-action-labels";

export type ProjectActivityItem = {
  id: string;
  action: string;
  entityType: string;
  createdAt: string;
  actorLabel: string | null;
  automaticDetail: string | null;
};

export function ProjectActivityTimeline({ items }: { items: ProjectActivityItem[] }) {
  return (
    <Card data-testid="project-activity-timeline">
      <h2 className="mb-3 font-semibold text-navy">سجل النشاط</h2>
      {items.length === 0 ? (
        <EmptyState title="لا يوجد نشاط مسجّل يمكن عرضه لهذه الصفحة." />
      ) : (
        <ol className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className="border-s-2 border-line ps-3 text-sm">
              <p className="text-xs text-muted">
                {new Date(item.createdAt).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })}
              </p>
              <p className="text-ink">{auditActionLabel(item.action)}</p>
              {item.automaticDetail ? <p className="text-xs text-navy">{item.automaticDetail}</p> : null}
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
