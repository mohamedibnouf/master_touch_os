export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_COOKIE = "mt_theme";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function resolveTheme(value: unknown): Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value) ? (value as Theme) : "system";
}

/** light → dark → system → light */
export function nextTheme(current: Theme): Theme {
  return current === "light" ? "dark" : current === "dark" ? "system" : "light";
}
