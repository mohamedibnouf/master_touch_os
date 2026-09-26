"use client";

import { useState } from "react";
import { Button } from "@/components/ui/primitives";

export function FillCurrentLocationButton() {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div>
      <Button
        type="button"
        variant="secondary"
        className="min-h-11"
        onClick={() => {
          setMsg(null);
          if (!navigator.geolocation) {
            setMsg("المتصفح لا يدعم تحديد الموقع.");
            return;
          }
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const lat = document.querySelector<HTMLInputElement>('input[name="latitude"]');
              const lng = document.querySelector<HTMLInputElement>('input[name="longitude"]');
              if (lat) lat.value = String(pos.coords.latitude);
              if (lng) lng.value = String(pos.coords.longitude);
              setMsg("تم تعبئة الإحداثيات من جهازك.");
            },
            () => setMsg("تعذر قراءة الموقع."),
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
          );
        }}
      >
        استخدم موقعي الحالي
      </Button>
      {msg ? <p className="mt-2 text-xs text-muted">{msg}</p> : null}
    </div>
  );
}
