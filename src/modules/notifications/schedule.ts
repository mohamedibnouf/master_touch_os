export const MAX_DELIVERY_ATTEMPTS = 5;

export function nextRetryAt(attemptCount: number, now = new Date()): Date | null {
  if (attemptCount >= MAX_DELIVERY_ATTEMPTS) return null;
  const minutes = 2 ** Math.max(0, attemptCount - 1);
  return new Date(now.getTime() + minutes * 60_000);
}

export function isPermanentProviderError(code: string | null | undefined): boolean {
  if (!code) return false;
  return ["auth", "forbidden", "invalid_recipient", "unsupported", "template_rejected"].includes(code);
}

export function reminderWindowReached(dueAtIso: string, now = new Date(), hoursBefore = 24): boolean {
  const due = Date.parse(dueAtIso);
  if (Number.isNaN(due)) return false;
  const start = due - hoursBefore * 60 * 60 * 1000;
  return now.getTime() >= start && now.getTime() < due;
}

export function overdueReached(dueAtIso: string, now = new Date()): boolean {
  const due = Date.parse(dueAtIso);
  if (Number.isNaN(due)) return false;
  return now.getTime() >= due;
}

export function approachingDate(ymd: string, todayYmd: string, daysAhead: number): boolean {
  if (!ymd || ymd.length < 10) return false;
  const due = Date.parse(`${ymd}T00:00:00.000Z`);
  const today = Date.parse(`${todayYmd}T00:00:00.000Z`);
  if (Number.isNaN(due) || Number.isNaN(today)) return false;
  const diff = (due - today) / 86_400_000;
  return diff >= 0 && diff <= daysAhead;
}

export function dateOverdue(ymd: string, todayYmd: string): boolean {
  return Boolean(ymd) && ymd < todayYmd;
}

export function shouldEscalateOverdue(dueAtIso: string, now = new Date(), graceHours = 0): boolean {
  const due = Date.parse(dueAtIso);
  if (Number.isNaN(due)) return false;
  return now.getTime() >= due + graceHours * 60 * 60 * 1000;
}
