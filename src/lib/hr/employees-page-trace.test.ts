import { describe, expect, it } from "vitest";
import { DatabaseError } from "@/lib/errors";
import { employeesPageFailureContext } from "./employees-page-trace";

describe("GET /employees failure instrumentation", () => {
  it("logs only route, operation, error class, and PostgREST/SQLSTATE code", () => {
    const ctx = employeesPageFailureContext("listEmployees.employees", {
      code: "57014",
      message: "canceling statement due to statement timeout",
      details: "employee_number=E-1 full_name_ar=secret",
    });
    expect(ctx).toEqual({
      route: "/employees",
      operation: "listEmployees.employees",
      errorClass: "unknown",
      code: "57014",
    });
    expect(JSON.stringify(ctx)).not.toMatch(/password|token|secret|E-1|full_name/i);
  });

  it("extracts PGRST codes from DatabaseError.causeError, not AppError DATABASE", () => {
    const err = new DatabaseError({ code: "PGRST204", message: "column not found" });
    const ctx = employeesPageFailureContext("listEmployees.employees", err);
    expect(ctx.errorClass).toBe("DatabaseError");
    expect(ctx.code).toBe("PGRST204");
  });

  it("does not treat AppError DATABASE as a PostgREST code", () => {
    const err = new DatabaseError({ message: "no code" });
    const ctx = employeesPageFailureContext("listRoles", err);
    expect(ctx.code).toBeNull();
  });
});
