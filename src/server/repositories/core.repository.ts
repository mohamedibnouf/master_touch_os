import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseError } from "@/lib/errors";
import type {
  AuditLogRecord,
  DashboardStats,
  Department,
  DocumentRecord,
  Employee,
  EmployeeBankAccount,
  EmployeeCompensationVersion,
  EmployeeContract,
  EmployeeDocument,
  NotificationRecord,
  PendingAction,
  Profile,
  Project,
  ProjectStage,
} from "@/types/models";
import { EMPLOYEE_DETAIL_COLUMNS } from "@/lib/hr/labels";
import { attachProfilesById } from "@/lib/hr/directory-page";
import { failEmployeesQuery } from "@/lib/hr/employees-page-trace";
import { logger } from "@/lib/logger";
import {
  AUDIT_FEED_COLUMNS,
  DEPARTMENT_LIST_COLUMNS,
  DOCUMENT_LIST_COLUMNS,
  DOCUMENT_CURRENT_VERSION_COLUMNS,
  EMPLOYEE_DIRECTORY_PAGE_COLUMNS,
  EMPLOYEE_DIRECTORY_PROFILE_COLUMNS,
  NOTIFICATION_HEADER_COLUMNS,
  NOTIFICATION_LIST_COLUMNS,
  PROJECT_LIST_COLUMNS,
  PROJECT_PICKER_COLUMNS,
  PROJECT_MEMBER_COLUMNS,
  ROLE_LIST_COLUMNS,
  APPROVAL_LIST_SELECT,
} from "@/lib/query-projections";
import { notificationEntityHref } from "@/lib/notifications/href";

function fail(error: { message?: string; code?: string } | null): never {
  logger.error("supabase query failed", { code: error?.code ?? null });
  throw new DatabaseError(error);
}

export class CoreRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listDepartments(organizationId: string): Promise<Department[]> {
    const { data, error } = await this.supabase
      .from("departments")
      .select(DEPARTMENT_LIST_COLUMNS)
      .eq("organization_id", organizationId)
      .order("name_ar");
    if (error) fail(error);
    return (data ?? []) as Department[];
  }

  async listEmployees(organizationId: string): Promise<Array<Employee & { profiles: Profile | null }>> {
    const { data, error } = await this.supabase
      .from("employees")
      .select(EMPLOYEE_DIRECTORY_PAGE_COLUMNS)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) failEmployeesQuery("listEmployees.employees", error);

    const rows = (data ?? []) as Array<Employee & { profile_id: string }>;
    const profileIds = [...new Set(rows.map((row) => row.profile_id).filter(Boolean))];
    if (profileIds.length === 0) {
      return rows.map((row) => ({ ...row, profiles: null }));
    }

    const { data: profiles, error: profileError } = await this.supabase
      .from("profiles")
      .select(EMPLOYEE_DIRECTORY_PROFILE_COLUMNS)
      .in("id", profileIds);
    if (profileError) failEmployeesQuery("listEmployees.profiles", profileError);

    return attachProfilesById(rows, profiles ?? []) as Array<Employee & { profiles: Profile | null }>;
  }

  /** Name picker only — avoids the heavy directory embed that can hit statement timeout (57014). */
  async listEmployeeNameOptions(
    organizationId: string,
  ): Promise<Array<{ id: string; profile_id: string; employee_number: string | null; profiles: { full_name_ar: string | null } | null }>> {
    const { data, error } = await this.supabase
      .from("employees")
      .select("id, profile_id, employee_number, profiles(full_name_ar)")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) fail(error);
    return (data ?? []) as unknown as Array<{
      id: string;
      profile_id: string;
      employee_number: string | null;
      profiles: { full_name_ar: string | null } | null;
    }>;
  }

  async getEmployeeDirectoryRow(organizationId: string, employeeId: string) {
    const { data, error } = await this.supabase
      .from("employees")
      .select(
        `${EMPLOYEE_DETAIL_COLUMNS}, profiles(id, full_name_ar, full_name_en, phone, locale, is_active, avatar_path, last_seen_at, created_at, updated_at), employee_departments(id, is_primary, department_id, departments(id, code, name_ar, name_en, is_active))`,
      )
      .eq("organization_id", organizationId)
      .eq("id", employeeId)
      .maybeSingle();
    if (error) fail(error);
    return data;
  }

  async getEmployee(organizationId: string, employeeId: string) {
    return this.getEmployeeDirectoryRow(organizationId, employeeId);
  }

  async getEmployeeCompliance(organizationId: string, employeeId: string) {
    const { data, error } = await this.supabase
      .from("employee_compliance")
      .select(
        "id, organization_id, employee_id, iqama_number, iqama_expiry, passport_number, passport_expiry, work_permit_expiry, insurance_provider, insurance_expiry, gosi_number, created_at, updated_at",
      )
      .eq("organization_id", organizationId)
      .eq("employee_id", employeeId)
      .maybeSingle();
    if (error) fail(error);
    return data;
  }

  async listEmployeeProjects(organizationId: string, profileId: string) {
    const { data, error } = await this.supabase
      .from("project_members")
      .select("id, role_label, is_active, assigned_at, unassigned_at, projects(id, project_code, name_ar, name_en, status)")
      .eq("organization_id", organizationId)
      .eq("profile_id", profileId)
      .eq("is_active", true)
      .order("assigned_at", { ascending: false });
    if (error) fail(error);
    return data ?? [];
  }

  async listEmployeeAudit(organizationId: string, employeeId: string, limit = 30) {
    const { data, error } = await this.supabase
      .from("audit_logs")
      .select("id, action, entity_type, entity_id, created_at, actor_id")
      .eq("organization_id", organizationId)
      .eq("entity_type", "employee")
      .eq("entity_id", employeeId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) fail(error);
    return data ?? [];
  }

  async listEmployeeContracts(organizationId: string, employeeId: string): Promise<EmployeeContract[]> {
    const { data, error } = await this.supabase
      .from("employee_contracts")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false });
    if (error) fail(error);
    return (data ?? []) as EmployeeContract[];
  }

  async getCurrentEmployeeContract(organizationId: string, employeeId: string): Promise<EmployeeContract | null> {
    const { data, error } = await this.supabase
      .from("employee_contracts")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("employee_id", employeeId)
      .eq("is_current", true)
      .maybeSingle();
    if (error) fail(error);
    return data as EmployeeContract | null;
  }

  async listEmployeeCompensationVersions(organizationId: string, employeeId: string): Promise<EmployeeCompensationVersion[]> {
    const { data, error } = await this.supabase
      .from("employee_compensation_versions")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("employee_id", employeeId)
      .order("effective_from", { ascending: false });
    if (error) fail(error);
    return (data ?? []) as EmployeeCompensationVersion[];
  }

  async getCurrentEmployeeCompensation(organizationId: string, employeeId: string): Promise<EmployeeCompensationVersion | null> {
    const { data, error } = await this.supabase
      .from("employee_compensation_versions")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("employee_id", employeeId)
      .eq("status", "active")
      .is("effective_to", null)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) fail(error);
    return data as EmployeeCompensationVersion | null;
  }

  async listEmployeeDocuments(organizationId: string, employeeId: string): Promise<EmployeeDocument[]> {
    const { data, error } = await this.supabase
      .from("employee_documents")
      .select("*, documents(*, document_versions(*))")
      .eq("organization_id", organizationId)
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false });
    if (error) fail(error);
    return (data ?? []) as unknown as EmployeeDocument[];
  }

  async listEmployeeBankAccounts(organizationId: string, employeeId: string): Promise<EmployeeBankAccount[]> {
    const { data, error } = await this.supabase.rpc("get_employee_banking", {
      p_employee_id: employeeId,
    });
    if (error) fail(error);
    return (data ?? []) as EmployeeBankAccount[];
  }

  /** Extra employees COUNT scans — do not call from GET /employees (RLS pressure). */
  async employeeDirectoryStats(organizationId: string) {
    const base = () =>
      this.supabase.from("employees").select("id", { count: "exact", head: true }).eq("organization_id", organizationId);
    const [totalRes, activeRes, probationRes] = await Promise.all([
      base(),
      base().eq("is_active", true),
      base().eq("employment_status", "probation"),
    ]);
    if (totalRes.error) fail(totalRes.error);
    if (activeRes.error) fail(activeRes.error);
    if (probationRes.error) fail(probationRes.error);
    return {
      total: totalRes.count ?? 0,
      active: activeRes.count ?? 0,
      probation: probationRes.count ?? 0,
    };
  }

  async listProjects(input: {
    organizationId: string;
    search?: string;
    status?: string;
    risk?: string;
    managerId?: string;
    page: number;
    pageSize: number;
  }): Promise<{ rows: Project[]; total: number }> {
    let query = this.supabase
      .from("projects")
      .select(PROJECT_LIST_COLUMNS, { count: "exact" })
      .eq("organization_id", input.organizationId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .range((input.page - 1) * input.pageSize, input.page * input.pageSize - 1);

    if (input.search) {
      query = query.or(`name_ar.ilike.%${input.search}%,name_en.ilike.%${input.search}%,project_code.ilike.%${input.search}%`);
    }
    if (input.status) {
      query = query.eq("status", input.status);
    }
    if (input.risk) {
      query = query.eq("risk_level", input.risk);
    }
    if (input.managerId) {
      query = query.eq("project_manager_id", input.managerId);
    }

    const { data, error, count } = await query;
    if (error) fail(error);
    return { rows: (data ?? []) as Project[], total: count ?? 0 };
  }

  async getProject(organizationId: string, projectId: string): Promise<Project | null> {
    const { data, error } = await this.supabase
      .from("projects")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("id", projectId)
      .maybeSingle<Project>();
    if (error) fail(error);
    return data;
  }

  async listProjectStages(projectId: string): Promise<ProjectStage[]> {
    const { data, error } = await this.supabase
      .from("project_stages")
      .select("*")
      .eq("project_id", projectId)
      .order("sequence");
    if (error) fail(error);
    return (data ?? []) as ProjectStage[];
  }

  async listProjectMembers(projectId: string) {
    const { data, error } = await this.supabase
      .from("project_members")
      .select(PROJECT_MEMBER_COLUMNS)
      .eq("project_id", projectId)
      .eq("is_active", true);
    if (error) fail(error);
    return data ?? [];
  }

  async listDocuments(
    organizationId: string,
    projectId?: string,
    options?: { archived?: boolean },
  ): Promise<DocumentRecord[]> {
    let query = this.supabase
      .from("documents")
      .select(DOCUMENT_LIST_COLUMNS)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (projectId) {
      query = query.eq("project_id", projectId);
    }
    if (options?.archived) {
      query = query.not("archived_at", "is", null);
    } else {
      query = query.is("archived_at", null);
    }
    const { data, error } = await query;
    if (error) fail(error);
    return (data ?? []) as DocumentRecord[];
  }

  async listCurrentDocumentFiles(
    organizationId: string,
    documentIds: string[],
  ): Promise<
    Array<{
      document_id: string;
      file_source: string | null;
      external_url: string | null;
      file_path: string | null;
      is_current: boolean;
    }>
  > {
    if (documentIds.length === 0) return [];
    const { data, error } = await this.supabase
      .from("document_versions")
      .select(DOCUMENT_CURRENT_VERSION_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("is_current", true)
      .in("document_id", documentIds);
    if (error) fail(error);
    return (data ?? []) as Array<{
      document_id: string;
      file_source: string | null;
      external_url: string | null;
      file_path: string | null;
      is_current: boolean;
    }>;
  }

  async listDocumentVersions(documentId: string) {
    const { data, error } = await this.supabase
      .from("document_versions")
      .select("*")
      .eq("document_id", documentId)
      .order("uploaded_at", { ascending: false });
    if (error) fail(error);
    return data ?? [];
  }

  async listApprovals(organizationId: string) {
    const { data, error } = await this.supabase
      .from("approval_requests")
      .select(APPROVAL_LIST_SELECT)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) fail(error);
    return data ?? [];
  }

  async listNotifications(profileId: string, limit = 50): Promise<NotificationRecord[]> {
    const { data, error } = await this.supabase
      .from("notifications")
      .select(NOTIFICATION_LIST_COLUMNS)
      .eq("recipient_profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) fail(error);
    return (data ?? []) as NotificationRecord[];
  }

  async listHeaderNotifications(profileId: string): Promise<{
    unreadCount: number;
    notices: Array<{
      id: string;
      title: string;
      created_at: string;
      read_at: string | null;
      href: string | null;
    }>;
  }> {
    const [unread, recent] = await Promise.all([
      this.supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_profile_id", profileId)
        .is("read_at", null),
      this.supabase
        .from("notifications")
        .select(NOTIFICATION_HEADER_COLUMNS)
        .eq("recipient_profile_id", profileId)
        .order("created_at", { ascending: false })
        .limit(6),
    ]);
    if (unread.error) fail(unread.error);
    if (recent.error) fail(recent.error);
    return {
      unreadCount: unread.count ?? 0,
      notices: (recent.data ?? []).map((n) => ({
        id: n.id as string,
        title: n.title as string,
        created_at: n.created_at as string,
        read_at: (n.read_at as string | null) ?? null,
        href: notificationEntityHref(n.entity_type as string | null, n.entity_id as string | null),
      })),
    };
  }

  async listProjectPicker(organizationId: string) {
    const { data, error } = await this.supabase
      .from("projects")
      .select(PROJECT_PICKER_COLUMNS)
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) fail(error);
    return (data ?? []) as Array<{ id: string; project_code: string; name_ar: string }>;
  }

  async listAudit(organizationId: string, limit = 20): Promise<AuditLogRecord[]> {
    const { data, error } = await this.supabase
      .from("audit_logs")
      .select(AUDIT_FEED_COLUMNS)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) fail(error);
    return (data ?? []) as AuditLogRecord[];
  }

  async listUsers(organizationId: string) {
    // No FK exists between organization_members and employees (both point at profiles).
    // PostgREST cannot embed employees(*) from organization_members (PGRST200).
    const { data: members, error } = await this.supabase
      .from("organization_members")
      .select("profile_id, status, profiles(id, full_name_ar, full_name_en, is_active)")
      .eq("organization_id", organizationId)
      .order("joined_at", { ascending: false })
      .limit(100);
    if (error) fail(error);
    if (!members?.length) return [];

    const profileIds = members.map((m) => m.profile_id as string);
    const { data: employees, error: empError } = await this.supabase
      .from("employees")
      .select("id, profile_id, job_title_ar, job_title_en, employment_status, is_active")
      .eq("organization_id", organizationId)
      .in("profile_id", profileIds);
    if (empError) fail(empError);

    const employeesByProfile = new Map<string, NonNullable<typeof employees>>();
    for (const emp of employees ?? []) {
      const key = emp.profile_id as string;
      const list = employeesByProfile.get(key) ?? [];
      list.push(emp);
      employeesByProfile.set(key, list);
    }

    return members.map((member) => ({
      ...member,
      employees: employeesByProfile.get(member.profile_id as string) ?? [],
    }));
  }

  async listRoles() {
    const { data, error } = await this.supabase
      .from("roles")
      .select(ROLE_LIST_COLUMNS)
      .eq("is_system", true)
      .order("name_ar");
    if (error) fail(error);
    return data ?? [];
  }

  async dashboard(
    organizationId: string,
    profileId: string,
    options?: { includeOrgStats?: boolean; includeAudit?: boolean },
  ): Promise<{
    stats: DashboardStats;
    pendingActions: PendingAction[];
    recentActivity: AuditLogRecord[];
  }> {
    const now = new Date().toISOString();
    const includeOrgStats = options?.includeOrgStats === true;
    const includeAudit = options?.includeAudit === true;
    const skipCount = Promise.resolve({ count: 0 });
    const skipAudit = Promise.resolve({ data: [] as AuditLogRecord[] });
    const [
      activeProjects,
      projectsAtRisk,
      pendingApprovals,
      overdueApprovals,
      activeEmployees,
      unreadNotifications,
      myApprovalSteps,
      myWorkflowSteps,
      myRfis,
      myNcrs,
      revisionDocs,
      myInspections,
      recentActivity,
    ] = await Promise.all([
      includeOrgStats
        ? this.supabase
            .from("projects")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .eq("status", "active")
        : skipCount,
      includeOrgStats
        ? this.supabase
            .from("projects")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .eq("status", "active")
            .in("risk_level", ["high", "critical"])
        : skipCount,
      includeOrgStats
        ? this.supabase
            .from("approval_requests")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .in("status", ["pending", "in_progress"])
        : skipCount,
      includeOrgStats
        ? this.supabase
            .from("approval_requests")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .in("status", ["pending", "in_progress"])
            .lt("due_at", now)
        : skipCount,
      includeOrgStats
        ? this.supabase
            .from("employees")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .eq("is_active", true)
        : skipCount,
      this.supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_profile_id", profileId)
        .is("read_at", null),
      this.supabase
        .from("approval_steps")
        .select("id, due_at, request_id, approval_requests(title, entity_type, entity_id)")
        .eq("organization_id", organizationId)
        .eq("user_id", profileId)
        .in("status", ["pending", "in_progress"])
        .limit(10),
      this.supabase
        .from("workflow_instance_steps")
        .select("id, due_at, step_key, instance_id")
        .eq("organization_id", organizationId)
        .eq("assigned_user_id", profileId)
        .in("status", ["ready", "in_progress"])
        .limit(10),
      this.supabase
        .from("rfis")
        .select("id, rfi_number, subject, response_required_by, status, priority")
        .eq("organization_id", organizationId)
        .eq("responsible_engineer_id", profileId)
        .in("status", ["draft", "internal_review", "submitted", "under_review", "answered"])
        .limit(15),
      this.supabase
        .from("ncrs")
        .select("id, ncr_number, description, severity, status, target_closure_date")
        .eq("organization_id", organizationId)
        .or(`assigned_to.eq.${profileId},responsible_person_id.eq.${profileId}`)
        .neq("status", "closed")
        .limit(15),
      this.supabase
        .from("documents")
        .select("id, document_number, title, official_decision, response_due_at")
        .eq("organization_id", organizationId)
        .eq("responsible_engineer_id", profileId)
        .in("official_decision", ["C", "D"])
        .is("archived_at", null)
        .limit(15),
      this.supabase
        .from("inspection_requests")
        .select("id, ir_number, related_activity, status, inspection_date_requested")
        .eq("organization_id", organizationId)
        .or(`site_engineer_id.eq.${profileId},quality_engineer_id.eq.${profileId},requested_by.eq.${profileId}`)
        .in("status", ["ready", "submitted", "scheduled", "failed", "reinspection_required"])
        .limit(15),
      includeAudit
        ? this.supabase
            .from("audit_logs")
            .select(AUDIT_FEED_COLUMNS)
            .eq("organization_id", organizationId)
            .order("created_at", { ascending: false })
            .limit(8)
        : skipAudit,
    ]);

    const pendingActions: PendingAction[] = [];
    for (const row of myApprovalSteps.data ?? []) {
      const request = Array.isArray(row.approval_requests)
        ? row.approval_requests[0]
        : row.approval_requests;
      pendingActions.push({
        id: row.id,
        kind: "approval",
        title: request?.title ?? "موافقة",
        entityType: request?.entity_type ?? "approval",
        entityId: request?.entity_id ?? row.request_id,
        dueAt: row.due_at,
        isOverdue: Boolean(row.due_at && row.due_at < now),
        priority: 2,
      });
    }
    for (const row of myWorkflowSteps.data ?? []) {
      pendingActions.push({
        id: row.id,
        kind: "workflow",
        title: row.step_key,
        entityType: "workflow_instance_step",
        entityId: row.instance_id,
        dueAt: row.due_at,
        isOverdue: Boolean(row.due_at && row.due_at < now),
        priority: 3,
      });
    }
    for (const row of myRfis.data ?? []) {
      const overdue = Boolean(
        row.response_required_by &&
          row.response_required_by < now &&
          ["submitted", "under_review"].includes(row.status),
      );
      pendingActions.push({
        id: row.id,
        kind: "rfi",
        title: `${row.rfi_number} — ${row.subject}`,
        entityType: "rfi",
        entityId: row.id,
        dueAt: row.response_required_by,
        isOverdue: overdue,
        priority: row.priority === "critical" ? 0 : overdue ? 1 : 4,
      });
    }
    for (const row of myNcrs.data ?? []) {
      const overdue = Boolean(
        row.target_closure_date && row.target_closure_date < now.slice(0, 10),
      );
      pendingActions.push({
        id: row.id,
        kind: "ncr",
        title: `${row.ncr_number} — ${row.description.slice(0, 60)}`,
        entityType: "ncr",
        entityId: row.id,
        dueAt: row.target_closure_date,
        isOverdue: overdue,
        priority: row.severity === "critical" ? 0 : overdue ? 1 : 3,
      });
    }
    for (const row of revisionDocs.data ?? []) {
      pendingActions.push({
        id: row.id,
        kind: "document_revision",
        title: `${row.document_number} — مراجعة مطلوبة (${row.official_decision})`,
        entityType: "document",
        entityId: row.id,
        dueAt: row.response_due_at,
        isOverdue: Boolean(row.response_due_at && row.response_due_at < now),
        priority: row.official_decision === "D" ? 1 : 2,
      });
    }
    for (const row of myInspections.data ?? []) {
      pendingActions.push({
        id: row.id,
        kind: "inspection",
        title: `${row.ir_number} — ${row.related_activity ?? row.status}`,
        entityType: "inspection_request",
        entityId: row.id,
        dueAt: row.inspection_date_requested,
        isOverdue: ["failed", "reinspection_required"].includes(row.status),
        priority: row.status === "failed" ? 1 : 3,
      });
    }

    pendingActions.sort((a, b) => {
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
      return (a.priority ?? 5) - (b.priority ?? 5);
    });

    return {
      stats: {
        activeProjects: activeProjects.count ?? 0,
        projectsAtRisk: projectsAtRisk.count ?? 0,
        pendingApprovals: pendingApprovals.count ?? 0,
        overdueApprovals: overdueApprovals.count ?? 0,
        activeEmployees: activeEmployees.count ?? 0,
        unreadNotifications: unreadNotifications.count ?? 0,
      },
      pendingActions: pendingActions.slice(0, 25),
      recentActivity: (recentActivity.data ?? []) as AuditLogRecord[],
    };
  }
}
