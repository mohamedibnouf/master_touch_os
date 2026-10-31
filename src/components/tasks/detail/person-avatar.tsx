import { cn } from "@/lib/utils";
import { initialsOf } from "./detail-format";

const TINTS = [
  "bg-primary-soft text-primary",
  "bg-info-soft text-primary",
  "bg-success-soft text-success",
  "bg-warning-soft text-warning",
  "bg-surface-strong text-ink",
] as const;

function tintFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

/** Initials avatar with a stable tint per person. Decorative: pair it with a visible name or label. */
export function PersonAvatar({
  name,
  seed,
  size = "md",
  className,
  title,
}: {
  name: string;
  seed: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  title?: string;
}) {
  return (
    <span
      aria-hidden
      title={title}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold ring-2 ring-surface",
        size === "sm" && "h-6 w-6 text-[0.625rem]",
        size === "md" && "h-8 w-8 text-xs",
        size === "lg" && "h-9 w-9 text-sm",
        tintFor(seed),
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
