/**
 * Task detail page — pure formatting helpers (Asia/Riyadh, both locales). No I/O; safe on
 * server and client. Callers pass `now` explicitly so server and client renders agree.
 */

import { format, intlLocale, pickLocalized, type Locale } from "@/lib/i18n/config";
import { RIYADH_TIME_ZONE } from "@/lib/time/riyadh";
import { splitMinutes } from "@/modules/tasks/logic";
import type { TaskPerson, TaskStatus } from "@/modules/tasks/types";

export type DurationStrings = { hm: string; h: string; m: string };

/** 135 → "2h 15m" / "2س 15د"; 0 → "0m". */
export function formatDuration(totalMinutes: number, strings: DurationStrings): string {
  const { hours, minutes } = splitMinutes(totalMinutes);
  if (hours && minutes) return format(strings.hm, { h: hours, m: minutes });
  if (hours) return format(strings.h, { h: hours });
  return format(strings.m, { m: minutes });
}

/** Seconds → "1:05:09" / "05:09" for the live clock (Latin digits, tabular). */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatRiyadhDateTime(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: RIYADH_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/** Calendar date: accepts an ISO instant or a YYYY-MM-DD (treated as a Riyadh day). */
export function formatRiyadhDate(value: string | null | undefined, locale: Locale): string {
  if (!value) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00+03:00`) : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: RIYADH_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

export function formatRiyadhTime(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: RIYADH_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/** "5 minutes ago" / "قبل 5 دقائق"; older than a week → absolute date. */
export function formatRelative(iso: string, nowMs: number, locale: Locale, justNow: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffSec = Math.round((then - nowMs) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 45) return justNow;
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "auto" });
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 7 * 86_400) return rtf.format(Math.round(diffSec / 86_400), "day");
  return formatRiyadhDate(iso, locale);
}

export function personName(person: TaskPerson | null | undefined, locale: Locale, fallback: string): string {
  if (!person) return fallback;
  return pickLocalized(locale, person.full_name_ar, person.full_name_en) || fallback;
}

/** Up to two initials from a display name (Arabic or Latin). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = Array.from(parts[0])[0] ?? "";
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export const STATUS_TONE: Readonly<Record<TaskStatus, { dot: string; pill: string }>> = {
  todo: { dot: "bg-muted", pill: "border-line bg-surface-strong text-ink" },
  in_progress: { dot: "bg-primary", pill: "border-info-border bg-info-soft text-primary" },
  review: { dot: "bg-warning", pill: "border-warning-border bg-warning-soft text-warning" },
  done: { dot: "bg-success", pill: "border-success-border bg-success-soft text-success" },
  cancelled: { dot: "bg-muted", pill: "border-line bg-surface-muted text-muted line-through decoration-1" },
};

export const PRIORITY_TONE: Readonly<Record<string, string>> = {
  urgent: "text-danger",
  high: "text-warning",
  normal: "text-primary",
  low: "text-muted",
};
