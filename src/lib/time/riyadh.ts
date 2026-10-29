/**
 * Asia/Riyadh calendar and wall-clock helpers.
 *
 * Saudi Arabia is fixed at UTC+03:00 with no daylight saving time, which is
 * what the SQL side uses (`timezone('Asia/Riyadh', now())::date`). Server code
 * typically runs in UTC, so `new Date().toISOString().slice(0, 10)` returns the
 * wrong calendar day between 21:00 and 24:00 UTC. Use these helpers instead.
 */

export const RIYADH_TIME_ZONE = "Asia/Riyadh";
export const RIYADH_UTC_OFFSET = "+03:00";
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Riyadh wall-clock parts for an instant (fixed +03:00 shift, read in UTC). */
function riyadhShifted(instant: Date): Date {
  return new Date(instant.getTime() + RIYADH_OFFSET_MS);
}

/** Today's calendar date in Asia/Riyadh as YYYY-MM-DD. */
export function todayInRiyadh(now: Date = new Date()): string {
  if (Number.isNaN(now.getTime())) throw new Error("INVALID_INSTANT");
  return riyadhShifted(now).toISOString().slice(0, 10);
}

/** Calendar date of an instant in Asia/Riyadh as YYYY-MM-DD. */
export function riyadhDateOf(value: Date | string): string {
  const instant = typeof value === "string" ? new Date(value) : value;
  return todayInRiyadh(instant);
}

/** Adds whole days to a YYYY-MM-DD date (pure calendar arithmetic). */
export function addDaysYmd(ymd: string, days: number): string {
  if (!YMD_RE.test(ymd)) throw new Error("INVALID_DATE");
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Converts an `<input type="datetime-local">` value (no zone) that the user
 * typed in Riyadh time into a UTC ISO timestamp.
 * "2026-10-29T08:00" → "2026-10-29T05:00:00.000Z".
 * Returns null for empty input; throws INVALID_DATETIME for malformed input.
 */
export function riyadhLocalInputToIso(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const match = LOCAL_INPUT_RE.exec(value);
  if (!match) throw new Error("INVALID_DATETIME");
  const [, y, mo, d, h, mi, s] = match;
  const parsed = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s ?? "00"}${RIYADH_UTC_OFFSET}`);
  if (Number.isNaN(parsed.getTime())) throw new Error("INVALID_DATETIME");
  // Reject rolled-over values such as 2026-02-31T10:00.
  const back = riyadhShifted(parsed);
  if (
    back.getUTCFullYear() !== Number(y) ||
    back.getUTCMonth() + 1 !== Number(mo) ||
    back.getUTCDate() !== Number(d)
  ) {
    throw new Error("INVALID_DATETIME");
  }
  return parsed.toISOString();
}

/**
 * Formats a stored timestamp as a `datetime-local` value in Riyadh time
 * ("YYYY-MM-DDTHH:mm"), for pre-filling forms. Returns "" for empty/invalid.
 */
export function isoToRiyadhLocalInput(value: string | Date | null | undefined): string {
  if (!value) return "";
  const instant = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(instant.getTime())) return "";
  const r = riyadhShifted(instant);
  return `${r.getUTCFullYear()}-${pad(r.getUTCMonth() + 1)}-${pad(r.getUTCDate())}T${pad(r.getUTCHours())}:${pad(r.getUTCMinutes())}`;
}
