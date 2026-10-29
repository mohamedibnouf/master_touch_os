import type { ReactNode } from "react";
import { Card } from "@/components/ui/primitives";
import type { ProjectAttention } from "@/modules/projects/workflow-view";
import { cn } from "@/lib/utils";
import { getI18n } from "@/lib/i18n/server";

export async function ProjectAttentionCard({
  attention,
  actions,
}: {
  attention: ProjectAttention;
  actions?: ReactNode;
}) {
  if (attention.kind === "none") return null;
  const { t } = await getI18n();

  const tone =
    attention.kind === "approve" || attention.kind === "complete" || attention.kind === "submit_approval"
      ? "action"
      : attention.kind === "rejected"
        ? "danger"
        : attention.kind === "wait" || attention.kind === "changes_requested"
          ? "wait"
          : "neutral";

  return (
    <Card
      data-testid="project-attention-card"
      className={cn(
        tone === "action" && "border-info-border bg-info-soft",
        tone === "wait" && "border-warning-border bg-warning-soft",
        tone === "danger" && "border-danger-border bg-danger-soft",
      )}
    >
      <p className="text-xs font-medium tracking-wide text-muted">{t.projectWorkflow.attention.eyebrow}</p>
      <h2 className="mt-1 text-base font-semibold text-ink">{attention.title}</h2>
      <p className="mt-1 text-sm leading-7 text-muted">{attention.detail}</p>
      {actions ? <div className="mt-4 space-y-3">{actions}</div> : null}
    </Card>
  );
}
