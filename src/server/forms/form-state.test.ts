import { describe, expect, it } from "vitest";
import { appErrorBoundaryCopy } from "@/lib/errors/boundary-copy";
import { formActionFailure, runFormAction } from "@/server/forms/form-state";
import {
  ConflictError,
  DatabaseError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@/lib/errors";
import { geofenceUserMessage, parseAttendancePunchRpc } from "@/modules/attendance/geofence";
import { canAddWorkplaceAssignment } from "@/modules/attendance/geofence";

describe("appErrorBoundaryCopy", () => {
  it("maps ValidationError production message to actionable Arabic", () => {
    expect(appErrorBoundaryCopy({ message: "Validation failed" }).title).toContain("تعذر إتمام");
  });

  it("keeps generic copy for unknown errors", () => {
    expect(appErrorBoundaryCopy({ message: "boom" }).title).toContain("تعذّر تحميل");
  });
});

describe("formActionFailure", () => {
  it("returns validation Arabic", () => {
    const state = formActionFailure(new ValidationError("تحقق من البيانات المدخلة.", "check"), "fallback");
    expect(state?.ok).toBe(false);
    expect(state?.message).toBe("تحقق من البيانات المدخلة.");
  });

  it("maps forbidden", () => {
    expect(formActionFailure(new ForbiddenError(), "fallback")?.message).toBe(
      "ليس لديك صلاحية لتنفيذ هذه العملية.",
    );
  });

  it("maps unauthorized", () => {
    expect(formActionFailure(new UnauthorizedError(), "fallback")?.ok).toBe(false);
    expect(formActionFailure(new UnauthorizedError(), "fallback")?.message).toContain("تسجيل الدخول");
  });

  it("maps conflict and not found", () => {
    expect(formActionFailure(new ConflictError("تعارض.", "conflict"), "fallback")?.message).toBe("تعارض.");
    expect(formActionFailure(new NotFoundError("السجل", "Record"), "fallback")?.ok).toBe(false);
  });

  it("maps 23505 uniquely", () => {
    const err = new DatabaseError({ code: "23505", message: "duplicate key" });
    expect(formActionFailure(err, "fallback")?.message).toBe("هذه البيانات مستخدمة مسبقاً.");
  });

  it("maps 23503 uniquely", () => {
    const err = new DatabaseError({ code: "23503", message: "fk" });
    expect(formActionFailure(err, "fallback")?.message).toContain("ارتباطها");
  });

  it("maps 23P01 exclusion", () => {
    const err = new DatabaseError({ code: "23P01", message: "exclusion" });
    expect(formActionFailure(err, "fallback")?.message).toContain("تعارض");
  });

  it("maps 57014 timeout", () => {
    const err = new DatabaseError({ code: "57014", message: "timeout" });
    expect(formActionFailure(err, "fallback")?.message).toContain("أطول من المتوقع");
  });

  it("logs unexpected as generic fallback without fake success", () => {
    const state = formActionFailure(new Error("boom"), "تعذر إتمام العملية.");
    expect(state?.ok).toBe(false);
    expect(state?.message).toBe("تعذر إتمام العملية.");
  });
});

describe("runFormAction", () => {
  it("rethrows Next.js redirect interrupts", async () => {
    const err = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/x" });
    await expect(
      runFormAction("fallback", async () => {
        throw err;
      }),
    ).rejects.toBe(err);
  });
});

describe("GPS punch rejection copy", () => {
  it("maps RPC rejection codes without implying a punch was created", () => {
    const parsed = parseAttendancePunchRpc({
      accepted: false,
      reason_code: "GEOFENCE_OUTSIDE",
      workplace_id: null,
      distance_meters: 400,
    });
    expect(parsed?.accepted).toBe(false);
    expect(geofenceUserMessage(parsed!.reason_code).ar).toBe("أنت خارج النطاق المسموح للحضور.");
    expect(geofenceUserMessage("GEOFENCE_NO_WORKPLACE").ar).toContain("لا يوجد موقع حضور مخصص");
    expect(geofenceUserMessage("GEOFENCE_INACTIVE_WORKPLACE").ar).toContain("غير نشط");
    expect(geofenceUserMessage("GEOFENCE_POOR_ACCURACY").ar).toContain("دقة تحديد الموقع غير كافية");
    expect(geofenceUserMessage("GEOFENCE_INVALID_LOCATION").ar).toContain("تعذر التحقق من موقعك");
  });
});

describe("overlapping workplace assignment", () => {
  it("rejects overlap as a recoverable validation condition", () => {
    const existing = [
      { workplaceId: "w1", effectiveFrom: "2026-01-01", effectiveTo: null as string | null },
    ];
    expect(
      canAddWorkplaceAssignment(existing, {
        workplaceId: "w1",
        effectiveFrom: "2026-02-01",
        effectiveTo: null,
      }).ok,
    ).toBe(false);
    const err = new ValidationError(
      "يوجد تعيين متداخل لنفس الموقع.",
      "Overlapping workplace assignment.",
    );
    expect(formActionFailure(err, "fallback")?.ok).toBe(false);
    expect(formActionFailure(err, "fallback")?.message).toContain("متداخل");
  });
});
