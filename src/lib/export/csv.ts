/**
 * Escape a CSV cell (RFC 4180-ish). Values are always quoted when needed.
 */
export function csvEscape(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Build a UTF-8 CSV string with BOM for Excel Arabic compatibility. */
export function toCsv(headers: string[], rows: Array<Array<string | number | boolean | null | undefined>>): string {
  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => row.map(csvEscape).join(",")),
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}
