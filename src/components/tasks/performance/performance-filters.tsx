"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Select } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { PERIOD_PRESETS, performanceHref, type PeriodPreset } from "./performance-model";

export type PerformanceFilterOption = { id: string; label: string };

type Props = {
  preset: PeriodPreset;
  from: string;
  to: string;
  spaceId: string | null;
  personId: string | null;
  sort: string | null;
  dir: string | null;
  spaces: PerformanceFilterOption[];
  /** Null for viewers without task.performance.read (no person focus). */
  people: PerformanceFilterOption[] | null;
};

/** URL-driven filter bar: selects apply immediately; a custom range applies on submit. */
export function PerformanceFilters({ preset, from, to, spaceId, personId, sort, dir, spaces, people }: Props) {
  const { t } = useI18n();
  const f = t.tasksPerformance.filters;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [period, setPeriod] = useState<PeriodPreset>(preset);
  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);

  const go = (patch: Record<string, string | null>) => {
    const base: Record<string, string | null> = {
      period: period === "custom" ? "custom" : period,
      from: period === "custom" ? customFrom : null,
      to: period === "custom" ? customTo : null,
      space: spaceId,
      person: personId,
      sort,
      dir,
    };
    const next = { ...base, ...patch };
    if (next.period !== "custom") {
      next.from = null;
      next.to = null;
    }
    startTransition(() => router.push(performanceHref(next), { scroll: false }));
  };

  return (
    <form
      role="search"
      aria-label={f.label}
      aria-busy={pending}
      className={cn(
        "mt-surface flex flex-wrap items-end gap-3 p-3 transition-opacity print:hidden md:p-4",
        pending && "opacity-70",
      )}
      onSubmit={(event) => {
        event.preventDefault();
        go({ period: "custom", from: customFrom, to: customTo });
      }}
      data-testid="perf-filters"
    >
      <label className="flex min-w-40 flex-1 flex-col gap-1.5 sm:flex-none">
        <span className="text-xs font-medium text-muted">{f.period}</span>
        <Select
          value={period}
          data-testid="perf-period"
          onChange={(event) => {
            const value = event.target.value as PeriodPreset;
            setPeriod(value);
            if (value !== "custom") go({ period: value });
          }}
        >
          {PERIOD_PRESETS.map((p) => (
            <option key={p} value={p}>
              {t.tasksPerformance.presets[p]}
            </option>
          ))}
        </Select>
      </label>

      {period === "custom" ? (
        <>
          <label className="flex min-w-36 flex-1 flex-col gap-1.5 sm:flex-none">
            <span className="text-xs font-medium text-muted">{f.from}</span>
            <Input
              type="date"
              required
              value={customFrom}
              max={customTo || undefined}
              onChange={(event) => setCustomFrom(event.target.value)}
              data-testid="perf-from"
            />
          </label>
          <label className="flex min-w-36 flex-1 flex-col gap-1.5 sm:flex-none">
            <span className="text-xs font-medium text-muted">{f.to}</span>
            <Input
              type="date"
              required
              value={customTo}
              min={customFrom || undefined}
              onChange={(event) => setCustomTo(event.target.value)}
              data-testid="perf-to"
            />
          </label>
          <Button type="button" variant="secondary" onClick={() => go({ period: "custom", from: customFrom, to: customTo })}>
            {f.apply}
          </Button>
        </>
      ) : null}

      <label className="flex min-w-44 flex-1 flex-col gap-1.5 sm:flex-none">
        <span className="text-xs font-medium text-muted">{f.space}</span>
        <Select value={spaceId ?? ""} onChange={(event) => go({ space: event.target.value || null })} data-testid="perf-space">
          <option value="">{f.allSpaces}</option>
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
      </label>

      {people ? (
        <label className="flex min-w-44 flex-1 flex-col gap-1.5 sm:flex-none">
          <span className="text-xs font-medium text-muted">{f.person}</span>
          <Select
            value={personId ?? ""}
            onChange={(event) => go({ person: event.target.value || null })}
            data-testid="perf-person"
          >
            <option value="">{f.wholeTeam}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </label>
      ) : null}

      {preset !== "this_month" || spaceId || personId ? (
        <Button
          type="button"
          variant="ghost"
          className="ms-auto"
          onClick={() => {
            setPeriod("this_month");
            startTransition(() => router.push(performanceHref({ sort, dir }), { scroll: false }));
          }}
        >
          {f.reset}
        </Button>
      ) : null}
    </form>
  );
}
