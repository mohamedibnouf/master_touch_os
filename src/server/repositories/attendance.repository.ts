import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseError } from "@/lib/errors";
import type {
  AttendanceAdjustment,
  AttendancePolicy,
  AttendanceRecord,
  AttendanceShift,
  EmployeeShiftAssignment,
} from "@/types/models";

function fail(error: { message?: string } | null): never {
  throw new DatabaseError(error);
}

export class AttendanceRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listPolicies(organizationId: string, activeOnly = false): Promise<AttendancePolicy[]> {
    let q = this.supabase
      .from("attendance_policies")
      .select("*")
      .eq("organization_id", organizationId)
      .order("name_ar");
    if (activeOnly) q = q.eq("is_active", true);
    const { data, error } = await q;
    if (error) fail(error);
    return (data ?? []) as AttendancePolicy[];
  }

  async listShifts(organizationId: string, activeOnly = false): Promise<AttendanceShift[]> {
    let q = this.supabase
      .from("attendance_shifts")
      .select("*")
      .eq("organization_id", organizationId)
      .order("name_ar");
    if (activeOnly) q = q.eq("is_active", true);
    const { data, error } = await q;
    if (error) fail(error);
    return (data ?? []) as AttendanceShift[];
  }

  async listAssignments(organizationId: string, employeeId?: string): Promise<EmployeeShiftAssignment[]> {
    let q = this.supabase
      .from("employee_shift_assignments")
      .select("*")
      .eq("organization_id", organizationId)
      .order("effective_from", { ascending: false })
      .limit(300);
    if (employeeId) q = q.eq("employee_id", employeeId);
    const { data, error } = await q;
    if (error) fail(error);
    return (data ?? []) as EmployeeShiftAssignment[];
  }

  async getActiveAssignment(
    organizationId: string,
    employeeId: string,
    onDate: string,
  ): Promise<EmployeeShiftAssignment | null> {
    const { data, error } = await this.supabase
      .from("employee_shift_assignments")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("employee_id", employeeId)
      .lte("effective_from", onDate)
      .or(`effective_to.is.null,effective_to.gte.${onDate}`)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) fail(error);
    return (data as EmployeeShiftAssignment | null) ?? null;
  }

  async getShift(organizationId: string, id: string): Promise<AttendanceShift | null> {
    const { data, error } = await this.supabase
      .from("attendance_shifts")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("id", id)
      .maybeSingle();
    if (error) fail(error);
    return (data as AttendanceShift | null) ?? null;
  }

  async getRecordForDate(
    organizationId: string,
    employeeId: string,
    attendanceDate: string,
  ): Promise<AttendanceRecord | null> {
    const { data, error } = await this.supabase
      .from("attendance_records")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("employee_id", employeeId)
      .eq("attendance_date", attendanceDate)
      .maybeSingle();
    if (error) fail(error);
    return (data as AttendanceRecord | null) ?? null;
  }

  async listRecordsForEmployee(
    organizationId: string,
    employeeId: string,
    opts?: { from?: string; to?: string; limit?: number },
  ): Promise<AttendanceRecord[]> {
    let q = this.supabase
      .from("attendance_records")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("employee_id", employeeId)
      .order("attendance_date", { ascending: false })
      .limit(opts?.limit ?? 60);
    if (opts?.from) q = q.gte("attendance_date", opts.from);
    if (opts?.to) q = q.lte("attendance_date", opts.to);
    const { data, error } = await q;
    if (error) fail(error);
    return (data ?? []) as AttendanceRecord[];
  }

  async listRecordsForDate(
    organizationId: string,
    attendanceDate: string,
    status?: string,
  ): Promise<AttendanceRecord[]> {
    let q = this.supabase
      .from("attendance_records")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("attendance_date", attendanceDate)
      .order("employee_id")
      .limit(500);
    if (status) q = q.eq("attendance_status", status);
    const { data, error } = await q;
    if (error) fail(error);
    return (data ?? []) as AttendanceRecord[];
  }

  async listTeamRecords(
    organizationId: string,
    from: string,
    to: string,
  ): Promise<AttendanceRecord[]> {
    const { data, error } = await this.supabase
      .from("attendance_records")
      .select("*")
      .eq("organization_id", organizationId)
      .gte("attendance_date", from)
      .lte("attendance_date", to)
      .order("attendance_date", { ascending: false })
      .limit(300);
    if (error) fail(error);
    return (data ?? []) as AttendanceRecord[];
  }

  async listAdjustments(organizationId: string, limit = 100): Promise<AttendanceAdjustment[]> {
    const { data, error } = await this.supabase
      .from("attendance_adjustments")
      .select("*")
      .eq("organization_id", organizationId)
      .order("adjusted_at", { ascending: false })
      .limit(limit);
    if (error) fail(error);
    return (data ?? []) as AttendanceAdjustment[];
  }

  async getRecord(organizationId: string, id: string): Promise<AttendanceRecord | null> {
    const { data, error } = await this.supabase
      .from("attendance_records")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("id", id)
      .maybeSingle();
    if (error) fail(error);
    return (data as AttendanceRecord | null) ?? null;
  }

  async geofenceSchemaReady(): Promise<boolean> {
    const dir = await this.supabase.from("workplace_locations_directory").select("id").limit(1);
    if (!dir.error) return true;
    const { error } = await this.supabase.from("workplace_locations").select("id").limit(1);
    return !error;
  }

  async listWorkplaceDirectory(
    organizationId: string,
  ): Promise<Array<Omit<import("@/types/models").WorkplaceLocation, "latitude" | "longitude">>> {
    const { data, error } = await this.supabase
      .from("workplace_locations_directory")
      .select(
        "id, organization_id, name, code, address, allowed_radius_meters, max_accuracy_meters, timezone, is_active, is_primary, created_at, updated_at",
      )
      .eq("organization_id", organizationId)
      .order("name");
    if (error) fail(error);
    return (data ?? []) as Array<Omit<import("@/types/models").WorkplaceLocation, "latitude" | "longitude">>;
  }

  async listWorkplaces(organizationId: string): Promise<import("@/types/models").WorkplaceLocation[]> {
    const { data, error } = await this.supabase
      .from("workplace_locations")
      .select(
        "id, organization_id, name, code, address, latitude, longitude, allowed_radius_meters, max_accuracy_meters, timezone, is_active, is_primary, created_at, updated_at",
      )
      .eq("organization_id", organizationId)
      .order("name");
    if (error) fail(error);
    return (data ?? []) as import("@/types/models").WorkplaceLocation[];
  }

  async resolveWorkplaceForEmployee(
    organizationId: string,
    employeeId: string,
    onDate: string,
  ): Promise<Omit<import("@/types/models").WorkplaceLocation, "latitude" | "longitude"> | null> {
    const { data: asg } = await this.supabase
      .from("employee_workplace_assignments")
      .select("workplace_location_id")
      .eq("organization_id", organizationId)
      .eq("employee_id", employeeId)
      .lte("effective_from", onDate)
      .or(`effective_to.is.null,effective_to.gte.${onDate}`)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    const workplaceId = (asg as { workplace_location_id?: string } | null)?.workplace_location_id;
    let q = this.supabase
      .from("workplace_locations_directory")
      .select(
        "id, organization_id, name, code, address, allowed_radius_meters, max_accuracy_meters, timezone, is_active, is_primary, created_at, updated_at",
      )
      .eq("organization_id", organizationId);
    if (workplaceId) q = q.eq("id", workplaceId);
    else q = q.eq("is_primary", true);
    const { data, error } = await q.maybeSingle();
    if (error) fail(error);
    return (data as Omit<import("@/types/models").WorkplaceLocation, "latitude" | "longitude"> | null) ?? null;
  }

  async listLocationAttempts(
    organizationId: string,
    opts?: { includeCoordinates?: boolean; limit?: number },
  ): Promise<import("@/types/models").AttendanceLocationAttempt[]> {
    const columns = opts?.includeCoordinates
      ? "id, organization_id, employee_id, workplace_location_id, action, result, latitude, longitude, accuracy_meters, distance_meters, reason_code, created_at"
      : "id, organization_id, employee_id, workplace_location_id, action, result, accuracy_meters, distance_meters, reason_code, created_at";
    const { data, error } = await this.supabase
      .from("attendance_location_attempts")
      .select(columns)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(opts?.limit ?? 100);
    if (error) fail(error);
    return (data ?? []) as unknown as import("@/types/models").AttendanceLocationAttempt[];
  }
}
