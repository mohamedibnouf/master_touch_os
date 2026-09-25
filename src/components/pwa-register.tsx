"use client";

import { useEffect } from "react";

/** Registers a pass-through service worker so Chrome/Android can install the PWA. */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      /* installability still works via manifest on some desktop browsers */
    });
  }, []);
  return null;
}
