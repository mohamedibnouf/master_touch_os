import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function FormSection({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0", className)}>
      <div className="mb-3 flex items-start gap-2.5">
        {Icon ? (
          <span className="mt-icon-well mt-0.5">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-navy">{title}</h2>
          {description ? <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}
