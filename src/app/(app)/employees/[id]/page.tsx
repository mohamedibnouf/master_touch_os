import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Button, Card, Field, Input, Select, TableScroll } from "@/components/ui/primitives";
import { PageContainer } from "@/components/layout/page-container";
import { EntityHeader } from "@/components/ui/entity-header";
import { DetailGrid } from "@/components/ui/detail-grid";
import { FormSection } from "@/components/ui/form-section";
import { displayInitials } from "@/lib/ui/initials";
import { auditActionLabel } from "@/lib/ui/audit-action-labels";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { isUuid } from "@/lib/utils";
import { CoreRepository } from "@/server/repositories/core.repository";
import { JobTitleRepository } from "@/server/repositories/job-title.repository";
import { EmployeeTitleFields } from "@/components/hr/employee-title-fields";
import { isHistoricalCatalogTitle, isLegacyJobTitle } from "@/lib/hr/job-titles";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  activateEmployeeContractAction,
  assignEmployeeDepartmentAction,
  createCompensationVersionAction,
  createEmployeeContractAction,
  deactivateEmployeeBankAction,
  setEmployeeActiveAction,
  provisionEmployeeLoginAction,
  updateEmployeeEmploymentAction,
  updateEmployeeProfileAction,
  uploadEmployeeDocumentAction,
  upsertEmployeeBankAction,
  upsertEmployeeComplianceAction,
} from "@/server/use-cases/hr";
import {
  COMPENSATION_STATUS_LABELS,
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  EMPLOYEE_GENDER_LABELS,
  EMPLOYEE_GENDERS,
  EMPLOYMENT_STATUS_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  EMPLOYMENT_TYPES,
  VISIBILITY_SCOPES,
  VISIBILITY_SCOPE_LABELS,
  contractStatusLabel,
  documentCategoryLabel,
  employmentTypeLabel,
  genderLabel,
  maskIban,
  visibilityScopeLabel,
} from "@/lib/hr/labels";
import { assignRoleAction, unassignRoleAction } from "@/server/use-cases/platform";
import { RoleRepository } from "@/server/repositories/role.repository";
import { isOperationalAssignableRole } from "@/lib/hr/roles";
import { readEmployeeLoginUiStatus } from "@/server/hr/employee-login-status";
import { readEmployeeSetupRows } from "@/server/hr/employee-setup-status";
import { getI18n } from "@/lib/i18n/server";
import { format, intlLocale, pickLocalized } from "@/lib/i18n/config";
import type { EmployeeGender, EmploymentStatus, EmploymentType } from "@/types/enums";

const SECTION_TITLE = "mb-3 text-sm font-semibold text-ink";
const TH = "p-2 text-start text-xs font-medium";
const EMPTY_TEXT = "rounded-[var(--radius-control)] bg-surface-muted px-3 py-6 text-center text-sm text-muted";

export default async function EmployeeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  const { t, locale } = await getI18n();
  const td = t.employeeDetail;
  const numberFormat = new Intl.NumberFormat(intlLocale(locale));
  const formatAmount = (value: number | string | null | undefined) => numberFormat.format(Number(value ?? 0));

  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { tab = "overview" } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const repo = new CoreRepository(supabase);

  const employee = await repo.getEmployeeDirectoryRow(ctx.organization.id, id);
  if (!employee) notFound();

  const isSelf = employee.profile_id === ctx.userId;
  const canManage = hasPermission(ctx, "employee.manage");

  // Permission checks for tabs
  const canCompliance =
    isSelf ||
    hasPermission(ctx, "employee_compliance.read") ||
    hasPermission(ctx, "employee_compliance.manage") ||
    canManage;
  const canManageCompliance =
    hasPermission(ctx, "employee_compliance.manage") || canManage;

  const canContracts =
    isSelf ||
    hasPermission(ctx, "employee_contract.read") ||
    hasPermission(ctx, "employee_contract.manage") ||
    canManage;
  const canManageContracts =
    hasPermission(ctx, "employee_contract.manage") || canManage;

  const canCompensation =
    hasPermission(ctx, "employee_compensation.read") ||
    hasPermission(ctx, "employee_compensation.manage") ||
    hasPermission(ctx, "finance.read") ||
    hasPermission(ctx, "finance.manage") ||
    canManage;
  const canManageCompensation =
    hasPermission(ctx, "employee_compensation.manage") || canManage;

  const canDocuments =
    isSelf ||
    hasPermission(ctx, "employee_document.read") ||
    hasPermission(ctx, "employee_document.manage") ||
    canManage;
  const canManageDocuments =
    hasPermission(ctx, "employee_document.manage") || canManage;

  const canBanking =
    isSelf ||
    hasPermission(ctx, "employee_bank.read") ||
    hasPermission(ctx, "employee_bank.manage") ||
    hasPermission(ctx, "finance.read") ||
    hasPermission(ctx, "finance.manage") ||
    canManage;
  const canManageBanking =
    hasPermission(ctx, "employee_bank.manage") ||
    hasPermission(ctx, "finance.manage") ||
    canManage;

  const canSensitive = hasPermission(ctx, "employee.read_sensitive") || canManage;
  const canAssignRole = hasPermission(ctx, "role.assign");
  const canViewRoles = canAssignRole || canManage || hasPermission(ctx, "role.read");
  const roleRepo = new RoleRepository(supabase);

  const [
    departments,
    jobTitles,
    projects,
    compliance,
    audit,
    contracts,
    compensationVersions,
    employeeDocs,
    bankAccounts,
    loginStatus,
    roleGrants,
    assignableRoles,
  ] = await Promise.all([
    repo.listDepartments(ctx.organization.id),
    new JobTitleRepository(supabase).listByOrganization(ctx.organization.id, { activeOnly: true }),
    repo.listEmployeeProjects(ctx.organization.id, employee.profile_id),
    canCompliance ? repo.getEmployeeCompliance(ctx.organization.id, id) : Promise.resolve(null),
    canManage ? repo.listEmployeeAudit(ctx.organization.id, id) : Promise.resolve([]),
    canContracts ? repo.listEmployeeContracts(ctx.organization.id, id) : Promise.resolve([]),
    canCompensation
      ? repo.listEmployeeCompensationVersions(ctx.organization.id, id)
      : Promise.resolve([]),
    canDocuments ? repo.listEmployeeDocuments(ctx.organization.id, id) : Promise.resolve([]),
    canBanking ? repo.listEmployeeBankAccounts(ctx.organization.id, id) : Promise.resolve([]),
    canManage || hasPermission(ctx, "employee.read") || hasPermission(ctx, "employee.create")
      ? readEmployeeLoginUiStatus({
          organizationId: ctx.organization.id,
          employeeId: employee.id,
          profileId: employee.profile_id,
          employeeActive: employee.is_active,
          employeeNumber: employee.employee_number,
        })
      : Promise.resolve(null),
    canViewRoles
      ? roleRepo.listGrantsForProfile(ctx.organization.id, employee.profile_id)
      : Promise.resolve([]),
    canAssignRole ? repo.listRoles(ctx.organization.id) : Promise.resolve([]),
  ]);

  const profile = Array.isArray(employee.profiles) ? employee.profiles[0] : employee.profiles;
  const deptLinks = (employee.employee_departments as Array<Record<string, unknown>>) ?? [];
  const primaryDept = deptLinks.find((d) => d.is_primary) ?? deptLinks[0];
  const primaryDepartmentId = (primaryDept?.department_id as string | undefined) ?? "";
  const currentTitleId = (employee.job_title_id as string | null) ?? null;
  const currentCatalogTitle = currentTitleId
    ? jobTitles.find((t) => t.id === currentTitleId) ?? {
        id: currentTitleId,
        organization_id: ctx.organization.id,
        department_id: "__other__",
        code: null,
        name_ar: employee.job_title_ar ?? "",
        name_en: employee.job_title_en ?? "",
        is_active: false,
        sort_order: 0,
      }
    : null;
  const legacyTitle = isLegacyJobTitle({ jobTitleId: currentTitleId, jobTitleAr: employee.job_title_ar });
  const historicalTitle = isHistoricalCatalogTitle({
    title: currentCatalogTitle,
    departmentId: primaryDepartmentId || undefined,
  });
  const status = employee.employment_status as EmploymentStatus;
  const empType = employee.employment_type as EmploymentType | null;
  const gender = employee.gender as EmployeeGender | null;

  const currentCompensation = compensationVersions.find((v) => v.status === "active" && !v.effective_to);
  const currentContract = contracts.find((c) => c.is_current);

  const canSeeSetup =
    canManage || hasPermission(ctx, "employee.read") || hasPermission(ctx, "employee.create");
  const setupRows = canSeeSetup
    ? await readEmployeeSetupRows({
        organizationId: ctx.organization.id,
        employeeId: employee.id,
        profileId: employee.profile_id,
        employeeNumber: employee.employee_number,
        hasProfileName: Boolean((profile as { full_name_ar?: string } | null)?.full_name_ar),
        hasDepartment: deptLinks.length > 0,
        loginStatus,
        hasCompensation: compensationVersions.some((v) => v.status === "active"),
      })
    : [];

  const setupRowLabel = (key: string, fallback: string) =>
    key in td.setup.rows ? td.setup.rows[key as keyof typeof td.setup.rows] : fallback;
  const setupStatusLabel = (row: (typeof setupRows)[number]) => {
    if (row.key === "login") return td.setup.login[loginStatus ?? "not_provisioned"];
    if (row.status === "needed" && (row.key === "leave" || row.key === "payroll")) return td.setup.status.needsSetup;
    return td.setup.status[row.status] ?? row.statusLabel;
  };

  const tabs = [
    { id: "overview", label: td.tabs.overview },
    { id: "organization", label: td.tabs.organization },
    ...(canCompliance ? [{ id: "compliance", label: td.tabs.compliance }] : []),
    ...(canContracts ? [{ id: "contracts", label: td.tabs.contracts }] : []),
    ...(canCompensation ? [{ id: "compensation", label: td.tabs.compensation }] : []),
    ...(canDocuments ? [{ id: "documents", label: td.tabs.documents }] : []),
    ...(canBanking ? [{ id: "banking", label: td.tabs.banking }] : []),
    { id: "projects", label: td.tabs.projects },
    ...(canManage ? [{ id: "activity", label: td.tabs.activity }] : []),
  ];

  const fullNameAr = (profile as { full_name_ar?: string } | null)?.full_name_ar ?? "";
  const fullNameEn = (profile as { full_name_en?: string } | null)?.full_name_en ?? "";
  const localizedName = pickLocalized(locale, fullNameAr, fullNameEn);
  const displayName = localizedName || td.fallbackName;
  const secondaryName = locale === "ar" ? fullNameEn : fullNameAr;
  const subtitleName = secondaryName && secondaryName !== displayName ? secondaryName : undefined;
  const localizedJobTitle = pickLocalized(locale, employee.job_title_ar, employee.job_title_en);

  return (
    <PageContainer data-testid="employee-detail-page" className="space-y-5">
      <EntityHeader
        initials={displayInitials(localizedName)}
        title={displayName}
        subtitle={subtitleName}
        meta={[employee.employee_number, localizedJobTitle, empType ? EMPLOYMENT_TYPE_LABELS[empType]?.[locale] : null]
          .filter(Boolean)
          .join(" · ")}
        badges={
          <>
            <Badge tone={employee.is_active ? "success" : "danger"}>
              {employee.is_active ? td.header.active : td.header.inactive}
            </Badge>
            {loginStatus ? (
              <Badge
                tone={loginStatus === "ready" ? "success" : loginStatus === "disabled" ? "danger" : "warning"}
                data-testid="employee-login-status"
              >
                {format(td.header.login, { status: td.loginStatus[loginStatus] })}
              </Badge>
            ) : null}
            <Badge tone="neutral">{EMPLOYMENT_STATUS_LABELS[status]?.[locale] ?? status}</Badge>
            {currentContract ? (
              <Badge tone="navy" data-testid="active-contract-badge">
                {format(td.header.activeContract, { number: currentContract.contract_number })}
              </Badge>
            ) : null}
          </>
        }
        actions={
          <Link
            href="/employees"
            className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm font-medium text-ink duration-150 hover:bg-surface-muted md:min-h-10"
            data-testid="employee-back-link"
          >
            {td.header.back}
          </Link>
        }
      />

      {setupRows.length > 0 ? (
        <section className="mt-surface p-4 md:p-5" data-testid="employee-setup-checklist">
          <h2 className={SECTION_TITLE}>{td.setup.title}</h2>
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {setupRows.map((row) => (
              <li
                key={row.key}
                className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] bg-surface-muted px-3 py-2"
              >
                <span className="min-w-0 text-muted">{setupRowLabel(row.key, row.label)}</span>
                {row.href ? (
                  <Link href={row.href} className="shrink-0 font-medium text-primary duration-150 hover:underline" data-testid={`setup-${row.key}`}>
                    {setupStatusLabel(row)}
                  </Link>
                ) : (
                  <span className="shrink-0 font-medium text-ink" data-testid={`setup-${row.key}`}>
                    {setupStatusLabel(row)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <nav
        className="mb-2 flex min-w-0 max-w-full gap-1 overflow-x-auto overscroll-x-contain border-b border-line pb-2 whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-testid="employee-tabs"
        aria-label={td.tabsAria}
      >
        {tabs.map((tabItem) => (
          <Link
            key={tabItem.id}
            href={`/employees/${id}?tab=${tabItem.id}`}
            data-testid={`employee-tab-${tabItem.id}`}
            aria-current={tab === tabItem.id ? "page" : undefined}
            className={`shrink-0 rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium duration-150 ${
              tab === tabItem.id ? "bg-primary-soft font-medium text-primary" : "text-muted hover:bg-surface-muted hover:text-ink"
            }`}
          >
            {tabItem.label}
          </Link>
        ))}
      </nav>

      {tab === "overview" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {canManage && loginStatus ? (
            <Card data-testid="employee-login-card" className="lg:col-span-2">
              <FormSection
                title={td.overview.loginCard.title}
                description={td.overview.loginCard.description}
              >
                <p className="mb-4 text-sm text-muted">
                  {td.overview.loginCard.statusLabel}{" "}
                  <span data-testid="employee-login-status-text" className="font-semibold text-ink">
                    {td.loginStatus[loginStatus]}
                  </span>
                </p>
                {employee.is_active && employee.employee_number ? (
                  <ServerActionForm action={provisionEmployeeLoginAction} className="grid max-w-md gap-3">
                    <input type="hidden" name="employeeId" value={employee.id} />
                    <Field label={td.overview.loginCard.password} hint={td.overview.loginCard.passwordHint}>
                      <Input
                        name="password"
                        type="password"
                        required
                        minLength={8}
                        autoComplete="new-password"
                        data-testid="employee-login-password"
                      />
                    </Field>
                    <Button type="submit" data-testid="employee-login-provision">
                      {td.overview.loginCard.submit}
                    </Button>
                  </ServerActionForm>
                ) : (
                  <p className="text-sm text-muted">{td.overview.loginCard.prerequisite}</p>
                )}
              </FormSection>
            </Card>
          ) : null}
          <Card data-testid="employee-overview-card">
            <h2 className={SECTION_TITLE}>{td.overview.basics.title}</h2>
            <DetailGrid
              items={[
                { label: td.overview.basics.employeeNumber, value: employee.employee_number ?? "—", testId: "emp-number" },
                { label: td.overview.basics.nameAr, value: (profile as { full_name_ar?: string } | null)?.full_name_ar ?? "—", testId: "emp-name-ar" },
                { label: td.overview.basics.nameEn, value: (profile as { full_name_en?: string } | null)?.full_name_en ?? "—", testId: "emp-name-en" },
                { label: td.overview.basics.jobTitleAr, value: employee.job_title_ar ?? "—", testId: "emp-job-title-ar" },
                { label: td.overview.basics.jobTitleEn, value: employee.job_title_en ?? "—", testId: "emp-job-title-en" },
                {
                  label: td.overview.basics.titleSource,
                  value: legacyTitle
                    ? td.overview.basics.titleSourceLegacy
                    : historicalTitle
                      ? td.overview.basics.titleSourceHistorical
                      : td.overview.basics.titleSourceCatalog,
                  testId: "emp-job-title-source",
                },
                { label: td.overview.basics.employmentType, value: employmentTypeLabel(employee.employment_type, locale), testId: "emp-employment-type" },
                { label: td.overview.basics.joiningDate, value: employee.joining_date ?? "—", testId: "emp-joining-date" },
                { label: td.overview.basics.workLocation, value: employee.work_location ?? "—", testId: "emp-work-location" },
                { label: td.overview.basics.nationality, value: employee.nationality ?? "—", testId: "emp-nationality" },
                { label: td.overview.basics.gender, value: genderLabel(gender, locale), testId: "emp-gender" },
                {
                  label: td.overview.basics.dateOfBirth,
                  value: canSensitive ? employee.date_of_birth ?? "—" : td.overview.basics.protected,
                  testId: "emp-dob",
                },
              ]}
            />
          </Card>

          {canManage ? (
            <Card data-testid="employee-edit-profile-card">
              <h2 className="mb-1 text-sm font-semibold text-ink">{td.overview.profileForm.title}</h2>
              <p className="mb-3 text-sm text-muted">{td.overview.profileForm.description}</p>
              <ServerActionForm action={updateEmployeeProfileAction} className="grid gap-3 md:grid-cols-2">
                <input type="hidden" name="employeeId" value={employee.id} />
                <Field label={td.overview.profileForm.nameAr}>
                  <Input
                    name="full_name_ar"
                    required
                    minLength={2}
                    dir="rtl"
                    defaultValue={(profile as { full_name_ar?: string } | null)?.full_name_ar ?? ""}
                  />
                </Field>
                <Field label={td.overview.profileForm.nameEn}>
                  <Input
                    name="full_name_en"
                    required
                    minLength={2}
                    dir="ltr"
                    defaultValue={(profile as { full_name_en?: string } | null)?.full_name_en ?? ""}
                  />
                </Field>
                <Field label={td.overview.profileForm.phone} hint={td.overview.profileForm.phoneHint}>
                  <Input
                    name="phone"
                    type="tel"
                    dir="ltr"
                    defaultValue={(profile as { phone?: string | null } | null)?.phone ?? ""}
                    data-testid="employee-phone-input"
                  />
                </Field>
                <div className="md:col-span-2">
                  <Button type="submit">{td.overview.profileForm.submit}</Button>
                </div>
              </ServerActionForm>
            </Card>
          ) : null}

          {canManage ? (
            <Card data-testid="employee-edit-employment-card">
              <h2 className={SECTION_TITLE}>{td.overview.employmentForm.title}</h2>
              <ServerActionForm action={updateEmployeeEmploymentAction} className="grid gap-3">
                <input type="hidden" name="employeeId" value={employee.id} />
                <Field label={td.overview.employmentForm.employeeNumber}>
                  <Input
                    name="employee_number"
                    defaultValue={employee.employee_number ?? ""}
                    data-testid="edit-emp-number"
                  />
                </Field>
                <div className="grid gap-3 md:grid-cols-2">
                  <EmployeeTitleFields
                    departments={departments}
                    titles={jobTitles}
                    canManageTitles={hasPermission(ctx, "job_title.manage")}
                    departmentTestId="employee-edit-department"
                    titleTestId="employee-edit-title"
                    defaultDepartmentId={primaryDepartmentId}
                    defaultTitleId={currentTitleId ?? ""}
                    historicalHint={historicalTitle ? td.overview.employmentForm.historicalHint : null}
                    legacyHint={legacyTitle ? td.overview.employmentForm.legacyHint : null}
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={td.overview.employmentForm.employmentType}>
                    <Select
                      name="employment_type"
                      defaultValue={employee.employment_type ?? "permanent"}
                      data-testid="employee-edit-type"
                    >
                      {EMPLOYMENT_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {EMPLOYMENT_TYPE_LABELS[type][locale]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={td.overview.employmentForm.employmentStatus}>
                    <Select
                      name="employment_status"
                      defaultValue={employee.employment_status}
                      data-testid="employee-edit-status"
                    >
                      {(
                        ["active", "on_leave", "probation", "terminated", "resigned"] as EmploymentStatus[]
                      ).map((s) => (
                        <option key={s} value={s}>
                          {EMPLOYMENT_STATUS_LABELS[s]?.[locale] ?? s}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={td.overview.employmentForm.probationEnd}>
                    <Input
                      name="probation_end"
                      type="date"
                      defaultValue={employee.probation_end ?? ""}
                      data-testid="employee-edit-probation-end"
                    />
                  </Field>
                  <Field label={td.overview.employmentForm.joiningDate}>
                    <Input
                      name="joining_date"
                      type="date"
                      defaultValue={employee.joining_date ?? ""}
                      data-testid="edit-emp-joining-date"
                    />
                  </Field>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={td.overview.employmentForm.workLocation}>
                    <Input
                      name="work_location"
                      defaultValue={employee.work_location ?? ""}
                      data-testid="edit-emp-location"
                    />
                  </Field>
                  <Field label={td.overview.employmentForm.nationality}>
                    <Input
                      name="nationality"
                      defaultValue={employee.nationality ?? ""}
                      data-testid="edit-emp-nationality"
                    />
                  </Field>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={td.overview.employmentForm.gender}>
                    <Select name="gender" defaultValue={employee.gender ?? "unspecified"}>
                      {EMPLOYEE_GENDERS.map((g) => (
                        <option key={g} value={g}>
                          {EMPLOYEE_GENDER_LABELS[g][locale]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={td.overview.employmentForm.dateOfBirth}>
                    <Input
                      name="date_of_birth"
                      type="date"
                      defaultValue={employee.date_of_birth ?? ""}
                      data-testid="edit-emp-dob"
                    />
                  </Field>
                </div>
                <Button type="submit" data-testid="employee-edit-employment-submit">
                  {td.overview.employmentForm.submit}
                </Button>
              </ServerActionForm>
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "organization" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card data-testid="employee-org-card">
            <h2 className={SECTION_TITLE}>{td.organization.structure.title}</h2>
            <DetailGrid
              items={[
                {
                  label: td.organization.structure.departments,
                  testId: "emp-departments",
                  value:
                    deptLinks.length === 0
                      ? td.organization.structure.unassigned
                      : deptLinks
                          .map((d) => {
                            const dept = d.departments as { name_ar?: string; name_en?: string } | null;
                            return (
                              pickLocalized(locale, dept?.name_ar, dept?.name_en) ||
                              td.organization.structure.departmentFallback
                            );
                          })
                          .join(td.organization.structure.separator),
                },
              ]}
            />
          </Card>

          {canManage ? (
            <Card data-testid="employee-assign-dept-card">
              <h2 className={SECTION_TITLE}>{td.organization.assignDepartment.title}</h2>
              <ServerActionForm action={assignEmployeeDepartmentAction} className="grid gap-3">
                <input type="hidden" name="employeeId" value={employee.id} />
                <Field label={td.organization.assignDepartment.department}>
                  <Select name="departmentId" data-testid="employee-assign-department">
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {pickLocalized(locale, d.name_ar, d.name_en)} ({d.code})
                      </option>
                    ))}
                  </Select>
                </Field>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" name="isPrimary" defaultChecked value="true" />
                  {td.organization.assignDepartment.isPrimary}
                </label>
                <Button type="submit" data-testid="employee-assign-department-submit">
                  {td.organization.assignDepartment.submit}
                </Button>
              </ServerActionForm>
            </Card>
          ) : null}

          {canViewRoles ? (
            <Card className="lg:col-span-2" data-testid="employee-roles-card">
              <h2 className="mb-1 text-sm font-semibold text-ink">{td.organization.roles.title}</h2>
              <p className="mb-3 text-xs text-muted">{td.organization.roles.description}</p>
              {roleGrants.length === 0 ? (
                <p className={EMPTY_TEXT}>{td.organization.roles.empty}</p>
              ) : (
                <ul className="mb-4 space-y-2">
                  {roleGrants.map((grant) => (
                    <li key={grant.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                      <div>
                        <p className="text-sm font-medium text-ink">
                          {pickLocalized(locale, grant.roles?.name_ar, grant.roles?.name_en) || grant.role_id}
                        </p>
                        <p className="text-xs text-muted">
                          {grant.roles?.code}
                          {grant.roles?.is_system ? td.organization.roles.systemRole : ""}
                          {grant.roles?.is_active === false ? td.organization.roles.inactive : ""}
                        </p>
                      </div>
                      {canAssignRole ? (
                        <ServerActionForm action={unassignRoleAction}>
                          <input type="hidden" name="profileId" value={employee.profile_id} />
                          <input type="hidden" name="userRoleId" value={grant.id} />
                          <Button type="submit" variant="secondary">
                            {td.organization.roles.unassign}
                          </Button>
                        </ServerActionForm>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {canAssignRole ? (
                <ServerActionForm action={assignRoleAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="profileId" value={employee.profile_id} />
                  <Field label={td.organization.roles.assignLabel}>
                    <Select name="roleId" required defaultValue="">
                      <option value="" disabled>
                        {td.organization.roles.choose}
                      </option>
                      {(assignableRoles as Array<{
                        id: string;
                        name_ar: string;
                        name_en?: string | null;
                        code?: string;
                        is_external?: boolean;
                        is_system?: boolean;
                        is_active?: boolean;
                      }>)
                        .filter((role) =>
                          isOperationalAssignableRole({
                            code: role.code,
                            is_external: role.is_external,
                            is_system: role.is_system,
                            is_active: role.is_active,
                            allowPrivileged: ctx.profile.is_platform_admin,
                          }),
                        )
                        .map((role) => (
                          <option key={role.id} value={role.id}>
                            {pickLocalized(locale, role.name_ar, role.name_en)}
                          </option>
                        ))}
                    </Select>
                  </Field>
                  <Button type="submit">{td.organization.roles.assign}</Button>
                </ServerActionForm>
              ) : null}
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "compliance" && canCompliance ? (
        <Card data-testid="employee-compliance-card">
          <h2 className={SECTION_TITLE}>{td.compliance.title}</h2>
          {!canManageCompliance ? (
            <dl className="grid gap-2 text-sm md:grid-cols-2">
              <div className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2.5">
                <dt className="text-xs text-muted">{td.compliance.iqamaNumber}</dt>
                <dd className="text-ink">{(compliance as { iqama_number?: string } | null)?.iqama_number ?? "—"}</dd>
              </div>
              <div className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2.5">
                <dt className="text-xs text-muted">{td.compliance.iqamaExpiry}</dt>
                <dd className="text-ink">{(compliance as { iqama_expiry?: string } | null)?.iqama_expiry ?? "—"}</dd>
              </div>
              <div className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2.5">
                <dt className="text-xs text-muted">{td.compliance.passportNumber}</dt>
                <dd className="text-ink">{(compliance as { passport_number?: string } | null)?.passport_number ?? "—"}</dd>
              </div>
              <div className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2.5">
                <dt className="text-xs text-muted">{td.compliance.passportExpiry}</dt>
                <dd className="text-ink">{(compliance as { passport_expiry?: string } | null)?.passport_expiry ?? "—"}</dd>
              </div>
              <div className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2.5">
                <dt className="text-xs text-muted">{td.compliance.workPermitExpiry}</dt>
                <dd className="text-ink">{(compliance as { work_permit_expiry?: string } | null)?.work_permit_expiry ?? "—"}</dd>
              </div>
              <div className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2.5">
                <dt className="text-xs text-muted">{td.compliance.insurance}</dt>
                <dd className="text-ink">
                  {(compliance as { insurance_provider?: string } | null)?.insurance_provider ?? "—"} /{" "}
                  {(compliance as { insurance_expiry?: string } | null)?.insurance_expiry ?? "—"}
                </dd>
              </div>
              <div className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2.5">
                <dt className="text-xs text-muted">{td.compliance.gosi}</dt>
                <dd className="text-ink">{(compliance as { gosi_number?: string } | null)?.gosi_number ?? "—"}</dd>
              </div>
            </dl>
          ) : (
            <ServerActionForm action={upsertEmployeeComplianceAction} className="grid gap-3 md:grid-cols-2">
              <input type="hidden" name="employeeId" value={employee.id} />
              <Field label={td.compliance.iqamaNumber}>
                <Input
                  name="iqama_number"
                  dir="ltr"
                  defaultValue={(compliance as { iqama_number?: string } | null)?.iqama_number ?? ""}
                  data-testid="compliance-iqama-number"
                />
              </Field>
              <Field label={td.compliance.iqamaExpiry}>
                <Input
                  name="iqama_expiry"
                  type="date"
                  defaultValue={(compliance as { iqama_expiry?: string } | null)?.iqama_expiry ?? ""}
                  data-testid="compliance-iqama-expiry"
                />
              </Field>
              <Field label={td.compliance.passportNumber}>
                <Input
                  name="passport_number"
                  dir="ltr"
                  defaultValue={(compliance as { passport_number?: string } | null)?.passport_number ?? ""}
                  data-testid="compliance-passport-number"
                />
              </Field>
              <Field label={td.compliance.passportExpiry}>
                <Input
                  name="passport_expiry"
                  type="date"
                  defaultValue={(compliance as { passport_expiry?: string } | null)?.passport_expiry ?? ""}
                  data-testid="compliance-passport-expiry"
                />
              </Field>
              <Field label={td.compliance.workPermitExpiry}>
                <Input
                  name="work_permit_expiry"
                  type="date"
                  defaultValue={(compliance as { work_permit_expiry?: string } | null)?.work_permit_expiry ?? ""}
                />
              </Field>
              <Field label={td.compliance.insuranceProvider}>
                <Input
                  name="insurance_provider"
                  defaultValue={(compliance as { insurance_provider?: string } | null)?.insurance_provider ?? ""}
                />
              </Field>
              <Field label={td.compliance.insuranceExpiry}>
                <Input
                  name="insurance_expiry"
                  type="date"
                  defaultValue={(compliance as { insurance_expiry?: string } | null)?.insurance_expiry ?? ""}
                />
              </Field>
              <Field label={td.compliance.gosiNumber}>
                <Input
                  name="gosi_number"
                  dir="ltr"
                  defaultValue={(compliance as { gosi_number?: string } | null)?.gosi_number ?? ""}
                  data-testid="compliance-gosi"
                />
              </Field>
              <div className="md:col-span-2">
                <Button type="submit" data-testid="compliance-submit">
                  {td.compliance.submit}
                </Button>
              </div>
            </ServerActionForm>
          )}
        </Card>
      ) : null}

      {/* Phase 4.2: Contracts Tab */}
      {tab === "contracts" && canContracts ? (
        <div className="grid gap-6">
          {canManageContracts ? (
            <Card data-testid="employee-create-contract-card">
              <h2 className={SECTION_TITLE}>{td.contracts.create.title}</h2>
              <ServerActionForm action={createEmployeeContractAction} className="grid gap-3 md:grid-cols-2">
                <input type="hidden" name="employeeId" value={employee.id} />
                <Field label={td.contracts.create.contractNumber}>
                  <Input
                    name="contract_number"
                    placeholder="CTR-2026-001"
                    required
                    dir="ltr"
                    data-testid="contract-number-input"
                  />
                </Field>
                <Field label={td.contracts.create.contractType}>
                  <Select name="contract_type" defaultValue="permanent" data-testid="contract-type-select">
                    {EMPLOYMENT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {EMPLOYMENT_TYPE_LABELS[type][locale]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={td.contracts.create.startDate}>
                  <Input name="start_date" type="date" required data-testid="contract-start-date" />
                </Field>
                <Field label={td.contracts.create.endDate}>
                  <Input name="end_date" type="date" data-testid="contract-end-date" />
                </Field>
                <Field label={td.contracts.create.probationEnd}>
                  <Input name="probation_end_date" type="date" data-testid="contract-probation-end-date" />
                </Field>
                <Field label={td.contracts.create.noticePeriod}>
                  <Input name="notice_period_days" type="number" defaultValue="30" />
                </Field>
                <Field label={td.contracts.create.weeklyHours}>
                  <Input name="working_hours_per_week" type="number" defaultValue="40" step="0.5" />
                </Field>
                <Field label={td.contracts.create.initialBasic}>
                  <Input
                    name="initial_basic_salary"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    data-testid="contract-initial-salary"
                  />
                </Field>
                <Field label={td.contracts.create.housing}>
                  <Input name="initial_housing_allowance" type="number" step="0.01" defaultValue="0" />
                </Field>
                <Field label={td.contracts.create.transport}>
                  <Input name="initial_transport_allowance" type="number" step="0.01" defaultValue="0" />
                </Field>
                <Field label={td.contracts.create.other}>
                  <Input name="initial_other_allowances" type="number" step="0.01" defaultValue="0" />
                </Field>
                <Field label={td.contracts.create.notes}>
                  <Input name="notes" placeholder={td.contracts.create.notesPlaceholder} />
                </Field>
                <div className="md:col-span-2">
                  <Button type="submit" data-testid="contract-submit">
                    {td.contracts.create.submit}
                  </Button>
                </div>
              </ServerActionForm>
            </Card>
          ) : null}

          <Card data-testid="employee-contracts-list-card">
            <h2 className={SECTION_TITLE}>{td.contracts.list.title}</h2>
            {contracts.length === 0 ? (
              <p className={EMPTY_TEXT} data-testid="employee-contracts-empty">
                {td.contracts.list.empty}
              </p>
            ) : (
              <TableScroll>
                <table className="w-full text-start text-sm">
                  <thead>
                    <tr className="border-b border-line bg-surface-muted text-muted">
                      <th className={TH}>{td.contracts.list.number}</th>
                      <th className={TH}>{td.contracts.list.type}</th>
                      <th className={TH}>{td.contracts.list.status}</th>
                      <th className={TH}>{td.contracts.list.start}</th>
                      <th className={TH}>{td.contracts.list.end}</th>
                      <th className={TH}>{td.contracts.list.current}</th>
                      {canManageContracts ? <th className={TH}>{td.contracts.list.actions}</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {contracts.map((c) => (
                      <tr
                        key={c.id}
                        className="border-b border-line"
                        data-testid={`contract-row-${c.id}`}
                      >
                        <td className="p-2 font-medium text-ink">{c.contract_number}</td>
                        <td className="p-2">{employmentTypeLabel(c.contract_type, locale)}</td>
                        <td className="p-2">
                          <Badge tone={c.status === "active" ? "success" : "neutral"}>
                            {contractStatusLabel(c.status, locale)}
                          </Badge>
                        </td>
                        <td className="p-2 tabular-nums">{c.start_date}</td>
                        <td className="p-2 tabular-nums">{c.end_date ?? td.contracts.list.openEnded}</td>
                        <td className="p-2">
                          {c.is_current ? (
                            <Badge tone="success" data-testid="contract-current-badge">
                              {td.contracts.list.currentBadge}
                            </Badge>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        {canManageContracts ? (
                          <td className="p-2">
                            {!c.is_current ? (
                              <ServerActionForm action={activateEmployeeContractAction} className="inline">
                                <input type="hidden" name="contractId" value={c.id} />
                                <input type="hidden" name="employeeId" value={employee.id} />
                                <Button
                                  type="submit"
                                  variant="secondary"
                                  data-testid={`contract-activate-btn-${c.id}`}
                                >
                                  {td.contracts.list.activate}
                                </Button>
                              </ServerActionForm>
                            ) : (
                              <span className="text-xs text-muted">{td.contracts.list.activated}</span>
                            )}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </Card>
        </div>
      ) : null}

      {/* Phase 4.2: Versioned Compensation Tab */}
      {tab === "compensation" && canCompensation ? (
        <div className="grid gap-6">
          <Card data-testid="employee-compensation-card">
            <h2 className={SECTION_TITLE}>{td.compensation.summary.title}</h2>
            {currentCompensation ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-[var(--radius-control)] border border-line bg-surface-muted p-3">
                  <span className="text-xs text-muted">{td.compensation.summary.basic}</span>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-ink" data-testid="comp-current-basic">
                    {formatAmount(currentCompensation.basic_salary)} {currentCompensation.currency}
                  </p>
                </div>
                <div className="rounded-[var(--radius-control)] border border-line bg-surface-muted p-3">
                  <span className="text-xs text-muted">{td.compensation.summary.housing}</span>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
                    {formatAmount(currentCompensation.housing_allowance)} {currentCompensation.currency}
                  </p>
                </div>
                <div className="rounded-[var(--radius-control)] border border-line bg-surface-muted p-3">
                  <span className="text-xs text-muted">{td.compensation.summary.transport}</span>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
                    {formatAmount(currentCompensation.transport_allowance)} {currentCompensation.currency}
                  </p>
                </div>
                <div className="rounded-[var(--radius-control)] border border-primary/20 bg-primary-soft p-3">
                  <span className="text-xs text-muted">{td.compensation.summary.total}</span>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-primary" data-testid="comp-total-display">
                    {formatAmount(
                      Number(currentCompensation.basic_salary) +
                        Number(currentCompensation.housing_allowance) +
                        Number(currentCompensation.transport_allowance) +
                        Number(currentCompensation.other_allowances),
                    )}{" "}
                    {currentCompensation.currency}
                  </p>
                </div>
              </div>
            ) : (
              <p className={EMPTY_TEXT} data-testid="comp-no-active">
                {td.compensation.summary.empty}
              </p>
            )}
          </Card>

          {canManageCompensation ? (
            <Card data-testid="employee-create-comp-version-card">
              <h2 className={SECTION_TITLE}>{td.compensation.create.title}</h2>
              <ServerActionForm action={createCompensationVersionAction} className="grid gap-3 md:grid-cols-2">
                <input type="hidden" name="employeeId" value={employee.id} />
                <Field label={td.compensation.create.effectiveFrom}>
                  <Input
                    name="effective_from"
                    type="date"
                    required
                    data-testid="comp-effective-from"
                  />
                </Field>
                <Field label={td.compensation.create.currency}>
                  <Input name="currency" defaultValue="SAR" required dir="ltr" />
                </Field>
                <Field label={td.compensation.create.basic}>
                  <Input
                    name="basic_salary"
                    type="number"
                    step="0.01"
                    required
                    placeholder="10000.00"
                    data-testid="comp-basic-input"
                  />
                </Field>
                <Field label={td.compensation.create.housing}>
                  <Input
                    name="housing_allowance"
                    type="number"
                    step="0.01"
                    defaultValue="0"
                    data-testid="comp-housing-input"
                  />
                </Field>
                <Field label={td.compensation.create.transport}>
                  <Input
                    name="transport_allowance"
                    type="number"
                    step="0.01"
                    defaultValue="0"
                    data-testid="comp-transport-input"
                  />
                </Field>
                <Field label={td.compensation.create.other}>
                  <Input name="other_allowances" type="number" step="0.01" defaultValue="0" />
                </Field>
                <div className="md:col-span-2">
                  <Field label={td.compensation.create.reason}>
                    <Input
                      name="change_reason"
                      placeholder={td.compensation.create.reasonPlaceholder}
                      data-testid="comp-reason-input"
                    />
                  </Field>
                </div>
                <div className="md:col-span-2">
                  <Button type="submit" data-testid="comp-submit">
                    {td.compensation.create.submit}
                  </Button>
                </div>
              </ServerActionForm>
            </Card>
          ) : null}

          <Card data-testid="employee-comp-history-card">
            <h2 className={SECTION_TITLE}>{td.compensation.history.title}</h2>
            {compensationVersions.length === 0 ? (
              <p className={EMPTY_TEXT} data-testid="employee-comp-history-empty">
                {td.compensation.history.empty}
              </p>
            ) : (
              <TableScroll>
                <table className="w-full text-start text-sm">
                  <thead>
                    <tr className="border-b border-line bg-surface-muted text-muted">
                      <th className={TH}>{td.compensation.history.start}</th>
                      <th className={TH}>{td.compensation.history.end}</th>
                      <th className={TH}>{td.compensation.history.basic}</th>
                      <th className={TH}>{td.compensation.history.allowances}</th>
                      <th className={TH}>{td.compensation.history.total}</th>
                      <th className={TH}>{td.compensation.history.status}</th>
                      <th className={TH}>{td.compensation.history.reason}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compensationVersions.map((v) => (
                      <tr
                        key={v.id}
                        className="border-b border-line"
                        data-testid={`comp-version-row-${v.id}`}
                      >
                        <td className="p-2 font-medium tabular-nums text-ink">{v.effective_from}</td>
                        <td className="p-2 tabular-nums">{v.effective_to ?? td.compensation.history.openCurrent}</td>
                        <td className="p-2 tabular-nums">{formatAmount(v.basic_salary)} {v.currency}</td>
                        <td className="p-2 tabular-nums">
                          {formatAmount(
                            Number(v.housing_allowance) +
                              Number(v.transport_allowance) +
                              Number(v.other_allowances),
                          )}{" "}
                          {v.currency}
                        </td>
                        <td className="p-2 font-semibold tabular-nums text-ink">
                          {formatAmount(
                            Number(v.basic_salary) +
                              Number(v.housing_allowance) +
                              Number(v.transport_allowance) +
                              Number(v.other_allowances),
                          )}{" "}
                          {v.currency}
                        </td>
                        <td className="p-2">
                          <Badge tone={v.status === "active" ? "success" : "neutral"}>
                            {COMPENSATION_STATUS_LABELS[v.status]?.[locale] ?? v.status}
                          </Badge>
                        </td>
                        <td className="p-2 text-muted">{v.change_reason ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </Card>
        </div>
      ) : null}

      {/* Phase 4.2: Secure HR Documents Tab */}
      {tab === "documents" && canDocuments ? (
        <div className="grid gap-6">
          {canManageDocuments ? (
            <Card data-testid="employee-upload-doc-card">
              <h2 className={SECTION_TITLE}>{td.documents.upload.title}</h2>
              <ServerActionForm action={uploadEmployeeDocumentAction} className="grid gap-3 md:grid-cols-2">
                <input type="hidden" name="employeeId" value={employee.id} />
                <Field label={td.documents.upload.docTitle}>
                  <Input name="title" required placeholder={td.documents.upload.docTitlePlaceholder} data-testid="hr-doc-title" />
                </Field>
                <Field label={td.documents.upload.category}>
                  <Select name="category" defaultValue="contract" data-testid="hr-doc-category">
                    {DOCUMENT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {DOCUMENT_CATEGORY_LABELS[c][locale]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={td.documents.upload.visibility}>
                  <Select name="visibility_scope" defaultValue="employee_visible" data-testid="hr-doc-visibility">
                    {VISIBILITY_SCOPES.map((v) => (
                      <option key={v} value={v}>
                        {VISIBILITY_SCOPE_LABELS[v][locale]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={td.documents.upload.number}>
                  <Input name="document_number" placeholder={td.documents.upload.numberPlaceholder} />
                </Field>
                <Field label={td.documents.upload.issueDate}>
                  <Input name="issue_date" type="date" />
                </Field>
                <Field label={td.documents.upload.expiryDate}>
                  <Input name="expiry_date" type="date" />
                </Field>
                <div className="md:col-span-2">
                  <Field label={td.documents.upload.file}>
                    <input
                      type="file"
                      name="file"
                      required
                      className="w-full text-sm text-muted file:me-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-primary/90"
                      data-testid="hr-doc-file"
                    />
                  </Field>
                </div>
                <div className="md:col-span-2">
                  <Field label={td.documents.upload.notes}>
                    <Input name="notes" placeholder={td.documents.upload.notesPlaceholder} />
                  </Field>
                </div>
                <div className="md:col-span-2">
                  <Button type="submit" data-testid="hr-doc-submit">
                    {td.documents.upload.submit}
                  </Button>
                </div>
              </ServerActionForm>
            </Card>
          ) : null}

          <Card data-testid="employee-documents-card">
            <h2 className={SECTION_TITLE}>{td.documents.list.title}</h2>
            {employeeDocs.length === 0 ? (
              <p className={EMPTY_TEXT} data-testid="employee-documents-empty">
                {td.documents.list.empty}
              </p>
            ) : (
              <TableScroll>
                <table className="w-full text-start text-sm">
                  <thead>
                    <tr className="border-b border-line bg-surface-muted text-muted">
                      <th className={TH}>{td.documents.list.docTitle}</th>
                      <th className={TH}>{td.documents.list.category}</th>
                      <th className={TH}>{td.documents.list.visibility}</th>
                      <th className={TH}>{td.documents.list.number}</th>
                      <th className={TH}>{td.documents.list.expiry}</th>
                      <th className={TH}>{td.documents.list.uploaded}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employeeDocs.map((d) => (
                      <tr
                        key={d.id}
                        className="border-b border-line"
                        data-testid={`hr-doc-row-${d.id}`}
                      >
                        <td className="p-2 font-medium text-ink">{d.documents?.title ?? td.documents.list.fallbackTitle}</td>
                        <td className="p-2">{documentCategoryLabel(d.category, locale)}</td>
                        <td className="p-2">
                          <Badge tone="neutral">{visibilityScopeLabel(d.visibility_scope, locale)}</Badge>
                        </td>
                        <td className="p-2">{d.document_number ?? "—"}</td>
                        <td className="p-2 tabular-nums">{d.expiry_date ?? "—"}</td>
                        <td className="p-2 tabular-nums text-muted">
                          {new Date(d.created_at).toLocaleDateString(intlLocale(locale))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </Card>
        </div>
      ) : null}

      {/* Phase 4.2: Employee Banking Tab */}
      {tab === "banking" && canBanking ? (
        <div className="grid gap-6">
          {canManageBanking ? (
            <Card data-testid="employee-add-bank-card">
              <h2 className={SECTION_TITLE}>{td.banking.add.title}</h2>
              <ServerActionForm action={upsertEmployeeBankAction} className="grid gap-3 md:grid-cols-2">
                <input type="hidden" name="employeeId" value={employee.id} />
                <Field label={td.banking.add.bankName}>
                  <Input
                    name="bank_name"
                    required
                    placeholder={td.banking.add.bankNamePlaceholder}
                    data-testid="bank-name-input"
                  />
                </Field>
                <Field label={td.banking.add.iban}>
                  <Input
                    name="iban"
                    required
                    dir="ltr"
                    placeholder="SA0380000000608010167519"
                    data-testid="bank-iban-input"
                  />
                </Field>
                <Field label={td.banking.add.accountName}>
                  <Input
                    name="account_name"
                    required
                    defaultValue={(profile as { full_name_ar?: string } | null)?.full_name_ar ?? ""}
                    data-testid="bank-account-name-input"
                  />
                </Field>
                <Field label={td.banking.add.swift}>
                  <Input name="swift_code" placeholder="RJHISARI" dir="ltr" />
                </Field>
                <div className="md:col-span-2">
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input type="checkbox" name="is_primary" defaultChecked value="true" />
                    {td.banking.add.isPrimary}
                  </label>
                </div>
                <div className="md:col-span-2">
                  <Button type="submit" data-testid="bank-submit">
                    {td.banking.add.submit}
                  </Button>
                </div>
              </ServerActionForm>
            </Card>
          ) : null}

          <Card data-testid="employee-banking-card">
            <h2 className={SECTION_TITLE}>{td.banking.list.title}</h2>
            {bankAccounts.length === 0 ? (
              <p className={EMPTY_TEXT} data-testid="employee-banking-empty">
                {td.banking.list.empty}
              </p>
            ) : (
              <TableScroll>
                <table className="w-full text-start text-sm">
                  <thead>
                    <tr className="border-b border-line bg-surface-muted text-muted">
                      <th className={TH}>{td.banking.list.bank}</th>
                      <th className={TH}>{td.banking.list.iban}</th>
                      <th className={TH}>{td.banking.list.accountName}</th>
                      <th className={TH}>{td.banking.list.type}</th>
                      <th className={TH}>{td.banking.list.status}</th>
                      {canManageBanking ? <th className={TH}>{td.banking.list.actions}</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {bankAccounts.map((b) => (
                      <tr
                        key={b.id}
                        className="border-b border-line"
                        data-testid={`bank-row-${b.id}`}
                      >
                        <td className="p-2 font-medium text-ink">{b.bank_name}</td>
                        <td className="p-2 font-mono" dir="ltr" data-testid={`bank-iban-${b.id}`}>
                          {b.iban ? b.iban : b.masked_iban || maskIban(b.iban)}
                        </td>
                        <td className="p-2">{b.account_name}</td>
                        <td className="p-2">
                          {b.is_primary ? (
                            <Badge tone="success">{td.banking.list.primary}</Badge>
                          ) : (
                            <span className="text-muted">{td.banking.list.secondary}</span>
                          )}
                        </td>
                        <td className="p-2">
                          <Badge tone={b.is_active ? "success" : "danger"}>
                            {b.is_active ? td.banking.list.active : td.banking.list.inactive}
                          </Badge>
                        </td>
                        {canManageBanking ? (
                          <td className="p-2">
                            {b.is_active ? (
                              <ServerActionForm action={deactivateEmployeeBankAction} className="inline">
                                <input type="hidden" name="employeeId" value={employee.id} />
                                <input type="hidden" name="accountId" value={b.id} />
                                <Button
                                  type="submit"
                                  variant="secondary"
                                  data-testid={`bank-deactivate-btn-${b.id}`}
                                >
                                  {td.banking.list.deactivate}
                                </Button>
                              </ServerActionForm>
                            ) : (
                              <span className="text-xs text-muted">{td.banking.list.inactive}</span>
                            )}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </Card>
        </div>
      ) : null}

      {tab === "projects" ? (
        <Card data-testid="employee-projects-card">
          <h2 className="mb-1 text-sm font-semibold text-ink">{td.projects.title}</h2>
          <p className="mb-3 text-sm text-muted">
            {td.projects.descriptionBefore} <code dir="ltr">project_members</code>. {td.projects.descriptionAfter}
          </p>
          {projects.length === 0 ? (
            <p className={EMPTY_TEXT} data-testid="employee-projects-empty">
              {td.projects.empty}
            </p>
          ) : (
            <ul className="grid gap-2 text-sm" data-testid="employee-projects-list">
              {projects.map((p) => {
                const proj = p.projects as {
                  id?: string;
                  project_code?: string;
                  name_ar?: string;
                  name_en?: string;
                  status?: string;
                } | null;
                return (
                  <li
                    key={p.id}
                    className="flex items-center justify-between border-b border-line pb-2"
                  >
                    <span className="text-ink">
                      {pickLocalized(locale, proj?.name_ar, proj?.name_en)} ({proj?.project_code})
                    </span>
                    <Badge tone="neutral">{p.role_label ?? td.projects.memberFallback}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ) : null}

      {tab === "activity" && canManage ? (
        <Card data-testid="employee-activity-card">
          <h2 className={SECTION_TITLE}>{td.activity.title}</h2>
          {audit.length === 0 ? (
            <p className={EMPTY_TEXT}>{td.activity.empty}</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {audit.map((a) => (
                <li key={a.id} className="flex justify-between gap-3 border-b border-line pb-1">
                  <span className="min-w-0 font-medium text-ink">{auditActionLabel(a.action, locale)}</span>
                  <span className="shrink-0 tabular-nums text-muted">
                    {new Date(a.created_at).toLocaleString(intlLocale(locale))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {canManage ? (
        <section className="rounded-[var(--radius-surface)] border border-danger/20 bg-danger-soft p-4 md:p-5">
          <h2 className="text-sm font-semibold text-danger">{td.danger.title}</h2>
          <p className="mt-1 mb-3 text-xs text-muted">{td.danger.description}</p>
          <ServerActionForm action={setEmployeeActiveAction}>
            <input type="hidden" name="employeeId" value={employee.id} />
            <input type="hidden" name="isActive" value={(!employee.is_active).toString()} />
            <Button
              type="submit"
              variant={employee.is_active ? "danger" : "secondary"}
              data-testid="employee-toggle-active"
            >
              {employee.is_active ? td.danger.deactivate : td.danger.reactivate}
            </Button>
          </ServerActionForm>
        </section>
      ) : null}
    </PageContainer>
  );
}
