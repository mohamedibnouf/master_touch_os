/** Mirrors 071 CHECK + trigger normalization. Not a live DB runner. */
export function normalizeManagementNotificationEmail(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length === 0 ? null : trimmed;
}

export function managementNotificationEmailCheckPasses(value: string | null): boolean {
  if (value === null) return true;
  return (
    value.length >= 5 &&
    value.length <= 254 &&
    !value.includes(" ") &&
    /^.+@.+\..+$/.test(value)
  );
}

export function authorizeManagementEmailChange(input: {
  trustedSession: boolean;
  authUid: string | null;
  hasSettingsManageOnTargetOrg: boolean;
  previous: string | null;
  next: string | null;
}): "allow" | "deny" {
  const previous = normalizeManagementNotificationEmail(input.previous);
  const next = normalizeManagementNotificationEmail(input.next);
  if (previous === next) return "allow";
  if (input.trustedSession) return "allow";
  if (!input.authUid || !input.hasSettingsManageOnTargetOrg) return "deny";
  return "allow";
}
