export type DirectoryEmployeeStatRow = {
  is_active: boolean;
  employment_status: string | null;
};

export function deriveEmployeeDirectoryStats(rows: DirectoryEmployeeStatRow[]) {
  return {
    total: rows.length,
    active: rows.filter((row) => row.is_active).length,
    probation: rows.filter((row) => row.employment_status === "probation").length,
  };
}

/** Localized profile name for the directory; `fallback` is shown when no name is stored. */
export function directoryProfileName(profiles: unknown, fallback = "بدون اسم", locale: "ar" | "en" = "ar"): string {
  const row = Array.isArray(profiles) ? profiles[0] : profiles;
  if (!row || typeof row !== "object") {
    return fallback;
  }
  const names = row as { full_name_ar?: string | null; full_name_en?: string | null };
  const preferred = locale === "en" ? names.full_name_en : names.full_name_ar;
  const other = locale === "en" ? names.full_name_ar : names.full_name_en;
  const name = preferred?.trim() ? preferred : other;
  if (typeof name !== "string" || name.trim().length === 0) {
    return fallback;
  }
  return name;
}

export function attachProfilesById<T extends { profile_id: string }>(
  rows: T[],
  profiles: Array<{ id: string; full_name_ar: string | null; full_name_en?: string | null }>,
): Array<T & { profiles: { id: string; full_name_ar: string | null; full_name_en?: string | null } | null }> {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  return rows.map((row) => ({
    ...row,
    profiles: byId.get(row.profile_id) ?? null,
  }));
}
