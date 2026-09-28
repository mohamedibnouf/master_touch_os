/** PostgreSQL uuid text (any 128-bit hex), not RFC-4122 version/variant. */
export const POSTGRES_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPostgresUuid(value: string): boolean {
  return POSTGRES_UUID_RE.test(value);
}
