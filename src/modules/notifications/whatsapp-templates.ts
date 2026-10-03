import { redactNotificationText, safeNotificationHref } from "./safety";
import { buildNotificationEmailHref, parseAppBaseUrl } from "./app-url";
import { whatsappAudienceFor } from "./whatsapp-policy";

export const WHATSAPP_TEMPLATE_IDS = ["master_touch_action_required", "master_touch_alert"] as const;
export type WhatsAppTemplateId = (typeof WHATSAPP_TEMPLATE_IDS)[number];

/** Internal catalog only. Not registered with Meta. */
export const WHATSAPP_TEMPLATE_CATALOG: Record<
  WhatsAppTemplateId,
  { language: "ar"; parameterKeys: readonly ["title", "context", "href"] }
> = {
  master_touch_action_required: { language: "ar", parameterKeys: ["title", "context", "href"] },
  master_touch_alert: { language: "ar", parameterKeys: ["title", "context", "href"] },
};

export const WHATSAPP_TEMPLATE_PARAMETER_KEYS = ["title", "context", "href"] as const;

const FORBIDDEN_TEMPLATE_KEYS = ["salary", "iban", "iqama", "net_pay", "account_number", "audit"];

export function whatsappTemplateIdForEvent(type: string): WhatsAppTemplateId | null {
  const audience = whatsappAudienceFor(type);
  if (audience === "none") return null;
  if (audience === "management") return "master_touch_alert";
  return "master_touch_action_required";
}

export function assertWhatsAppTemplatePrivacy(): void {
  for (const key of FORBIDDEN_TEMPLATE_KEYS) {
    if ((WHATSAPP_TEMPLATE_PARAMETER_KEYS as readonly string[]).includes(key)) {
      throw new Error("sensitive template parameter is not allowed");
    }
  }
}

export function buildWhatsAppParameters(input: {
  title: string;
  body: string;
  href: string | null | undefined;
  appBaseUrl: string | undefined | null;
}): { title: string; context: string; href: string } {
  const title = redactNotificationText(input.title).slice(0, 80);
  const context = redactNotificationText(input.body).slice(0, 120);
  const parsed = parseAppBaseUrl(input.appBaseUrl);
  const path = safeNotificationHref(input.href);
  const href = parsed && path ? buildNotificationEmailHref(parsed, path) : parsed ? `${parsed.origin}/` : "";
  return { title, context, href };
}
