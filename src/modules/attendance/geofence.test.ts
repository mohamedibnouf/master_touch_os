import { describe, expect, it } from "vitest";
import {
  decideGeofence,
  evidenceCoordinatesToStore,
  formatEvidenceCoordinates,
  geofenceUserMessage,
  haversineMeters,
  isInsideGeofence,
  isValidLatitude,
  isValidLongitude,
  parseAttendancePunchRpc,
  resolveWorkplaceId,
  stripExactCoordinates,
} from "./geofence";

const ORIGIN = { latitude: 24.7136, longitude: 46.6753 };

function offsetNorth(meters: number) {
  const deg = meters / 111_320;
  return { latitude: ORIGIN.latitude + deg, longitude: ORIGIN.longitude };
}

const workplace = {
  id: "wp1",
  isActive: true,
  latitude: ORIGIN.latitude,
  longitude: ORIGIN.longitude,
  allowedRadiusMeters: 150,
  maxAccuracyMeters: 100 as number | null,
};

describe("haversine and radius boundary", () => {
  it("returns ~0 at the same point", () => {
    expect(haversineMeters(ORIGIN, ORIGIN)).toBe(0);
  });

  it("accepts inside, 149.9, and exact radius; rejects 150.1 and 400", () => {
    expect(isInsideGeofence(80, 150)).toBe(true);
    expect(isInsideGeofence(149.9, 150)).toBe(true);
    expect(isInsideGeofence(150, 150)).toBe(true);
    expect(isInsideGeofence(150.1, 150)).toBe(false);
    expect(isInsideGeofence(400, 150)).toBe(false);
  });

  it("handles southern hemisphere, negative longitude, and dateline wrap", () => {
    const santiago = { latitude: -33.4489, longitude: -70.6693 };
    expect(haversineMeters(santiago, santiago)).toBe(0);
    const west = { latitude: 0, longitude: 179.8 };
    const east = { latitude: 0, longitude: -179.8 };
    expect(haversineMeters(west, east)).toBeLessThan(50_000);
  });

  it("does not persist fabricated 0,0 for invalid coordinates", () => {
    const stored = evidenceCoordinatesToStore({
      result: "INVALID_LOCATION",
      latitude: 0,
      longitude: 0,
      accuracyMeters: 12,
      distanceMeters: 99,
    });
    expect(stored).toEqual({
      latitude: null,
      longitude: null,
      accuracyMeters: null,
      distanceMeters: null,
    });
    expect(formatEvidenceCoordinates(null, null)).toBe("غير متاح");
    expect(formatEvidenceCoordinates(0, 0)).toBe("0.00000, 0.00000");
  });

  it("rejects invalid coordinates", () => {
    expect(isValidLatitude(91)).toBe(false);
    expect(isValidLongitude(-181)).toBe(false);
    expect(decideGeofence({ latitude: 91, longitude: 0, accuracyMeters: 10, workplace }).result).toBe(
      "INVALID_LOCATION",
    );
  });
});

describe("accuracy and workplace resolution", () => {
  it("rejects poor accuracy without expanding radius", () => {
    const poor = decideGeofence({
      latitude: ORIGIN.latitude,
      longitude: ORIGIN.longitude,
      accuracyMeters: 450,
      workplace,
    });
    expect(poor.result).toBe("POOR_ACCURACY");
    expect(poor.distanceMeters).toBeNull();
    const ok = decideGeofence({
      latitude: ORIGIN.latitude,
      longitude: ORIGIN.longitude,
      accuracyMeters: 35,
      workplace,
    });
    expect(ok.result).toBe("ACCEPTED");
  });

  it("rejects missing or inactive workplace", () => {
    expect(
      decideGeofence({ latitude: ORIGIN.latitude, longitude: ORIGIN.longitude, accuracyMeters: 10, workplace: null })
        .result,
    ).toBe("NO_WORKPLACE");
    expect(
      decideGeofence({
        latitude: ORIGIN.latitude,
        longitude: ORIGIN.longitude,
        accuracyMeters: 10,
        workplace: { ...workplace, isActive: false },
      }).result,
    ).toBe("INACTIVE_WORKPLACE");
  });

  it("uses assignment covering the date then org primary", () => {
    expect(
      resolveWorkplaceId({
        assignments: [{ workplaceId: "a", effectiveFrom: "2026-01-01", effectiveTo: "2026-01-31" }],
        primaryWorkplaceId: "primary",
        onDate: "2026-01-15",
      }),
    ).toBe("a");
    expect(
      resolveWorkplaceId({
        assignments: [
          { workplaceId: "a", effectiveFrom: "2026-01-01", effectiveTo: "2026-01-31" },
          { workplaceId: "b", effectiveFrom: "2026-02-01", effectiveTo: null },
        ],
        primaryWorkplaceId: "primary",
        onDate: "2026-01-31",
      }),
    ).toBe("a");
    expect(
      resolveWorkplaceId({
        assignments: [
          { workplaceId: "a", effectiveFrom: "2026-01-01", effectiveTo: "2026-01-31" },
          { workplaceId: "b", effectiveFrom: "2026-02-01", effectiveTo: null },
        ],
        primaryWorkplaceId: "primary",
        onDate: "2026-02-01",
      }),
    ).toBe("b");
    expect(
      resolveWorkplaceId({
        assignments: [],
        primaryWorkplaceId: null,
        onDate: "2026-01-15",
      }),
    ).toBeNull();
  });

  it("accepts a point ~80m north and rejects ~400m north", () => {
    const inside = decideGeofence({
      ...offsetNorth(80),
      accuracyMeters: 20,
      workplace,
    });
    expect(inside.result).toBe("ACCEPTED");
    const outside = decideGeofence({
      ...offsetNorth(400),
      accuracyMeters: 20,
      workplace,
    });
    expect(outside.result).toBe("OUTSIDE_GEOFENCE");
  });

  it("maps RPC exception text to Arabic user copy", () => {
    expect(geofenceUserMessage("GEOFENCE_OUTSIDE").ar).toContain("خارج نطاق");
    expect(geofenceUserMessage("GEOFENCE_POOR_ACCURACY").ar).toContain("دقة الموقع");
    expect(geofenceUserMessage("GEOFENCE_NO_WORKPLACE").ar).toContain("لم يتم تحديد موقع عمل");
  });

  it("maps structured punch RPC rejection without treating it as success", () => {
    const parsed = parseAttendancePunchRpc({
      accepted: false,
      reason_code: "GEOFENCE_OUTSIDE",
      attempt_id: "11111111-1111-1111-1111-111111111111",
      attendance_record: null,
    });
    expect(parsed?.accepted).toBe(false);
    expect(geofenceUserMessage(parsed!.reason_code).ar).toContain("خارج نطاق");
  });

  it("strips exact coordinates from payloads", () => {
    const stripped = stripExactCoordinates({
      id: "1",
      latitude: 1,
      longitude: 2,
      check_in_latitude: 3,
      distance: 40,
    });
    expect(stripped.latitude).toBeUndefined();
    expect(stripped.longitude).toBeUndefined();
    expect(stripped.check_in_latitude).toBeUndefined();
    expect(stripped.distance).toBe(40);
  });
});
