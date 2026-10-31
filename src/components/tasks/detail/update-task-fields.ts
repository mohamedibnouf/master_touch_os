import { updateTaskAction } from "@/server/use-cases/tasks";
import type { TaskActionState } from "@/modules/tasks/types";

/**
 * Calls updateTaskAction with only the given fields (absent = unchanged, "" = clear), so a
 * client control can patch one field without resubmitting the others — important for auto
 * tasks, whose locked fields must never be sent.
 */
export function updateTaskFields(taskId: string, values: Record<string, string>): Promise<TaskActionState> {
  const fd = new FormData();
  fd.set("taskId", taskId);
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return updateTaskAction(null, fd);
}
