"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/primitives";
import {
  checkInWithLocationAction,
  checkOutWithLocationAction,
  type AttendancePunchState,
} from "@/server/use-cases/attendance";

function clientGpsMessage(err: GeolocationPositionError): string {
  if (err.code === err.PERMISSION_DENIED) return "يجب السماح بالوصول إلى الموقع لتسجيل الحضور.";
  if (err.code === err.TIMEOUT) return "تعذر تحديد موقعك في الوقت المحدد. حاول مرة أخرى.";
  return "تعذر تحديد موقعك. حاول مرة أخرى.";
}

export function GeofencePunchButton({
  action,
  label,
  testId,
  variant = "primary",
}: {
  action: "check_in" | "check_out";
  label: string;
  testId: string;
  variant?: "primary" | "secondary";
}) {
  const [localError, setLocalError] = useState<string | null>(null);
  const [waitingGps, setWaitingGps] = useState(false);
  const bound = action === "check_in" ? checkInWithLocationAction : checkOutWithLocationAction;
  const [state, formAction, pending] = useActionState<AttendancePunchState | null, FormData>(bound, null);

  async function onSubmit(formData: FormData) {
    setLocalError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocalError("جهازك أو المتصفح لا يدعم تحديد الموقع.");
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
        setLocalError(clientGpsMessage(err as GeolocationPositionError));
      } else {
        setLocalError("تعذر تحديد موقعك. حاول مرة أخرى.");
      }
    } finally {
      setWaitingGps(false);
    }
  }

  const busy = pending || waitingGps;
  const message = localError || (!state?.ok ? state?.message : null);

  return (
    <form action={onSubmit} className="w-full sm:w-auto">
      <Button type="submit" variant={variant} className="min-h-11 w-full sm:w-auto" data-testid={testId} disabled={busy}>
        {waitingGps ? "جاري تحديد الموقع…" : pending ? "جاري التحقق…" : label}
      </Button>
      {message ? (
        <p className="mt-2 text-sm text-danger" data-testid="attendance-geofence-error">
          {message}
        </p>
      ) : null}
      {state?.ok ? (
        <p className="mt-2 text-sm text-success" data-testid="attendance-geofence-ok">
          تم التسجيل.
        </p>
      ) : null}
    </form>
  );
}
