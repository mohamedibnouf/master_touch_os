"use client";

import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/client";

export function FillCurrentLocationButton() {
  const { t } = useI18n();
  const tl = t.attendance.locations;
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
            setMsg(tl.browserNoGeolocation);
            return;
          }
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const lat = document.querySelector<HTMLInputElement>('input[name="latitude"]');
              const lng = document.querySelector<HTMLInputElement>('input[name="longitude"]');
              if (lat) lat.value = String(pos.coords.latitude);
              if (lng) lng.value = String(pos.coords.longitude);
              setMsg(tl.coordinatesFilled);
            },
            () => setMsg(tl.locationReadFailed),
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
          );
        }}
      >
        {tl.useCurrentLocation}
      </Button>
      {msg ? <p className="mt-2 text-xs text-muted">{msg}</p> : null}
    </div>
  );
}
