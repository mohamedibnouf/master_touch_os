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

export type GeofenceDecision = {
  result: GeofenceReason;
  distanceMeters: number | null;
  workplaceId: string | null;
};

function accuracyAcceptable(workplace: WorkplaceForGeofence, accuracyMeters: number | null): boolean {
  if (workplace.maxAccuracyMeters == null) return true;
  return (
    accuracyMeters != null &&
    Number.isFinite(accuracyMeters) &&
    accuracyMeters >= 0 &&
    accuracyMeters <= workplace.maxAccuracyMeters
  );
}

function nearer(
  dist: number,
  id: string,
  bestDist: number | null,
  bestId: string | null,
): boolean {
  if (bestDist == null || bestId == null) return true;
  if (dist < bestDist) return true;
  if (dist === bestDist && id < bestId) return true;
  return false;
}

/**
 * Authoritative matching is SQL `enforce_attendance_geofence` after 064.
 * This mirrors: explicit assignments only, nearest valid site, per-site radius/accuracy.
 */
export function decideGeofenceForWorkplaces(input: {
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  coveringAssignmentCount: number;
  workplaces: WorkplaceForGeofence[];
}): GeofenceDecision {
  if (
    input.latitude == null ||
    input.longitude == null ||
    !isValidLatitude(input.latitude) ||
    !isValidLongitude(input.longitude)
  ) {
    return { result: "INVALID_LOCATION", distanceMeters: null, workplaceId: null };
  }
  if (input.coveringAssignmentCount <= 0) {
    return { result: "NO_WORKPLACE", distanceMeters: null, workplaceId: null };
  }

  const active = input.workplaces.filter((w) => w.isActive);
  if (active.length === 0) {
    return { result: "INACTIVE_WORKPLACE", distanceMeters: null, workplaceId: null };
  }

  const point = { latitude: input.latitude, longitude: input.longitude };
  let bestValid: { id: string; dist: number } | null = null;
  let bestInRange: { id: string; dist: number } | null = null;
  let bestActive: { id: string; dist: number } | null = null;

  for (const workplace of active) {
    const dist = haversineMeters(point, { latitude: workplace.latitude, longitude: workplace.longitude });
    if (nearer(dist, workplace.id, bestActive?.dist ?? null, bestActive?.id ?? null)) {
      bestActive = { id: workplace.id, dist };
    }
    if (!isInsideGeofence(dist, workplace.allowedRadiusMeters)) continue;
    if (nearer(dist, workplace.id, bestInRange?.dist ?? null, bestInRange?.id ?? null)) {
      bestInRange = { id: workplace.id, dist };
    }
    if (!accuracyAcceptable(workplace, input.accuracyMeters)) continue;
    if (nearer(dist, workplace.id, bestValid?.dist ?? null, bestValid?.id ?? null)) {
      bestValid = { id: workplace.id, dist };
    }
  }

  if (bestValid) {
    return { result: "ACCEPTED", distanceMeters: bestValid.dist, workplaceId: bestValid.id };
  }
  if (bestInRange) {
    return { result: "POOR_ACCURACY", distanceMeters: bestInRange.dist, workplaceId: bestInRange.id };
  }
  return {
    result: "OUTSIDE_GEOFENCE",
    distanceMeters: bestActive?.dist ?? null,
    workplaceId: bestActive?.id ?? null,
  };
}

export function decideGeofence(input: {
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  workplace?: WorkplaceForGeofence | null;
  workplaces?: WorkplaceForGeofence[];
  coveringAssignmentCount?: number;
}): GeofenceDecision {
  if (input.workplaces || input.coveringAssignmentCount != null) {
    return decideGeofenceForWorkplaces({
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyMeters: input.accuracyMeters,
      coveringAssignmentCount: input.coveringAssignmentCount ?? input.workplaces?.length ?? 0,
      workplaces: input.workplaces ?? (input.workplace ? [input.workplace] : []),
    });
  }
  if (!input.workplace) {
    return decideGeofenceForWorkplaces({
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyMeters: input.accuracyMeters,
      coveringAssignmentCount: 0,
      workplaces: [],
    });
  }
  return decideGeofenceForWorkplaces({
    latitude: input.latitude,
    longitude: input.longitude,
    accuracyMeters: input.accuracyMeters,
    coveringAssignmentCount: 1,
    workplaces: [input.workplace],
  });
}

export type WorkplaceAssignment = {
  workplaceId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export function assignmentCoversDate(assignment: WorkplaceAssignment, onDate: string): boolean {
  return assignment.effectiveFrom <= onDate && (assignment.effectiveTo == null || assignment.effectiveTo >= onDate);
}

export function assignmentDateRangesOverlap(a: WorkplaceAssignment, b: WorkplaceAssignment): boolean {
  const aEnd = a.effectiveTo ?? "9999-12-31";
  const bEnd = b.effectiveTo ?? "9999-12-31";
  return a.effectiveFrom <= bEnd && b.effectiveFrom <= aEnd;
}

/** Same employee + same workplace overlapping dates is forbidden. Different workplaces may overlap. */
export function canAddWorkplaceAssignment(
  existing: WorkplaceAssignment[],
  candidate: WorkplaceAssignment,
): { ok: true } | { ok: false; reason: "same_workplace_overlap" } {
  for (const row of existing) {
    if (row.workplaceId !== candidate.workplaceId) continue;
    if (assignmentDateRangesOverlap(row, candidate)) {
      return { ok: false, reason: "same_workplace_overlap" };
    }
  }
  return { ok: true };
}

/** Covering explicit assignment workplace IDs. Org primary is never a fallback. */
export function resolveEligibleWorkplaceIds(input: {
  assignments: WorkplaceAssignment[];
  onDate: string;
  activeWorkplaceIds?: ReadonlySet<string>;
}): string[] {
  const ids = input.assignments.filter((a) => assignmentCoversDate(a, input.onDate)).map((a) => a.workplaceId);
  if (!input.activeWorkplaceIds) return [...new Set(ids)].sort();
  return [...new Set(ids.filter((id) => input.activeWorkplaceIds!.has(id)))].sort();
}

/** @deprecated Use resolveEligibleWorkplaceIds. Primary fallback removed in 064. */
export function resolveWorkplaceId(input: {
  assignments: WorkplaceAssignment[];
  primaryWorkplaceId?: string | null;
  onDate: string;
}): string | null {
  const ids = resolveEligibleWorkplaceIds({ assignments: input.assignments, onDate: input.onDate });
  return ids[0] ?? null;
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

export const WORKPLACE_DIRECTORY_SAFE_COLUMNS =
  "id, organization_id, name, code, address, allowed_radius_meters, max_accuracy_meters, timezone, is_active, is_primary, created_at, updated_at" as const;

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
