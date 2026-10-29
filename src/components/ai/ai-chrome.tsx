"use client";

import type { ReactNode } from "react";
import { Info, Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

export function AiSparkle({ className }: { className?: string }) {
  return <Sparkles aria-hidden className={className ?? "h-4 w-4 shrink-0 text-brand"} strokeWidth={2} />;
}

/** Card title row with the brand sparkle badge, shared by every AI surface. */
export function AiHeading({
  title,
  subtitle,
  as: Tag = "h2",
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  as?: "h2" | "h3";
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-soft">
        <AiSparkle />
      </span>
      <div className="min-w-0">
        <Tag className="text-sm font-semibold text-ink">{title}</Tag>
        {subtitle ? <p className="text-xs text-muted">{subtitle}</p> : null}
      </div>
    </div>
  );
}

export function AiDisclaimer({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <p className={cn("flex items-start gap-1.5 text-xs text-muted", className)}>
      <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{t.ai.disclaimer}</span>
    </p>
  );
}
