export const MOBILIZATION_STEP_KEY = "mobilization";

export const MOBILIZATION_ITEM_KEYS = [
  "site_ready",
  "site_access_ready",
  "execution_team_ready",
  "tools_equipment_ready",
  "safety_ppe_ready",
  "procurement_coordination_ready",
] as const;

export type MobilizationItemKey = (typeof MOBILIZATION_ITEM_KEYS)[number];

export const MOBILIZATION_ITEM_LABELS: Record<MobilizationItemKey, string> = {
  site_ready: "جاهزية الموقع / منطقة العمل",
  site_access_ready: "تأكيد الدخول/التصريح للموقع",
  execution_team_ready: "جاهزية فريق التنفيذ",
  tools_equipment_ready: "جاهزية العدد والأدوات",
  safety_ppe_ready: "تأكيد السلامة ومعدات الوقاية",
  procurement_coordination_ready: "تنسيق توريد المواد/المعدات المطلوبة",
};

export const MOBILIZATION_NOTE_MAX = 500;

export type MobilizationReadinessItem = {
  item_key: MobilizationItemKey;
  is_required: boolean;
  is_confirmed: boolean;
  confirmed_by: string | null;
  confirmed_by_name: string | null;
  confirmed_at: string | null;
  note: string | null;
};

export type ProjectMobilizationReadiness = {
  ready: boolean;
  package_id: string | null;
  workflow_instance_step_id: string | null;
  required_count: number;
  confirmed_required_count: number;
  items: MobilizationReadinessItem[];
};

export function isMobilizationItemKey(value: string): value is MobilizationItemKey {
  return (MOBILIZATION_ITEM_KEYS as readonly string[]).includes(value);
}

export function evaluateMobilizationReady(input: {
  required_count: number;
  confirmed_required_count: number;
}): boolean {
  return input.required_count === 6 && input.confirmed_required_count === 6;
}

export function parseMobilizationReadiness(raw: unknown): ProjectMobilizationReadiness | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const num = (key: string): number => {
    const value = row[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };
  const itemsRaw = Array.isArray(row.items) ? row.items : [];
  const items: MobilizationReadinessItem[] = itemsRaw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const key = typeof item.item_key === "string" ? item.item_key : "";
    if (!isMobilizationItemKey(key)) return [];
    return [
      {
        item_key: key,
        is_required: item.is_required === true,
        is_confirmed: item.is_confirmed === true,
        confirmed_by: typeof item.confirmed_by === "string" ? item.confirmed_by : null,
        confirmed_by_name: typeof item.confirmed_by_name === "string" ? item.confirmed_by_name : null,
        confirmed_at: typeof item.confirmed_at === "string" ? item.confirmed_at : null,
        note: typeof item.note === "string" ? item.note : null,
      },
    ];
  });
  const required_count = num("required_count") || items.filter((item) => item.is_required).length;
  const confirmed_required_count =
    num("confirmed_required_count") || items.filter((item) => item.is_required && item.is_confirmed).length;
  const ready = typeof row.ready === "boolean" ? row.ready : evaluateMobilizationReady({ required_count, confirmed_required_count });
  return {
    ready,
    package_id: typeof row.package_id === "string" ? row.package_id : null,
    workflow_instance_step_id:
      typeof row.workflow_instance_step_id === "string" ? row.workflow_instance_step_id : null,
    required_count,
    confirmed_required_count,
    items,
  };
}
