import { WorkflowStageNode } from "@/components/projects/workflow-stage-node";
import type { WorkflowViewNode } from "@/server/use-cases/project-workflow";

export function ProjectWorkflowTimeline({
  projectId,
  nodes,
  selectedId,
}: {
  projectId: string;
  nodes: WorkflowViewNode[];
  selectedId: string | null;
}) {
  if (nodes.length === 0) return null;
  return (
    <ol
      data-testid="project-workflow-timeline"
      className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-start md:gap-0"
    >
      {nodes.map((node, index) => (
        <WorkflowStageNode
          key={node.id}
          node={node}
          selected={node.id === selectedId}
          connector={index < nodes.length - 1}
          href={`/projects/${projectId}?tab=stages&stage=${node.id}`}
        />
      ))}
    </ol>
  );
}
