import type { DurableFinding } from "./types";
import { mayEmailFindingClass } from "./classification";
import {
  GUARDIAN_HIGH_EMAIL_DELAY_MS,
  GUARDIAN_NOTIFY_COOLDOWN_MS,
} from "./constants";
import {
  emailPayloadForFinding,
  maySendCriticalEmail,
  maySendHighEmail,
  withinCooldown,
} from "./redact";

export type GuardianNotifyPlan = {
  findingId: string;
  type: "RISK_CRITICAL" | "RISK_HIGH";
  email: boolean;
  inApp: boolean;
};

export function planGuardianNotifications(input: {
  findings: DurableFinding[];
  nowMs: number;
  alertsEnabled?: boolean;
}): GuardianNotifyPlan[] {
  if (!input.alertsEnabled) return [];
  const plans: GuardianNotifyPlan[] = [];
  for (const finding of input.findings) {
    if (finding.detector !== "rule") continue;
    if (finding.status === "dismissed" || finding.status === "resolved") continue;
    const allowEmail = mayEmailFindingClass(finding.category);

    const inAppCool = withinCooldown(finding.lastInAppNotifiedAt, input.nowMs, GUARDIAN_NOTIFY_COOLDOWN_MS);
    const emailCool = withinCooldown(finding.lastEmailNotifiedAt, input.nowMs, GUARDIAN_NOTIFY_COOLDOWN_MS);

    if (maySendCriticalEmail(finding)) {
      plans.push({
        findingId: finding.id || finding.dedupKey,
        type: "RISK_CRITICAL",
        inApp: !inAppCool,
        email: allowEmail && !emailCool,
      });
      continue;
    }

    if (maySendHighEmail(finding, input.nowMs, GUARDIAN_HIGH_EMAIL_DELAY_MS)) {
      plans.push({
        findingId: finding.id || finding.dedupKey,
        type: "RISK_HIGH",
        inApp: !inAppCool,
        email: allowEmail && !emailCool,
      });
      continue;
    }

    if (finding.severity === "HIGH" && !inAppCool) {
      plans.push({
        findingId: finding.id || finding.dedupKey,
        type: "RISK_HIGH",
        inApp: true,
        email: false,
      });
    }
  }
  return plans.filter((p) => p.inApp || p.email);
}

export { emailPayloadForFinding };
