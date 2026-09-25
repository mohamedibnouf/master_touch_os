import type { ActiveMember, HubChannel, NotificationCategory, PreferenceRow } from "./catalog";
import { MANDATORY_IN_APP_CATEGORIES, SENSITIVE_CATEGORIES } from "./catalog";

export function resolveActiveRecipients(input: {
  organizationId: string;
  proposedIds: string[];
  members: ActiveMember[];
}): string[] {
  const allowed = new Set(
    input.members
      .filter(
        (m) =>
          m.organizationId === input.organizationId &&
          m.status === "active" &&
          m.isActive,
      )
      .map((m) => m.profileId),
  );
  const out: string[] = [];
  for (const id of input.proposedIds) {
    if (!allowed.has(id)) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

export function selectChannels(input: {
  category: NotificationCategory;
  preferences: PreferenceRow[];
  recipientId: string;
  pushAvailable: boolean;
  emailAvailable: boolean;
  whatsappAvailable: boolean;
}): HubChannel[] {
  const prefs = input.preferences.filter((p) => p.profileId === input.recipientId && p.category === input.category);
  const pref = (channel: HubChannel, fallback: boolean) => {
    const row = prefs.find((p) => p.channel === channel);
    return row ? row.enabled : fallback;
  };

  const channels: HubChannel[] = [];
  if (MANDATORY_IN_APP_CATEGORIES.has(input.category)) {
    channels.push("in_app");
  } else if (pref("in_app", true)) {
    channels.push("in_app");
  }
  if (input.emailAvailable && pref("email", input.category === "APPROVALS" || input.category === "WORK")) {
    channels.push("email");
  }
  if (input.whatsappAvailable && pref("whatsapp", false)) {
    channels.push("whatsapp");
  }
  if (input.pushAvailable && pref("push", false)) {
    channels.push("push");
  }
  if (SENSITIVE_CATEGORIES.has(input.category)) {
    return channels.filter((c) => c === "in_app" || c === "email");
  }
  return channels;
}

export function canDisablePreference(category: NotificationCategory, channel: HubChannel, enabled: boolean): boolean {
  if (channel === "in_app" && !enabled && MANDATORY_IN_APP_CATEGORIES.has(category)) return false;
  return true;
}
