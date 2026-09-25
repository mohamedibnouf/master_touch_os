/** Whole calendar days between two YYYY-MM-DD strings (b - a). */
export function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const [ty, tm, td] = toYmd.split("-").map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.floor((b - a) / 86_400_000);
}

export function isoToYmd(iso: string, timeZone = "Asia/Riyadh"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function findingId(ruleId: string, sourceType: string, sourceId: string): string {
  return `${ruleId}:${sourceType}:${sourceId}`;
}
