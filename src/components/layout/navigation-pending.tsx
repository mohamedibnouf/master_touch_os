"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export function navigationTargetKey(pathname: string, search: string): string {
  return `${pathname}${search}`;
}

export function shouldShowNavigationPending(currentKey: string, pendingKey: string | null): boolean {
  return pendingKey !== null && pendingKey !== currentKey;
}

export function NavigationPendingBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString() ? `?${searchParams.toString()}` : "";
  const currentKey = navigationTargetKey(pathname, search);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const active = shouldShowNavigationPending(currentKey, pendingKey);

  useEffect(() => {
    const onPopState = () => setPendingKey(null);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a");
      if (!anchor || !(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const raw = anchor.getAttribute("href");
      if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:")) return;
      let url: URL;
      try {
        url = new URL(anchor.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      const nextKey = navigationTargetKey(url.pathname, url.search);
      if (nextKey === currentKey) return;
      setPendingKey(nextKey);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [currentKey]);

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden print:hidden duration-150 transition-opacity",
        active ? "opacity-100" : "opacity-0",
      )}
      role="progressbar"
      aria-hidden={!active}
      aria-label={active ? "جارٍ الانتقال" : undefined}
    >
      <div className={cn("h-full w-full origin-right bg-primary", active && "animate-nav-indeterminate")} />
    </div>
  );
}
