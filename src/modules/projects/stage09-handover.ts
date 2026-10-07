export const HANDOVER_STEP_KEY = "handover";

export const HANDOVER_ITEM_KEYS = [
  "works_delivered",
  "final_documents_delivered",
  "warranties_attachments_delivered",
  "client_observations_recorded",
  "receipt_confirmed",
] as const;

export type HandoverItemKey = (typeof HANDOVER_ITEM_KEYS)[number];

export const HANDOVER_ITEM_LABELS: Record<HandoverItemKey, string> = {
  works_delivered: "تسليم الأعمال للعميل",
  final_documents_delivered: "تسليم المستندات النهائية",
  warranties_attachments_delivered: "تسليم الضمانات/المرفقات إن وجدت",
  client_observations_recorded: "تسجيل ملاحظات العميل",
  receipt_confirmed: "تأكيد الاستلام",
};

export const HANDOVER_NOTE_MAX = 500;

export type ProjectHandoverItem = {
  item_key: HandoverItemKey;
  is_required: boolean;
  is_confirmed: boolean;
  confirmed_by: string | null;
  confirmed_by_name: string | null;
  confirmed_at: string | null;
  note: string | null;
};

export type ProjectHandoverReadiness = {
  ready: boolean;
  package_id: string | null;
  workflow_instance_step_id: string | null;
  required_count: number;
  confirmed_required_count: number;
  items: ProjectHandoverItem[];
};

export function isHandoverItemKey(value: string): value is HandoverItemKey {
  return (HANDOVER_ITEM_KEYS as readonly string[]).includes(value);
}

export function evaluateHandoverReady(input: {
  required_count: number;
  confirmed_required_count: number;
}): boolean {
  return input.required_count === 5 && input.confirmed_required_count === 5;
}

export function parseHandoverReadiness(raw: unknown): ProjectHandoverReadiness | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const num = (key: string): number => {
    const value = row[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };
  const itemsRaw = Array.isArray(row.items) ? row.items : [];
  const items: ProjectHandoverItem[] = itemsRaw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const key = typeof item.item_key === "string" ? item.item_key : "";
    if (!isHandoverItemKey(key)) return [];
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
  const ready =
    typeof row.ready === "boolean" ? row.ready : evaluateHandoverReady({ required_count, confirmed_required_count });
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
