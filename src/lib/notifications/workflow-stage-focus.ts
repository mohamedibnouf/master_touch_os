import { isPostgresUuid } from "@/lib/postgres-uuid";

/** Prefer ?stage= when it matches a real instance step; else the current READY node. */
export function workflowStageFocusId(
  nodeIds: string[],
  currentNodeId: string | null,
  stageParam: string | null | undefined,
): string | null {
  if (stageParam && isPostgresUuid(stageParam) && nodeIds.includes(stageParam)) {
    return stageParam;
  }
  return currentNodeId;
}
