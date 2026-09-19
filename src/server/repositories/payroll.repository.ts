import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseError } from "@/lib/errors";
import type {
  PayrollDeduction,
  PayrollEarning,
  PayrollEntry,
  PayrollEntrySegment,
  PayrollPayment,
  PayrollPeriod,
  PayrollSettings,
} from "@/types/models";

function fail(error: { message?: string } | null): never {
  throw new DatabaseError(error);
}

export class PayrollRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async getSettings(organizationId: string): Promise<PayrollSettings | null> {
    const { data, error } = await this.supabase
      .from("payroll_settings")
      .select("*")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) fail(error);
    return (data as PayrollSettings | null) ?? null;
  }

  async listPeriods(organizationId: string, limit = 36): Promise<PayrollPeriod[]> {
    const { data, error } = await this.supabase
      .from("payroll_periods")
      .select("*")
      .eq("organization_id", organizationId)
      .order("year", { ascending: false })
      .order("month", { ascending: false })
      .limit(limit);
    if (error) fail(error);
    return (data ?? []) as PayrollPeriod[];
  }

  async getPeriod(organizationId: string, periodId: string): Promise<PayrollPeriod | null> {
    const { data, error } = await this.supabase
      .from("payroll_periods")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("id", periodId)
      .maybeSingle();
    if (error) fail(error);
    return (data as PayrollPeriod | null) ?? null;
  }

  async listEntries(periodId: string): Promise<PayrollEntry[]> {
    const { data, error } = await this.supabase
      .from("payroll_entries")
      .select("*")
      .eq("payroll_period_id", periodId)
      .order("employee_number");
    if (error) fail(error);
    return (data ?? []) as PayrollEntry[];
  }

  async getEntry(entryId: string): Promise<PayrollEntry | null> {
    const { data, error } = await this.supabase
      .from("payroll_entries")
      .select("*")
      .eq("id", entryId)
      .maybeSingle();
    if (error) fail(error);
    return (data as PayrollEntry | null) ?? null;
  }

  async listMyEntries(employeeId: string): Promise<PayrollEntry[]> {
    const { data, error } = await this.supabase
      .from("payroll_entries")
      .select("*")
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false })
      .limit(48);
    if (error) fail(error);
    return (data ?? []) as PayrollEntry[];
  }

  async listSegments(entryId: string): Promise<PayrollEntrySegment[]> {
    const { data, error } = await this.supabase
      .from("payroll_entry_segments")
      .select("*")
      .eq("payroll_entry_id", entryId)
      .order("segment_start");
    if (error) fail(error);
    return (data ?? []) as PayrollEntrySegment[];
  }

  async listEarnings(entryId: string): Promise<PayrollEarning[]> {
    const { data, error } = await this.supabase
      .from("payroll_earnings")
      .select("*")
      .eq("payroll_entry_id", entryId)
      .order("created_at");
    if (error) fail(error);
    return (data ?? []) as PayrollEarning[];
  }

  async listDeductions(entryId: string): Promise<PayrollDeduction[]> {
    const { data, error } = await this.supabase
      .from("payroll_deductions")
      .select("*")
      .eq("payroll_entry_id", entryId)
      .order("created_at");
    if (error) fail(error);
    return (data ?? []) as PayrollDeduction[];
  }

  async listPaymentsForPeriod(periodId: string): Promise<PayrollPayment[]> {
    const { data, error } = await this.supabase
      .from("payroll_payments")
      .select("*")
      .eq("payroll_period_id", periodId)
      .order("created_at", { ascending: false });
    if (error) fail(error);
    return (data ?? []) as PayrollPayment[];
  }
}
