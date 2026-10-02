import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseError } from "@/lib/errors";
import type { JobTitleRecord } from "@/lib/hr/job-titles";
import { logger } from "@/lib/logger";

export const JOB_TITLE_LIST_COLUMNS =
  "id, organization_id, department_id, code, name_ar, name_en, is_active, sort_order, created_at, updated_at" as const;

function fail(error: { message?: string; code?: string } | null): never {
  logger.error("job titles query failed", { code: error?.code ?? null });
  throw new DatabaseError(error);
}

export class JobTitleRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listByOrganization(organizationId: string, options?: { activeOnly?: boolean }): Promise<JobTitleRecord[]> {
    let query = this.supabase
      .from("job_titles")
      .select(JOB_TITLE_LIST_COLUMNS)
      .eq("organization_id", organizationId)
      .order("sort_order", { ascending: true })
      .order("name_ar", { ascending: true });
    if (options?.activeOnly) {
      query = query.eq("is_active", true);
    }
    const { data, error } = await query;
    if (error) fail(error);
    return (data ?? []) as JobTitleRecord[];
  }

  async getById(organizationId: string, titleId: string): Promise<JobTitleRecord | null> {
    const { data, error } = await this.supabase
      .from("job_titles")
      .select(JOB_TITLE_LIST_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("id", titleId)
      .maybeSingle();
    if (error) fail(error);
    return (data as JobTitleRecord | null) ?? null;
  }

  async countUsageByTitle(organizationId: string): Promise<Map<string, number>> {
    const { data, error } = await this.supabase
      .from("employees")
      .select("job_title_id")
      .eq("organization_id", organizationId)
      .not("job_title_id", "is", null);
    if (error) fail(error);
    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      const id = (row as { job_title_id: string | null }).job_title_id;
      if (!id) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }

  async countUsageByDepartment(organizationId: string): Promise<Map<string, number>> {
    const { data, error } = await this.supabase
      .from("job_titles")
      .select("department_id")
      .eq("organization_id", organizationId)
      .not("department_id", "is", null);
    if (error) fail(error);
    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      const id = (row as { department_id: string | null }).department_id;
      if (!id) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }

  async insert(row: {
    organization_id: string;
    department_id: string | null;
    code: string | null;
    name_ar: string;
    name_en: string;
    sort_order: number;
    created_by: string | null;
  }): Promise<JobTitleRecord> {
    const { data, error } = await this.supabase
      .from("job_titles")
      .insert({ ...row, is_active: true })
      .select(JOB_TITLE_LIST_COLUMNS)
      .single();
    if (error) fail(error);
    return data as JobTitleRecord;
  }

  async update(
    organizationId: string,
    titleId: string,
    patch: {
      department_id?: string | null;
      code?: string | null;
      name_ar?: string;
      name_en?: string;
      sort_order?: number;
      is_active?: boolean;
    },
  ): Promise<JobTitleRecord> {
    const { data, error } = await this.supabase
      .from("job_titles")
      .update(patch)
      .eq("organization_id", organizationId)
      .eq("id", titleId)
      .select(JOB_TITLE_LIST_COLUMNS)
      .single();
    if (error) fail(error);
    return data as JobTitleRecord;
  }
}
