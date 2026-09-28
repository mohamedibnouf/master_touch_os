import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function PageContainer({
  variant = "wide",
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: "wide" | "form" }) {
  return (
    <div
      className={cn(
        "min-w-0 w-full",
        variant === "wide" && "mx-auto max-w-[1600px]",
        variant === "form" && "mx-auto max-w-3xl",
        className,
      )}
      {...props}
    />
  );
}
