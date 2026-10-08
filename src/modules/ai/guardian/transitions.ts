import type { GuardianFindingStatus } from "./types";

export const ALLOWED_REVIEW_TRANSITIONS: Record<GuardianFindingStatus, GuardianFindingStatus[]> = {
  open: ["acknowledged", "in_review", "resolved", "dismissed"],
  acknowledged: ["open", "in_review", "resolved", "dismissed"],
  in_review: ["acknowledged", "resolved", "dismissed"],
  resolved: [],
  dismissed: [],
};

export function isAllowedGuardianTransition(from: GuardianFindingStatus, to: GuardianFindingStatus): boolean {
  return ALLOWED_REVIEW_TRANSITIONS[from]?.includes(to) ?? false;
}

export function reviewNoteRequired(status: GuardianFindingStatus): boolean {
  return status === "dismissed" || status === "resolved";
}
