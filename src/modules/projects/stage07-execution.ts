export const EXECUTION_STEP_KEY = "execution";

export const EXECUTION_ITEM_KEYS = [
  "architectural_partitions",
  "electrical_lighting",
  "hvac",
  "it_networks",
  "finishes",
  "ff_and_e",
] as const;

export type ExecutionItemKey = (typeof EXECUTION_ITEM_KEYS)[number];

export const EXECUTION_ITEM_STATUSES = ["not_started", "in_progress", "blocked", "completed"] as const;

export type ExecutionItemStatus = (typeof EXECUTION_ITEM_STATUSES)[number];

export const EXECUTION_ITEM_LABELS: Record<ExecutionItemKey, string> = {
  architectural_partitions: "الأعمال المعمارية والتقسيمات",
  electrical_lighting: "أعمال الكهرباء والإنارة",
  hvac: "أعمال التكييف والتهوية",
  it_networks: "أعمال الشبكات والأنظمة التقنية",
  finishes: "أعمال الأرضيات والأسقف والدهانات",
  ff_and_e: "تركيب التجهيزات والأثاث النهائي",
};

export const EXECUTION_STATUS_LABELS: Record<ExecutionItemStatus, string> = {
  not_started: "لم يبدأ",
  in_progress: "قيد التنفيذ",
  blocked: "متعثر",
  completed: "مكتمل",
};

export const EXECUTION_NOTE_MAX = 500;

export type ProjectExecutionItem = {
  item_key: ExecutionItemKey;
  is_required: boolean;
  status: ExecutionItemStatus;
  progress_percent: number;
  note: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
  updated_at: string | null;
};

export type ProjectExecutionProgress = {
  ready: boolean;
  package_id: string | null;
  workflow_instance_step_id: string | null;
  required_count: number;
  completed_count: number;
  overall_progress: number;
  items: ProjectExecutionItem[];
};

export function isExecutionItemKey(value: string): value is ExecutionItemKey {
  return (EXECUTION_ITEM_KEYS as readonly string[]).includes(value);
}

export function isExecutionItemStatus(value: string): value is ExecutionItemStatus {
  return (EXECUTION_ITEM_STATUSES as readonly string[]).includes(value);
}

export function isValidExecutionProgressCombo(status: ExecutionItemStatus, progress: number): boolean {
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) return false;
  if (status === "not_started") return progress === 0;
  if (status === "in_progress") return progress >= 1 && progress <= 99;
  if (status === "blocked") return progress >= 0 && progress <= 99;
  return progress === 100;
}

export function evaluateExecutionReady(input: {
  required_count: number;
  completed_count: number;
}): boolean {
  return input.required_count === 6 && input.completed_count === 6;
}

export function deriveOverallProgress(items: Array<{ is_required: boolean; progress_percent: number }>): number {
  const required = items.filter((item) => item.is_required);
  if (required.length === 0) return 0;
  const sum = required.reduce((acc, item) => acc + item.progress_percent, 0);
  return Math.round(sum / required.length);
}

export function parseExecutionProgress(raw: unknown): ProjectExecutionProgress | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const num = (key: string): number => {
    const value = row[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };
  const itemsRaw = Array.isArray(row.items) ? row.items : [];
  const items: ProjectExecutionItem[] = itemsRaw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const key = typeof item.item_key === "string" ? item.item_key : "";
    const status = typeof item.status === "string" ? item.status : "";
    if (!isExecutionItemKey(key) || !isExecutionItemStatus(status)) return [];
    const progress =
      typeof item.progress_percent === "number" && Number.isFinite(item.progress_percent)
        ? Math.trunc(item.progress_percent)
        : 0;
    return [
      {
        item_key: key,
        is_required: item.is_required === true,
        status,
        progress_percent: progress,
        note: typeof item.note === "string" ? item.note : null,
        updated_by: typeof item.updated_by === "string" ? item.updated_by : null,
        updated_by_name: typeof item.updated_by_name === "string" ? item.updated_by_name : null,
        updated_at: typeof item.updated_at === "string" ? item.updated_at : null,
      },
    ];
  });
  const required_count = num("required_count") || items.filter((item) => item.is_required).length;
  const completed_count =
    num("completed_count") ||
    items.filter((item) => item.is_required && item.status === "completed" && item.progress_percent === 100).length;
  const overall_progress =
    typeof row.overall_progress === "number" && Number.isFinite(row.overall_progress)
      ? Math.trunc(row.overall_progress)
      : deriveOverallProgress(items);
  const ready = typeof row.ready === "boolean" ? row.ready : evaluateExecutionReady({ required_count, completed_count });
  return {
    ready,
    package_id: typeof row.package_id === "string" ? row.package_id : null,
    workflow_instance_step_id:
      typeof row.workflow_instance_step_id === "string" ? row.workflow_instance_step_id : null,
    required_count,
    completed_count,
    overall_progress,
    items,
  };
}
