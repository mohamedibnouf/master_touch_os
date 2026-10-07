export const COMMISSIONING_STEP_KEY = "testing_commissioning";

export const COMMISSIONING_ITEM_KEYS = [
  "electrical_lighting_test",
  "hvac_test",
  "it_networks_test",
  "architectural_finishes_inspection",
  "final_equipment_inspection",
  "final_observations_clearance",
] as const;

export type CommissioningItemKey = (typeof COMMISSIONING_ITEM_KEYS)[number];

export const COMMISSIONING_ITEM_STATUSES = ["pending", "passed", "failed"] as const;

export type CommissioningItemStatus = (typeof COMMISSIONING_ITEM_STATUSES)[number];

export const COMMISSIONING_ITEM_LABELS: Record<CommissioningItemKey, string> = {
  electrical_lighting_test: "اختبار الكهرباء والإنارة",
  hvac_test: "اختبار التكييف والتهوية",
  it_networks_test: "اختبار الشبكات والأنظمة التقنية",
  architectural_finishes_inspection: "فحص الأعمال المعمارية والتشطيبات",
  final_equipment_inspection: "فحص التجهيزات النهائية",
  final_observations_clearance: "معالجة الملاحظات النهائية",
};

export const COMMISSIONING_STATUS_LABELS: Record<CommissioningItemStatus, string> = {
  pending: "بانتظار الاختبار",
  passed: "ناجح",
  failed: "فشل الاختبار",
};

export const COMMISSIONING_NOTE_MAX = 500;

export type ProjectCommissioningItem = {
  item_key: CommissioningItemKey;
  is_required: boolean;
  status: CommissioningItemStatus;
  note: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
  updated_at: string | null;
};

export type ProjectCommissioningProgress = {
  ready: boolean;
  package_id: string | null;
  workflow_instance_step_id: string | null;
  required_count: number;
  passed_count: number;
  items: ProjectCommissioningItem[];
};

export function isCommissioningItemKey(value: string): value is CommissioningItemKey {
  return (COMMISSIONING_ITEM_KEYS as readonly string[]).includes(value);
}

export function isCommissioningItemStatus(value: string): value is CommissioningItemStatus {
  return (COMMISSIONING_ITEM_STATUSES as readonly string[]).includes(value);
}

export function evaluateCommissioningReady(input: {
  required_count: number;
  passed_count: number;
}): boolean {
  return input.required_count === 6 && input.passed_count === 6;
}

export function parseCommissioningProgress(raw: unknown): ProjectCommissioningProgress | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const num = (key: string): number => {
    const value = row[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };
  const itemsRaw = Array.isArray(row.items) ? row.items : [];
  const items: ProjectCommissioningItem[] = itemsRaw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const key = typeof item.item_key === "string" ? item.item_key : "";
    const status = typeof item.status === "string" ? item.status : "";
    if (!isCommissioningItemKey(key) || !isCommissioningItemStatus(status)) return [];
    return [
      {
        item_key: key,
        is_required: item.is_required === true,
        status,
        note: typeof item.note === "string" ? item.note : null,
        updated_by: typeof item.updated_by === "string" ? item.updated_by : null,
        updated_by_name: typeof item.updated_by_name === "string" ? item.updated_by_name : null,
        updated_at: typeof item.updated_at === "string" ? item.updated_at : null,
      },
    ];
  });
  const required_count = num("required_count") || items.filter((item) => item.is_required).length;
  const passed_count =
    num("passed_count") || items.filter((item) => item.is_required && item.status === "passed").length;
  const ready = typeof row.ready === "boolean" ? row.ready : evaluateCommissioningReady({ required_count, passed_count });
  return {
    ready,
    package_id: typeof row.package_id === "string" ? row.package_id : null,
    workflow_instance_step_id:
      typeof row.workflow_instance_step_id === "string" ? row.workflow_instance_step_id : null,
    required_count,
    passed_count,
    items,
  };
}
