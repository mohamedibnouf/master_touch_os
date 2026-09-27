import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseError } from "@/lib/errors";
import type { EmployeeLeaveBalance, LeaveRequest, LeaveType } from "@/types/models";
import { LEAVE_BALANCE_LIST_COLUMNS, LEAVE_REQUEST_LIST_COLUMNS } from "@/lib/query-projections";

function fail(error: { message?: string } | null): never {
  throw new DatabaseError(error);
}

export class LeaveRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listLeaveTypes(organizationId: string, activeOnly = false): Promise<LeaveType[]> {
    let q = this.supabase
      .from("leave_types")
      .select("*")
      .eq("organization_id", organizationId)
      .order("name_ar");
    if (activeOnly) q = q.eq("is_active", true);
    const { data, error } = await q;
    if (error) fail(error);
    return (data ?? []) as LeaveType[];
  }

  async listBalances(organizationId: string, employeeId: string, year?: number): Promise<EmployeeLeaveBalance[]> {
    let q = this.supabase
      .from("employee_leave_balances")
      .select(LEAVE_BALANCE_LIST_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("employee_id", employeeId)
      .order("year", { ascending: false });
    if (year) q = q.eq("year", year);
    const { data, error } = await q;
    if (error) fail(error);
    return (data ?? []) as EmployeeLeaveBalance[];
  }

  async listOrgBalances(organizationId: string, year: number): Promise<EmployeeLeaveBalance[]> {
    const { data, error } = await this.supabase
      .from("employee_leave_balances")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("year", year)
      .order("employee_id")
      .limit(500);
    if (error) fail(error);
    return (data ?? []) as EmployeeLeaveBalance[];
  }

  async listRequestsForEmployee(organizationId: string, employeeId: string): Promise<LeaveRequest[]> {
    const { data, error } = await this.supabase
      .from("leave_requests")
      .select(LEAVE_REQUEST_LIST_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) fail(error);
    return (data ?? []) as LeaveRequest[];
  }

  async listTeamPending(organizationId: string): Promise<LeaveRequest[]> {
    const { data, error } = await this.supabase
      .from("leave_requests")
      .select(LEAVE_REQUEST_LIST_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("status", "submitted")
      .eq("approval_stage", "manager")
      .order("submitted_at", { ascending: true })
      .limit(100);
    if (error) fail(error);
    return (data ?? []) as LeaveRequest[];
  }

  async listHrPending(organizationId: string): Promise<LeaveRequest[]> {
    const { data, error } = await this.supabase
      .from("leave_requests")
      .select(LEAVE_REQUEST_LIST_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("status", "submitted")
      .eq("approval_stage", "hr")
      .order("submitted_at", { ascending: true })
      .limit(100);
    if (error) fail(error);
    return (data ?? []) as LeaveRequest[];
  }

  async listCalendar(
    organizationId: string,
    from: string,
    to: string,
  ): Promise<Array<Pick<LeaveRequest, "id" | "employee_id" | "leave_type_id" | "start_date" | "end_date" | "status">>> {
    const { data, error } = await this.supabase
      .from("leave_requests")
      .select("id, employee_id, leave_type_id, start_date, end_date, status")
      .eq("organization_id", organizationId)
      .in("status", ["submitted", "approved"])
      .lte("start_date", to)
      .gte("end_date", from)
      .order("start_date")
      .limit(300);
    if (error) fail(error);
    return (data ?? []) as Array<
      Pick<LeaveRequest, "id" | "employee_id" | "leave_type_id" | "start_date" | "end_date" | "status">
    >;
  }

  async getRequest(organizationId: string, id: string): Promise<LeaveRequest | null> {
    const { data, error } = await this.supabase
      .from("leave_requests")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("id", id)
      .maybeSingle();
    if (error) fail(error);
    return (data as LeaveRequest | null) ?? null;
  }
}
