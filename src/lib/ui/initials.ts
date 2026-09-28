/** Display initials only — never stored. */
export function displayInitials(name: string, fallback = "؟"): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0]!.slice(0, 1);
  return `${parts[0]!.slice(0, 1)}${parts[parts.length - 1]!.slice(0, 1)}`;
}
