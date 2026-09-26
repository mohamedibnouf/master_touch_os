import { describe, expect, it } from "vitest";
import {
  canAddWorkplaceAssignment,
  decideGeofence,
  decideGeofenceForWorkplaces,
  evidenceCoordinatesToStore,
  formatEvidenceCoordinates,
  geofenceUserMessage,
  haversineMeters,
  isInsideGeofence,
  isValidLatitude,
  isValidLongitude,
  parseAttendancePunchRpc,
  resolveEligibleWorkplaceIds,
  resolveWorkplaceId,
  stripExactCoordinates,
  WORKPLACE_DIRECTORY_SAFE_COLUMNS,
} from "./geofence";

const ORIGIN = { latitude: 24.7136, longitude: 46.6753 };

function offsetNorth(meters: number) {
  const deg = meters / 111_320;
  return { latitude: ORIGIN.latitude + deg, longitude: ORIGIN.longitude };
}

const hq = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  isActive: true,
  latitude: ORIGIN.latitude,
  longitude: ORIGIN.longitude,
  allowedRadiusMeters: 150,
  maxAccuracyMeters: 100 as number | null,
};

const warehouse = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  isActive: true,
  latitude: ORIGIN.latitude + 400 / 111_320,
  longitude: ORIGIN.longitude,
  allowedRadiusMeters: 150,
  maxAccuracyMeters: 200 as number | null,
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
    expect(decideGeofence({ latitude: 91, longitude: 0, accuracyMeters: 10, workplace: hq }).result).toBe(
      "INVALID_LOCATION",
    );
  });
});

describe("Phase 5.7.1 multi-workplace matching A–L", () => {
  it("A. HQ only → HQ accepted", () => {
    const d = decideGeofence({ latitude: ORIGIN.latitude, longitude: ORIGIN.longitude, accuracyMeters: 20, workplace: hq });
    expect(d.result).toBe("ACCEPTED");
    expect(d.workplaceId).toBe(hq.id);
  });

  it("B. HQ + Warehouse can each be accepted independently", () => {
    const atHq = decideGeofenceForWorkplaces({
      latitude: ORIGIN.latitude,
      longitude: ORIGIN.longitude,
      accuracyMeters: 20,
      coveringAssignmentCount: 2,
      workplaces: [hq, warehouse],
    });
    expect(atHq.result).toBe("ACCEPTED");
    expect(atHq.workplaceId).toBe(hq.id);
    const atWh = decideGeofenceForWorkplaces({
      ...offsetNorth(400),
      accuracyMeters: 20,
      coveringAssignmentCount: 2,
      workplaces: [hq, warehouse],
    });
    expect(atWh.result).toBe("ACCEPTED");
    expect(atWh.workplaceId).toBe(warehouse.id);
  });

  it("C. assigned HQ only but standing at Warehouse → OUTSIDE_GEOFENCE", () => {
    const d = decideGeofenceForWorkplaces({
      ...offsetNorth(400),
      accuracyMeters: 20,
      coveringAssignmentCount: 1,
      workplaces: [hq],
    });
    expect(d.result).toBe("OUTSIDE_GEOFENCE");
    expect(d.workplaceId).toBe(hq.id);
  });

  it("D. no assignment → NO_WORKPLACE even if org primary exists in the workplace list", () => {
    const d = decideGeofenceForWorkplaces({
      latitude: ORIGIN.latitude,
      longitude: ORIGIN.longitude,
      accuracyMeters: 20,
      coveringAssignmentCount: 0,
      workplaces: [hq],
    });
    expect(d.result).toBe("NO_WORKPLACE");
    expect(d.workplaceId).toBeNull();
  });

  it("E. assigned site inactive → INACTIVE_WORKPLACE", () => {
    expect(
      decideGeofenceForWorkplaces({
        latitude: ORIGIN.latitude,
        longitude: ORIGIN.longitude,
        accuracyMeters: 10,
        coveringAssignmentCount: 1,
        workplaces: [{ ...hq, isActive: false }],
      }).result,
    ).toBe("INACTIVE_WORKPLACE");
  });

  it("F. outside every assigned site → OUTSIDE_GEOFENCE", () => {
    const d = decideGeofenceForWorkplaces({
      ...offsetNorth(2000),
      accuracyMeters: 20,
      coveringAssignmentCount: 2,
      workplaces: [hq, warehouse],
    });
    expect(d.result).toBe("OUTSIDE_GEOFENCE");
  });

  it("G. inside site but poor GPS accuracy → POOR_ACCURACY", () => {
    const poor = decideGeofence({
      latitude: ORIGIN.latitude,
      longitude: ORIGIN.longitude,
      accuracyMeters: 450,
      workplace: hq,
    });
    expect(poor.result).toBe("POOR_ACCURACY");
    expect(poor.workplaceId).toBe(hq.id);
    expect(poor.distanceMeters).toBe(0);
  });

  it("H. inside A with poor accuracy but inside B with valid accuracy → B accepted", () => {
    const tight = { ...hq, maxAccuracyMeters: 30 };
    const loose = {
      ...warehouse,
      latitude: ORIGIN.latitude,
      longitude: ORIGIN.longitude,
      maxAccuracyMeters: 200,
    };
    const d = decideGeofenceForWorkplaces({
      latitude: ORIGIN.latitude,
      longitude: ORIGIN.longitude,
      accuracyMeters: 80,
      coveringAssignmentCount: 2,
      workplaces: [tight, loose],
    });
    expect(d.result).toBe("ACCEPTED");
    expect(d.workplaceId).toBe(loose.id);
  });

  it("I. inside two valid sites → nearest selected", () => {
    const near = { ...hq, allowedRadiusMeters: 500 };
    const far = { ...warehouse, allowedRadiusMeters: 500 };
    const d = decideGeofenceForWorkplaces({
      latitude: ORIGIN.latitude,
      longitude: ORIGIN.longitude,
      accuracyMeters: 20,
      coveringAssignmentCount: 2,
      workplaces: [far, near],
    });
    expect(d.result).toBe("ACCEPTED");
    expect(d.workplaceId).toBe(near.id);
  });

  it("J. equal distance → deterministic lower workplace id", () => {
    const a = { ...hq, id: "cccccccc-cccc-cccc-cccc-cccccccccccc" };
    const b = { ...hq, id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" };
    const d = decideGeofenceForWorkplaces({
      latitude: ORIGIN.latitude,
      longitude: ORIGIN.longitude,
      accuracyMeters: 20,
      coveringAssignmentCount: 2,
      workplaces: [a, b],
    });
    expect(d.workplaceId).toBe(b.id);
  });

  it("K. overlapping assignment ranges for different sites → allowed", () => {
    expect(
      canAddWorkplaceAssignment(
        [{ workplaceId: "hq", effectiveFrom: "2026-01-01", effectiveTo: null }],
        { workplaceId: "wh", effectiveFrom: "2026-01-01", effectiveTo: null },
      ).ok,
    ).toBe(true);
  });

  it("L. overlapping assignment ranges for the same site → rejected", () => {
    expect(
      canAddWorkplaceAssignment(
        [{ workplaceId: "hq", effectiveFrom: "2026-01-01", effectiveTo: null }],
        { workplaceId: "hq", effectiveFrom: "2026-06-01", effectiveTo: null },
      ),
    ).toEqual({ ok: false, reason: "same_workplace_overlap" });
  });
});

describe("accuracy, directory privacy, and assignment resolution", () => {
  it("does not use org primary as punch authorization", () => {
    expect(
      resolveWorkplaceId({
        assignments: [],
        primaryWorkplaceId: "primary",
        onDate: "2026-01-15",
      }),
    ).toBeNull();
    expect(
      resolveEligibleWorkplaceIds({
        assignments: [{ workplaceId: "a", effectiveFrom: "2026-01-01", effectiveTo: "2026-01-31" }],
        onDate: "2026-01-15",
      }),
    ).toEqual(["a"]);
  });

  it("accepts a point ~80m north and rejects ~400m north", () => {
    const inside = decideGeofence({
      ...offsetNorth(80),
      accuracyMeters: 20,
      workplace: hq,
    });
    expect(inside.result).toBe("ACCEPTED");
    const outside = decideGeofence({
      ...offsetNorth(400),
      accuracyMeters: 20,
      workplace: hq,
    });
    expect(outside.result).toBe("OUTSIDE_GEOFENCE");
  });

  it("P. directory column list has no latitude/longitude", () => {
    expect(WORKPLACE_DIRECTORY_SAFE_COLUMNS).not.toMatch(/latitude/);
    expect(WORKPLACE_DIRECTORY_SAFE_COLUMNS).not.toMatch(/longitude/);
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
