export type GeoPoint = { latitude: number; longitude: number };

export const EARTH_RADIUS_METERS = 6_371_000;

export function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Meters, rounded to 2 decimals — matches public.haversine_meters. */
export function haversineMeters(from: GeoPoint, to: GeoPoint): number {
  const dLat = toRad(to.latitude - from.latitude);
  const dLng = toRad(to.longitude - from.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.latitude)) * Math.cos(toRad(to.latitude)) * Math.sin(dLng / 2) ** 2;
  const meters = EARTH_RADIUS_METERS * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  return Math.round(meters * 100) / 100;
}

export function isInsideGeofence(distanceMeters: number, allowedRadiusMeters: number): boolean {
  return distanceMeters <= allowedRadiusMeters;
}

export type GeofenceReason =
  | "ACCEPTED"
  | "OUTSIDE_GEOFENCE"
  | "POOR_ACCURACY"
  | "NO_WORKPLACE"
  | "INVALID_LOCATION"
  | "INACTIVE_WORKPLACE";

export type WorkplaceForGeofence = {
  id: string;
  isActive: boolean;
  latitude: number;
  longitude: number;
  allowedRadiusMeters: number;
  maxAccuracyMeters: number | null;
};

export function decideGeofence(input: {
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  workplace: WorkplaceForGeofence | null;
}): { result: GeofenceReason; distanceMeters: number | null } {
  if (
    input.latitude == null ||
    input.longitude == null ||
    !isValidLatitude(input.latitude) ||
    !isValidLongitude(input.longitude)
  ) {
    return { result: "INVALID_LOCATION", distanceMeters: null };
  }
  if (!input.workplace) {
    return { result: "NO_WORKPLACE", distanceMeters: null };
  }
  if (!input.workplace.isActive) {
    return { result: "INACTIVE_WORKPLACE", distanceMeters: null };
  }
  if (
    input.workplace.maxAccuracyMeters != null &&
    (input.accuracyMeters == null || input.accuracyMeters > input.workplace.maxAccuracyMeters)
  ) {
    return { result: "POOR_ACCURACY", distanceMeters: null };
  }
  const distanceMeters = haversineMeters(
    { latitude: input.latitude, longitude: input.longitude },
    { latitude: input.workplace.latitude, longitude: input.workplace.longitude },
  );
  if (!isInsideGeofence(distanceMeters, input.workplace.allowedRadiusMeters)) {
    return { result: "OUTSIDE_GEOFENCE", distanceMeters };
  }
  return { result: "ACCEPTED", distanceMeters };
}

export type WorkplaceAssignment = {
  workplaceId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export function resolveWorkplaceId(input: {
  assignments: WorkplaceAssignment[];
  primaryWorkplaceId: string | null;
  onDate: string;
}): string | null {
  const covering = input.assignments
    .filter((a) => a.effectiveFrom <= input.onDate && (a.effectiveTo == null || a.effectiveTo >= input.onDate))
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  if (covering[0]) return covering[0].workplaceId;
  return input.primaryWorkplaceId;
}

export function geofenceUserMessage(reason: string): { ar: string; en: string } {
  const u = reason.toUpperCase();
  if (u.includes("OUTSIDE")) {
    return {
      ar: "أنت خارج نطاق موقع العمل المسموح لتسجيل الحضور.",
      en: "You are outside the allowed workplace area.",
    };
  }
  if (u.includes("POOR_ACCURACY")) {
    return {
      ar: "دقة الموقع الحالية غير كافية. انتقل إلى مكان مفتوح أو فعّل الموقع الدقيق ثم حاول مرة أخرى.",
      en: "Location accuracy is not sufficient. Move outdoors or enable precise location and retry.",
    };
  }
  if (u.includes("NO_WORKPLACE")) {
    return {
      ar: "لم يتم تحديد موقع عمل معتمد لهذا الموظف.",
      en: "No approved workplace is configured for this employee.",
    };
  }
  if (u.includes("INACTIVE_WORKPLACE")) {
    return {
      ar: "موقع العمل المحدد غير متاح حاليًا.",
      en: "The assigned workplace is currently inactive.",
    };
  }
  if (u.includes("LOCATION_REQUIRED")) {
    return {
      ar: "يجب تحديد الموقع لتسجيل الحضور.",
      en: "Location is required to record attendance.",
    };
  }
  if (u.includes("INVALID_LOCATION")) {
    return { ar: "تعذر التحقق من إحداثيات الموقع.", en: "The reported coordinates are invalid." };
  }
  return { ar: "تعذر تسجيل الحضور. حاول مرة أخرى.", en: "Attendance could not be recorded. Please retry." };
}

export function evidenceCoordinatesToStore(input: {
  result: GeofenceReason;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  distanceMeters: number | null;
}): {
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  distanceMeters: number | null;
} {
  if (input.result === "INVALID_LOCATION") {
    return { latitude: null, longitude: null, accuracyMeters: null, distanceMeters: null };
  }
  return {
    latitude: input.latitude,
    longitude: input.longitude,
    accuracyMeters: input.accuracyMeters,
    distanceMeters: input.distanceMeters,
  };
}

export function formatEvidenceCoordinates(latitude: number | null | undefined, longitude: number | null | undefined): string {
  if (latitude == null || longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return "غير متاح";
  }
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

export type AttendancePunchRpc = {
  accepted: boolean;
  reason_code: string;
  attempt_id: string | null;
  attendance_record: Record<string, unknown> | null;
};

export function parseAttendancePunchRpc(data: unknown): AttendancePunchRpc | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (typeof row.accepted !== "boolean") return null;
  return {
    accepted: row.accepted,
    reason_code: String(row.reason_code ?? ""),
    attempt_id: row.attempt_id != null ? String(row.attempt_id) : null,
    attendance_record: (row.attendance_record as Record<string, unknown> | null) ?? null,
  };
}

export function stripExactCoordinates<T extends Record<string, unknown>>(row: T): T {
  const next = { ...row };
  delete next.latitude;
  delete next.longitude;
  delete next.check_in_latitude;
  delete next.check_in_longitude;
  delete next.check_out_latitude;
  delete next.check_out_longitude;
  return next;
}
