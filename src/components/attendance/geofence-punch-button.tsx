"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import type { Dictionary } from "@/lib/i18n/dictionaries/ar";
import { gpsStageCopy } from "@/modules/attendance/gps-ux";
import {
  checkInWithLocationAction,
  checkOutWithLocationAction,
  type AttendancePunchState,
} from "@/server/use-cases/attendance";

function clientGpsMessage(err: GeolocationPositionError, tp: Dictionary["attendance"]["punch"]): string {
  if (err.code === err.PERMISSION_DENIED) return tp.permissionDenied;
  if (err.code === err.TIMEOUT) return tp.timeout;
  return tp.failed;
}

export function GeofencePunchButton({
  action,
  label,
  testId,
  variant = "primary",
  size = "default",
}: {
  action: "check_in" | "check_out";
  label: string;
  testId: string;
  variant?: "primary" | "secondary";
  /** "large" renders a taller, full-width button for the self check-in screen. */
  size?: "default" | "large";
}) {
  const { t, locale } = useI18n();
  const tp = t.attendance.punch;
  const stage = gpsStageCopy(locale);
  const [localError, setLocalError] = useState<string | null>(null);
  const [waitingGps, setWaitingGps] = useState(false);
  const bound = action === "check_in" ? checkInWithLocationAction : checkOutWithLocationAction;
  const [state, formAction, pending] = useActionState<AttendancePunchState | null, FormData>(bound, null);

  async function onSubmit(formData: FormData) {
    setLocalError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocalError(tp.noGeolocation);
      return;
    }
    setWaitingGps(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 20_000,
          maximumAge: 0,
        });
      });
      formData.set("latitude", String(pos.coords.latitude));
      formData.set("longitude", String(pos.coords.longitude));
      formData.set("accuracyMeters", String(pos.coords.accuracy ?? 0));
      formAction(formData);
    } catch (err) {
      if (err && typeof err === "object" && "code" in err) {
        setLocalError(clientGpsMessage(err as GeolocationPositionError, tp));
      } else {
        setLocalError(tp.failed);
      }
    } finally {
      setWaitingGps(false);
    }
  }

  const busy = pending || waitingGps;
  const message = localError || (!state?.ok ? state?.message : null);
  const large = size === "large";

  return (
    <form action={onSubmit} className={cn("w-full", !large && "sm:w-auto")}>
      <Button
        type="submit"
        variant={variant}
        className={cn("min-h-11 w-full", large ? "min-h-12 text-base md:min-h-12" : "sm:w-auto")}
        data-testid={testId}
        disabled={busy}
        aria-busy={busy}
      >
        {waitingGps ? stage.locating : pending ? stage.verifying : label}
      </Button>
      {message ? (
        <p className="mt-2 text-sm text-danger" role="alert" data-testid="attendance-geofence-error">
          {message}
        </p>
      ) : null}
      {state?.ok ? (
        <p className="mt-2 text-sm text-success" role="status" data-testid="attendance-geofence-ok">
          {tp.success}
        </p>
      ) : null}
    </form>
  );
}
