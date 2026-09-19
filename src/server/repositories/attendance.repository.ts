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
}
