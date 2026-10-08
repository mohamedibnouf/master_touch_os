import type { JobClaimDecision } from "./types";
import { GUARDIAN_STALE_LOCK_MS } from "./constants";

export function guardianWindowKey(at: Date): string {
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, "0");
  const d = String(at.getUTCDate()).padStart(2, "0");
  const h = String(at.getUTCHours()).padStart(2, "0");
  return `guardian:${y}-${m}-${d}T${h}Z`;
}

export function previousGuardianWindowKey(at: Date): string {
  return guardianWindowKey(new Date(at.getTime() - 60 * 60 * 1000));
}

export function decideJobClaim(input: {
  existing: { status: string; startedAt: string; heartbeatAt?: string | null } | null;
  nowMs: number;
  staleMs?: number;
}): JobClaimDecision {
  if (!input.existing) return "run";
  if (input.existing.status === "completed") return "skip_completed";
  const staleMs = input.staleMs ?? GUARDIAN_STALE_LOCK_MS;
  const beat = Date.parse(input.existing.heartbeatAt || input.existing.startedAt);
  if (input.existing.status === "running" && Number.isFinite(beat) && input.nowMs - beat < staleMs) {
    return "skip_running";
  }
  if (input.existing.status === "running" || input.existing.status === "failed") return "takeover";
  return "run";
}

export function isStaleGuardianLease(message: string | undefined): boolean {
  return /stale_guardian_lease/i.test(message ?? "");
}

export function nextLeaseGeneration(previous: number | null | undefined): number {
  return (previous ?? 0) + 1;
}
