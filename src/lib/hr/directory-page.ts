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

export function directoryProfileName(profiles: unknown): string {
  const row = Array.isArray(profiles) ? profiles[0] : profiles;
  if (!row || typeof row !== "object") {
    return "بدون اسم";
  }
  const name = (row as { full_name_ar?: string | null }).full_name_ar;
  if (typeof name !== "string" || name.trim().length === 0) {
    return "بدون اسم";
  }
  return name;
}

export function attachProfilesById<T extends { profile_id: string }>(
  rows: T[],
  profiles: Array<{ id: string; full_name_ar: string | null }>,
): Array<T & { profiles: { id: string; full_name_ar: string | null } | null }> {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  return rows.map((row) => ({
    ...row,
    profiles: byId.get(row.profile_id) ?? null,
  }));
}
