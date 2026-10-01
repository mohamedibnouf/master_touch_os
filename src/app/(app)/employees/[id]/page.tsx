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
import { readEmployeeLoginUiStatus } from "@/server/hr/employee-login-status";
import { readEmployeeSetupRows } from "@/server/hr/employee-setup-status";
import { EMPLOYEE_LOGIN_STATUS_LABEL_AR } from "@/lib/auth/employee-login";
import type { EmployeeGender, EmploymentStatus, EmploymentType } from "@/types/enums";

export default async function EmployeeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

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

  const [
    departments,
    projects,
    compliance,
    audit,
    contracts,
    compensationVersions,
    employeeDocs,
    bankAccounts,
    loginStatus,
  ] = await Promise.all([
    repo.listDepartments(ctx.organization.id),
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
  ]);

  const profile = Array.isArray(employee.profiles) ? employee.profiles[0] : employee.profiles;
  const deptLinks = (employee.employee_departments as Array<Record<string, unknown>>) ?? [];
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

  const tabs = [
    { id: "overview", label: "نظرة عامة" },
    { id: "organization", label: "التنظيم" },
    ...(canCompliance ? [{ id: "compliance", label: "الامتثال" }] : []),
    ...(canContracts ? [{ id: "contracts", label: "العقود" }] : []),
    ...(canCompensation ? [{ id: "compensation", label: "الرواتب والبدلات" }] : []),
    ...(canDocuments ? [{ id: "documents", label: "الوثائق" }] : []),
    ...(canBanking ? [{ id: "banking", label: "الحسابات البنكية" }] : []),
    { id: "projects", label: "المشاريع" },
    ...(canManage ? [{ id: "activity", label: "النشاط" }] : []),
  ];

  const nameAr = (profile as { full_name_ar?: string } | null)?.full_name_ar || "موظف";
  const nameEn = (profile as { full_name_en?: string } | null)?.full_name_en;

  return (
    <PageContainer data-testid="employee-detail-page" className="space-y-5">
      <EntityHeader
        initials={displayInitials(nameAr === "موظف" ? "" : nameAr)}
        title={nameAr}
        subtitle={nameEn}
        meta={[employee.employee_number, employee.job_title_ar, empType ? EMPLOYMENT_TYPE_LABELS[empType].ar : null]
          .filter(Boolean)
          .join(" · ")}
        badges={
          <>
            <Badge tone={employee.is_active ? "success" : "danger"}>
              {employee.is_active ? "نشط" : "موقوف"}
            </Badge>
            {loginStatus ? (
              <Badge
                tone={loginStatus === "ready" ? "success" : loginStatus === "disabled" ? "danger" : "warning"}
                data-testid="employee-login-status"
              >
                دخول: {EMPLOYEE_LOGIN_STATUS_LABEL_AR[loginStatus]}
              </Badge>
            ) : null}
            <Badge tone="neutral">{EMPLOYMENT_STATUS_LABELS[status]?.ar ?? status}</Badge>
            {currentContract ? (
              <Badge tone="navy" data-testid="active-contract-badge">
                عقد سارٍ: {currentContract.contract_number}
              </Badge>
            ) : null}
          </>
        }
        actions={
          <Link
            href="/employees"
            className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-line bg-white px-3 text-sm font-medium text-navy duration-150 hover:bg-paper md:min-h-10"
            data-testid="employee-back-link"
          >
            الدليل
          </Link>
        }
      />

      {setupRows.length > 0 ? (
        <section className="mt-surface p-4 md:p-5" data-testid="employee-setup-checklist">
          <h2 className="mb-3 text-sm font-semibold text-navy">إعداد الموظف</h2>
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {setupRows.map((row) => (
              <li
                key={row.key}
                className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] bg-paper/80 px-3 py-2"
              >
                <span className="min-w-0 text-muted">{row.label}</span>
                {row.href ? (
                  <Link href={row.href} className="shrink-0 font-medium text-navy duration-150 hover:underline" data-testid={`setup-${row.key}`}>
                    {row.statusLabel}
                  </Link>
                ) : (
                  <span className="shrink-0 font-medium text-navy" data-testid={`setup-${row.key}`}>
                    {row.statusLabel}
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
        aria-label="أقسام ملف الموظف"
      >
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={`/employees/${id}?tab=${t.id}`}
            data-testid={`employee-tab-${t.id}`}
            className={`shrink-0 rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium duration-150 ${
              tab === t.id ? "bg-navy text-white" : "text-muted hover:bg-white hover:text-navy"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "overview" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {canManage && loginStatus ? (
            <Card data-testid="employee-login-card" className="lg:col-span-2">
              <FormSection
                title="حالة حساب الدخول"
                description="يسجّل الموظف دخوله بالرقم الوظيفي وكلمة المرور فقط. لا تُعرض كلمة المرور هنا ولا البريد الداخلي المُولَّد."
              >
                <p className="mb-4 text-sm">
                  الحالة:{" "}
                  <span data-testid="employee-login-status-text" className="font-semibold text-navy">
                    {EMPLOYEE_LOGIN_STATUS_LABEL_AR[loginStatus]}
                  </span>
                </p>
                {employee.is_active && employee.employee_number ? (
                  <ServerActionForm action={provisionEmployeeLoginAction} className="grid max-w-md gap-3">
                    <input type="hidden" name="employeeId" value={employee.id} />
                    <Field label="كلمة مرور الدخول" hint="8 أحرف على الأقل.">
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
                      تفعيل حساب الدخول
                    </Button>
                  </ServerActionForm>
                ) : (
                  <p className="text-sm text-muted">فعّل الموظف وعيّن رقماً وظيفياً قبل تفعيل الدخول.</p>
                )}
              </FormSection>
            </Card>
          ) : null}
          <Card data-testid="employee-overview-card">
            <h2 className="mb-3 text-sm font-semibold text-navy">البيانات الأساسية</h2>
            <DetailGrid
              items={[
                { label: "الرقم الوظيفي", value: employee.employee_number ?? "—", testId: "emp-number" },
                { label: "الاسم (عربي)", value: (profile as { full_name_ar?: string } | null)?.full_name_ar ?? "—", testId: "emp-name-ar" },
                { label: "الاسم (إنجليزي)", value: (profile as { full_name_en?: string } | null)?.full_name_en ?? "—", testId: "emp-name-en" },
                { label: "المسمى الوظيفي (عربي)", value: employee.job_title_ar ?? "—", testId: "emp-job-title-ar" },
                { label: "المسمى الوظيفي (إنجليزي)", value: employee.job_title_en ?? "—", testId: "emp-job-title-en" },
                { label: "نوع التوظيف", value: employmentTypeLabel(employee.employment_type), testId: "emp-employment-type" },
                { label: "تاريخ الانضمام", value: employee.joining_date ?? "—", testId: "emp-joining-date" },
                { label: "موقع العمل", value: employee.work_location ?? "—", testId: "emp-work-location" },
                { label: "الجنسية", value: employee.nationality ?? "—", testId: "emp-nationality" },
                { label: "الجنس", value: genderLabel(gender), testId: "emp-gender" },
                { label: "تاريخ الميلاد", value: canSensitive ? employee.date_of_birth ?? "—" : "محمي", testId: "emp-dob" },
              ]}
            />
          </Card>

          {canManage ? (
            <Card data-testid="employee-edit-employment-card">
              <h2 className="mb-3 text-sm font-semibold text-navy">تحديث بيانات التوظيف</h2>
              <ServerActionForm action={updateEmployeeEmploymentAction} className="grid gap-3">
                <input type="hidden" name="employeeId" value={employee.id} />
                <Field label="الرقم الوظيفي">
                  <Input
                    name="employee_number"
                    defaultValue={employee.employee_number ?? ""}
                    data-testid="edit-emp-number"
                  />
                </Field>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="المسمى الوظيفي (عربي)">
                    <Input
                      name="job_title_ar"
                      defaultValue={employee.job_title_ar ?? ""}
                      data-testid="employee-edit-title"
                    />
                  </Field>
                  <Field label="المسمى الوظيفي (إنجليزي)">
                    <Input
                      name="job_title_en"
                      defaultValue={employee.job_title_en ?? ""}
                      data-testid="edit-emp-title-en"
                    />
                  </Field>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="نوع التوظيف">
                    <Select
                      name="employment_type"
                      defaultValue={employee.employment_type ?? "permanent"}
                      data-testid="employee-edit-type"
                    >
                      {EMPLOYMENT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {EMPLOYMENT_TYPE_LABELS[t].ar}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="حالة التوظيف">
                    <Select
                      name="employment_status"
                      defaultValue={employee.employment_status}
                      data-testid="employee-edit-status"
                    >
                      {(
                        ["active", "on_leave", "probation", "terminated", "resigned"] as EmploymentStatus[]
                      ).map((s) => (
                        <option key={s} value={s}>
                          {EMPLOYMENT_STATUS_LABELS[s]?.ar ?? s}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="نهاية فترة التجربة (اختياري)">
                    <Input
                      name="probation_end"
                      type="date"
                      defaultValue={employee.probation_end ?? ""}
                      data-testid="employee-edit-probation-end"
                    />
                  </Field>
                  <Field label="تاريخ الانضمام">
                    <Input
                      name="joining_date"
                      type="date"
                      defaultValue={employee.joining_date ?? ""}
                      data-testid="edit-emp-joining-date"
                    />
                  </Field>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="موقع العمل">
                    <Input
                      name="work_location"
                      defaultValue={employee.work_location ?? ""}
                      data-testid="edit-emp-location"
                    />
                  </Field>
                  <Field label="الجنسية">
                    <Input
                      name="nationality"
                      defaultValue={employee.nationality ?? ""}
                      data-testid="edit-emp-nationality"
                    />
                  </Field>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="الجنس">
                    <Select name="gender" defaultValue={employee.gender ?? "unspecified"}>
                      {EMPLOYEE_GENDERS.map((g) => (
                        <option key={g} value={g}>
                          {EMPLOYEE_GENDER_LABELS[g].ar}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="تاريخ الميلاد (اختياري)">
                    <Input
                      name="date_of_birth"
                      type="date"
                      defaultValue={employee.date_of_birth ?? ""}
                      data-testid="edit-emp-dob"
                    />
                  </Field>
                </div>
                <Button type="submit" data-testid="employee-edit-employment-submit">
                  حفظ بيانات التوظيف
                </Button>
              </ServerActionForm>
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "organization" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card data-testid="employee-org-card">
            <h2 className="mb-3 text-sm font-semibold text-navy">الهيكل والإدارة</h2>
            <DetailGrid
              items={[
                {
                  label: "الأقسام الحالية",
                  testId: "emp-departments",
                  value:
                    deptLinks.length === 0
                      ? "غير معين"
                      : deptLinks
                          .map((d) => {
                            const dept = d.departments as { name_ar?: string } | null;
                            return dept?.name_ar ?? "قسم";
                          })
                          .join("، "),
                },
              ]}
            />
          </Card>

          {canManage ? (
            <Card data-testid="employee-assign-dept-card">
              <h2 className="mb-3 font-semibold text-navy">تعيين القسم</h2>
              <ServerActionForm action={assignEmployeeDepartmentAction} className="grid gap-3">
                <input type="hidden" name="employeeId" value={employee.id} />
                <Field label="القسم">
                  <Select name="departmentId" data-testid="employee-assign-department">
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name_ar} ({d.code})
                      </option>
                    ))}
                  </Select>
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="isPrimary" defaultChecked value="true" />
                  القسم الأساسي للموظف
                </label>
                <Button type="submit" data-testid="employee-assign-department-submit">
                  تحديث القسم
                </Button>
              </ServerActionForm>
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "compliance" && canCompliance ? (
        <Card data-testid="employee-compliance-card">
          <h2 className="mb-3 font-semibold text-navy">الامتثال والوثائق النظامية</h2>
          {!canManageCompliance ? (
            <dl className="grid gap-2 text-sm md:grid-cols-2">
              <div>
                <dt className="text-muted">رقم الإقامة</dt>
                <dd>{(compliance as { iqama_number?: string } | null)?.iqama_number ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">انتهاء الإقامة</dt>
                <dd>{(compliance as { iqama_expiry?: string } | null)?.iqama_expiry ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">جواز السفر</dt>
                <dd>{(compliance as { passport_number?: string } | null)?.passport_number ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">انتهاء الجواز</dt>
                <dd>{(compliance as { passport_expiry?: string } | null)?.passport_expiry ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">انتهاء تصريح العمل</dt>
                <dd>{(compliance as { work_permit_expiry?: string } | null)?.work_permit_expiry ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">التأمين</dt>
                <dd>
                  {(compliance as { insurance_provider?: string } | null)?.insurance_provider ?? "—"} /{" "}
                  {(compliance as { insurance_expiry?: string } | null)?.insurance_expiry ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted">GOSI</dt>
                <dd>{(compliance as { gosi_number?: string } | null)?.gosi_number ?? "—"}</dd>
              </div>
            </dl>
          ) : (
            <ServerActionForm action={upsertEmployeeComplianceAction} className="grid gap-3 md:grid-cols-2">
              <input type="hidden" name="employeeId" value={employee.id} />
              <Field label="رقم الإقامة">
                <Input
                  name="iqama_number"
                  defaultValue={(compliance as { iqama_number?: string } | null)?.iqama_number ?? ""}
                  data-testid="compliance-iqama-number"
                />
              </Field>
              <Field label="انتهاء الإقامة">
                <Input
                  name="iqama_expiry"
                  type="date"
                  defaultValue={(compliance as { iqama_expiry?: string } | null)?.iqama_expiry ?? ""}
                  data-testid="compliance-iqama-expiry"
                />
              </Field>
              <Field label="جواز السفر">
                <Input
                  name="passport_number"
                  defaultValue={(compliance as { passport_number?: string } | null)?.passport_number ?? ""}
                  data-testid="compliance-passport-number"
                />
              </Field>
              <Field label="انتهاء الجواز">
                <Input
                  name="passport_expiry"
                  type="date"
                  defaultValue={(compliance as { passport_expiry?: string } | null)?.passport_expiry ?? ""}
                  data-testid="compliance-passport-expiry"
                />
              </Field>
              <Field label="انتهاء تصريح العمل">
                <Input
                  name="work_permit_expiry"
                  type="date"
                  defaultValue={(compliance as { work_permit_expiry?: string } | null)?.work_permit_expiry ?? ""}
                />
              </Field>
              <Field label="مزود التأمين">
                <Input
                  name="insurance_provider"
                  defaultValue={(compliance as { insurance_provider?: string } | null)?.insurance_provider ?? ""}
                />
              </Field>
              <Field label="انتهاء التأمين">
                <Input
                  name="insurance_expiry"
                  type="date"
                  defaultValue={(compliance as { insurance_expiry?: string } | null)?.insurance_expiry ?? ""}
                />
              </Field>
              <Field label="رقم GOSI">
                <Input
                  name="gosi_number"
                  defaultValue={(compliance as { gosi_number?: string } | null)?.gosi_number ?? ""}
                  data-testid="compliance-gosi"
                />
              </Field>
              <div className="md:col-span-2">
                <Button type="submit" data-testid="compliance-submit">
                  حفظ الامتثال
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
              <h2 className="mb-3 font-semibold text-navy">إنشاء عقد عمل جديد</h2>
              <ServerActionForm action={createEmployeeContractAction} className="grid gap-3 md:grid-cols-2">
                <input type="hidden" name="employeeId" value={employee.id} />
                <Field label="رقم العقد">
                  <Input
                    name="contract_number"
                    placeholder="CTR-2026-001"
                    required
                    data-testid="contract-number-input"
                  />
                </Field>
                <Field label="نوع العقد">
                  <Select name="contract_type" defaultValue="permanent" data-testid="contract-type-select">
                    {EMPLOYMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {EMPLOYMENT_TYPE_LABELS[t].ar}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="تاريخ بداية العقد">
                  <Input name="start_date" type="date" required data-testid="contract-start-date" />
                </Field>
                <Field label="تاريخ نهاية العقد (اختياري للأنواع المحددة)">
                  <Input name="end_date" type="date" data-testid="contract-end-date" />
                </Field>
                <Field label="تاريخ نهاية التجربة (اختياري)">
                  <Input name="probation_end_date" type="date" data-testid="contract-probation-end-date" />
                </Field>
                <Field label="فترة الإشعار (بالأيام)">
                  <Input name="notice_period_days" type="number" defaultValue="30" />
                </Field>
                <Field label="ساعات العمل الأسبوعية">
                  <Input name="working_hours_per_week" type="number" defaultValue="40" step="0.5" />
                </Field>
                <Field label="الراتب الأساسي المبدئي">
                  <Input
                    name="initial_basic_salary"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    data-testid="contract-initial-salary"
                  />
                </Field>
                <Field label="بدل السكن">
                  <Input name="initial_housing_allowance" type="number" step="0.01" defaultValue="0" />
                </Field>
                <Field label="بدل النقل">
                  <Input name="initial_transport_allowance" type="number" step="0.01" defaultValue="0" />
                </Field>
                <Field label="بدلات أخرى">
                  <Input name="initial_other_allowances" type="number" step="0.01" defaultValue="0" />
                </Field>
                <Field label="ملاحظات العقد">
                  <Input name="notes" placeholder="ملاحظات وشروط إضافية" />
                </Field>
                <div className="md:col-span-2">
                  <Button type="submit" data-testid="contract-submit">
                    حفظ العقد كمسودة
                  </Button>
                </div>
              </ServerActionForm>
            </Card>
          ) : null}

          <Card data-testid="employee-contracts-list-card">
            <h2 className="mb-3 font-semibold text-navy">سجل عقود الموظف</h2>
            {contracts.length === 0 ? (
              <p className="text-sm text-muted" data-testid="employee-contracts-empty">
                لا توجد عقود مسجلة لهذا الموظف.
              </p>
            ) : (
              <TableScroll>
                <table className="w-full text-right text-sm">
                  <thead>
                    <tr className="border-b border-line text-muted">
                      <th className="p-2">رقم العقد</th>
                      <th className="p-2">النوع</th>
                      <th className="p-2">الحالة</th>
                      <th className="p-2">تاريخ البدء</th>
                      <th className="p-2">تاريخ الانتهاء</th>
                      <th className="p-2">الحالي</th>
                      {canManageContracts ? <th className="p-2">إجراءات</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {contracts.map((c) => (
                      <tr
                        key={c.id}
                        className="border-b border-line"
                        data-testid={`contract-row-${c.id}`}
                      >
                        <td className="p-2 font-medium">{c.contract_number}</td>
                        <td className="p-2">{employmentTypeLabel(c.contract_type)}</td>
                        <td className="p-2">
                          <Badge tone={c.status === "active" ? "success" : "neutral"}>
                            {contractStatusLabel(c.status)}
                          </Badge>
                        </td>
                        <td className="p-2">{c.start_date}</td>
                        <td className="p-2">{c.end_date ?? "مستمر"}</td>
                        <td className="p-2">
                          {c.is_current ? (
                            <Badge tone="success" data-testid="contract-current-badge">
                              سارٍ حالياً
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
                                  تفعيل العقد
                                </Button>
                              </ServerActionForm>
                            ) : (
                              <span className="text-xs text-muted">مفعّل</span>
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
            <h2 className="mb-3 font-semibold text-navy">ملخص الراتب الحالي</h2>
            {currentCompensation ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg bg-paper p-3 border border-line">
                  <span className="text-xs text-muted">الراتب الأساسي</span>
                  <p className="text-lg font-bold text-navy" data-testid="comp-current-basic">
                    {currentCompensation.basic_salary.toLocaleString()} {currentCompensation.currency}
                  </p>
                </div>
                <div className="rounded-lg bg-paper p-3 border border-line">
                  <span className="text-xs text-muted">بدل السكن</span>
                  <p className="text-lg font-bold text-navy">
                    {currentCompensation.housing_allowance.toLocaleString()} {currentCompensation.currency}
                  </p>
                </div>
                <div className="rounded-lg bg-paper p-3 border border-line">
                  <span className="text-xs text-muted">بدل النقل</span>
                  <p className="text-lg font-bold text-navy">
                    {currentCompensation.transport_allowance.toLocaleString()} {currentCompensation.currency}
                  </p>
                </div>
                <div className="rounded-lg bg-paper p-3 border border-line">
                  <span className="text-xs text-muted">إجمالي الراتب</span>
                  <p className="text-lg font-bold text-navy" data-testid="comp-total-display">
                    {(
                      Number(currentCompensation.basic_salary) +
                      Number(currentCompensation.housing_allowance) +
                      Number(currentCompensation.transport_allowance) +
                      Number(currentCompensation.other_allowances)
                    ).toLocaleString()}{" "}
                    {currentCompensation.currency}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted" data-testid="comp-no-active">
                لا توجد حزمة راتب نشطة حالياً لهذا الموظف.
              </p>
            )}
          </Card>

          {canManageCompensation ? (
            <Card data-testid="employee-create-comp-version-card">
              <h2 className="mb-3 font-semibold text-navy">إصدار نسخة راتب جديدة (تعديل الراتب والبدلات)</h2>
              <ServerActionForm action={createCompensationVersionAction} className="grid gap-3 md:grid-cols-2">
                <input type="hidden" name="employeeId" value={employee.id} />
                <Field label="تاريخ السريان (Effective From)">
                  <Input
                    name="effective_from"
                    type="date"
                    required
                    data-testid="comp-effective-from"
                  />
                </Field>
                <Field label="العملة">
                  <Input name="currency" defaultValue="SAR" required />
                </Field>
                <Field label="الراتب الأساسي">
                  <Input
                    name="basic_salary"
                    type="number"
                    step="0.01"
                    required
                    placeholder="10000.00"
                    data-testid="comp-basic-input"
                  />
                </Field>
                <Field label="بدل السكن">
                  <Input
                    name="housing_allowance"
                    type="number"
                    step="0.01"
                    defaultValue="0"
                    data-testid="comp-housing-input"
                  />
                </Field>
                <Field label="بدل النقل">
                  <Input
                    name="transport_allowance"
                    type="number"
                    step="0.01"
                    defaultValue="0"
                    data-testid="comp-transport-input"
                  />
                </Field>
                <Field label="بدلات أخرى">
                  <Input name="other_allowances" type="number" step="0.01" defaultValue="0" />
                </Field>
                <div className="md:col-span-2">
                  <Field label="سبب التعديل / القرار">
                    <Input
                      name="change_reason"
                      placeholder="ترقية / تعديل سنوي / تعيين أولي"
                      data-testid="comp-reason-input"
                    />
                  </Field>
                </div>
                <div className="md:col-span-2">
                  <Button type="submit" data-testid="comp-submit">
                    حفظ وإصدار نسخة الراتب
                  </Button>
                </div>
              </ServerActionForm>
            </Card>
          ) : null}

          <Card data-testid="employee-comp-history-card">
            <h2 className="mb-3 font-semibold text-navy">سجل نسخ الراتب التاريخية (غير قابل للتعديل)</h2>
            {compensationVersions.length === 0 ? (
              <p className="text-sm text-muted" data-testid="employee-comp-history-empty">
                لا توجد سجلات تاريخية للرواتب.
              </p>
            ) : (
              <TableScroll>
                <table className="w-full text-right text-sm">
                  <thead>
                    <tr className="border-b border-line text-muted">
                      <th className="p-2">تاريخ البدء</th>
                      <th className="p-2">تاريخ النهاية</th>
                      <th className="p-2">الأساسي</th>
                      <th className="p-2">البدلات</th>
                      <th className="p-2">الإجمالي</th>
                      <th className="p-2">الحالة</th>
                      <th className="p-2">السبب</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compensationVersions.map((v) => (
                      <tr
                        key={v.id}
                        className="border-b border-line"
                        data-testid={`comp-version-row-${v.id}`}
                      >
                        <td className="p-2 font-medium">{v.effective_from}</td>
                        <td className="p-2">{v.effective_to ?? "مفتوح (الحالي)"}</td>
                        <td className="p-2">{v.basic_salary.toLocaleString()} {v.currency}</td>
                        <td className="p-2">
                          {(
                            Number(v.housing_allowance) +
                            Number(v.transport_allowance) +
                            Number(v.other_allowances)
                          ).toLocaleString()}{" "}
                          {v.currency}
                        </td>
                        <td className="p-2 font-bold text-navy">
                          {(
                            Number(v.basic_salary) +
                            Number(v.housing_allowance) +
                            Number(v.transport_allowance) +
                            Number(v.other_allowances)
                          ).toLocaleString()}{" "}
                          {v.currency}
                        </td>
                        <td className="p-2">
                          <Badge tone={v.status === "active" ? "success" : "neutral"}>
                            {COMPENSATION_STATUS_LABELS[v.status]?.ar ?? v.status}
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
              <h2 className="mb-3 font-semibold text-navy">رفع وثيقة خاصة للموظف</h2>
              <ServerActionForm action={uploadEmployeeDocumentAction} className="grid gap-3 md:grid-cols-2">
                <input type="hidden" name="employeeId" value={employee.id} />
                <Field label="عنوان الوثيقة">
                  <Input name="title" required placeholder="عقد العمل الموقع / صورة الجواز" data-testid="hr-doc-title" />
                </Field>
                <Field label="تصنيف الوثيقة">
                  <Select name="category" defaultValue="contract" data-testid="hr-doc-category">
                    {DOCUMENT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {DOCUMENT_CATEGORY_LABELS[c].ar}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="نطاق الظهور والسرية">
                  <Select name="visibility_scope" defaultValue="employee_visible" data-testid="hr-doc-visibility">
                    {VISIBILITY_SCOPES.map((v) => (
                      <option key={v} value={v}>
                        {VISIBILITY_SCOPE_LABELS[v].ar}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="رقم الوثيقة / المرجع">
                  <Input name="document_number" placeholder="رقم الهوية / العقد / الوثيقة" />
                </Field>
                <Field label="تاريخ الإصدار">
                  <Input name="issue_date" type="date" />
                </Field>
                <Field label="تاريخ الانتهاء">
                  <Input name="expiry_date" type="date" />
                </Field>
                <div className="md:col-span-2">
                  <Field label="الملف المرفق (PDF أو صورة)">
                    <input
                      type="file"
                      name="file"
                      required
                      className="w-full text-sm text-muted file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-navy file:text-white hover:file:bg-navy/90"
                      data-testid="hr-doc-file"
                    />
                  </Field>
                </div>
                <div className="md:col-span-2">
                  <Field label="ملاحظات">
                    <Input name="notes" placeholder="ملاحظات إضافية" />
                  </Field>
                </div>
                <div className="md:col-span-2">
                  <Button type="submit" data-testid="hr-doc-submit">
                    رفع وحفظ الوثيقة
                  </Button>
                </div>
              </ServerActionForm>
            </Card>
          ) : null}

          <Card data-testid="employee-documents-card">
            <h2 className="mb-3 font-semibold text-navy">وثائق الموظف المحمية</h2>
            {employeeDocs.length === 0 ? (
              <p className="text-sm text-muted" data-testid="employee-documents-empty">
                لا توجد وثائق مرفوعة لهذا الموظف.
              </p>
            ) : (
              <TableScroll>
                <table className="w-full text-right text-sm">
                  <thead>
                    <tr className="border-b border-line text-muted">
                      <th className="p-2">العنوان</th>
                      <th className="p-2">التصنيف</th>
                      <th className="p-2">نطاق الظهور</th>
                      <th className="p-2">رقم الوثيقة</th>
                      <th className="p-2">تاريخ الانتهاء</th>
                      <th className="p-2">تاريخ الرفع</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employeeDocs.map((d) => (
                      <tr
                        key={d.id}
                        className="border-b border-line"
                        data-testid={`hr-doc-row-${d.id}`}
                      >
                        <td className="p-2 font-medium">{d.documents?.title ?? "وثيقة"}</td>
                        <td className="p-2">{documentCategoryLabel(d.category)}</td>
                        <td className="p-2">
                          <Badge tone="neutral">{visibilityScopeLabel(d.visibility_scope)}</Badge>
                        </td>
                        <td className="p-2">{d.document_number ?? "—"}</td>
                        <td className="p-2">{d.expiry_date ?? "—"}</td>
                        <td className="p-2 text-muted">{new Date(d.created_at).toLocaleDateString("ar-SA")}</td>
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
              <h2 className="mb-3 font-semibold text-navy">إضافة حساب بنكي جديد للموظف</h2>
              <ServerActionForm action={upsertEmployeeBankAction} className="grid gap-3 md:grid-cols-2">
                <input type="hidden" name="employeeId" value={employee.id} />
                <Field label="اسم البنك">
                  <Input
                    name="bank_name"
                    required
                    placeholder="مصرف الراجحي / البنك الأهلي"
                    data-testid="bank-name-input"
                  />
                </Field>
                <Field label="رقم الآيبان (IBAN)">
                  <Input
                    name="iban"
                    required
                    placeholder="SA0380000000608010167519"
                    data-testid="bank-iban-input"
                  />
                </Field>
                <Field label="اسم صاحب الحساب">
                  <Input
                    name="account_name"
                    required
                    defaultValue={(profile as { full_name_ar?: string } | null)?.full_name_ar ?? ""}
                    data-testid="bank-account-name-input"
                  />
                </Field>
                <Field label="كود السويفت (SWIFT Code - اختياري)">
                  <Input name="swift_code" placeholder="RJHISARI" />
                </Field>
                <div className="md:col-span-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="is_primary" defaultChecked value="true" />
                    تعيين كحساب أساسي لتحويل الراتب
                  </label>
                </div>
                <div className="md:col-span-2">
                  <Button type="submit" data-testid="bank-submit">
                    حفظ الحساب البنكي
                  </Button>
                </div>
              </ServerActionForm>
            </Card>
          ) : null}

          <Card data-testid="employee-banking-card">
            <h2 className="mb-3 font-semibold text-navy">الحسابات البنكية المسجلة</h2>
            {bankAccounts.length === 0 ? (
              <p className="text-sm text-muted" data-testid="employee-banking-empty">
                لا توجد حسابات بنكية مسجلة لهذا الموظف.
              </p>
            ) : (
              <TableScroll>
                <table className="w-full text-right text-sm">
                  <thead>
                    <tr className="border-b border-line text-muted">
                      <th className="p-2">البنك</th>
                      <th className="p-2">الآيبان</th>
                      <th className="p-2">اسم الحساب</th>
                      <th className="p-2">النوع</th>
                      <th className="p-2">الحالة</th>
                      {canManageBanking ? <th className="p-2">إجراءات</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {bankAccounts.map((b) => (
                      <tr
                        key={b.id}
                        className="border-b border-line"
                        data-testid={`bank-row-${b.id}`}
                      >
                        <td className="p-2 font-medium">{b.bank_name}</td>
                        <td className="p-2 font-mono" data-testid={`bank-iban-${b.id}`}>
                          {b.iban ? b.iban : b.masked_iban || maskIban(b.iban)}
                        </td>
                        <td className="p-2">{b.account_name}</td>
                        <td className="p-2">
                          {b.is_primary ? (
                            <Badge tone="success">الأساسي</Badge>
                          ) : (
                            <span className="text-muted">فرعي</span>
                          )}
                        </td>
                        <td className="p-2">
                          <Badge tone={b.is_active ? "success" : "danger"}>
                            {b.is_active ? "نشط" : "موقوف"}
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
                                  إيقاف الحساب
                                </Button>
                              </ServerActionForm>
                            ) : (
                              <span className="text-xs text-muted">موقوف</span>
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
          <h2 className="mb-3 font-semibold text-navy">عضوية المشاريع</h2>
          <p className="mb-3 text-sm text-muted">
            المصدر المعتمد للوصول للمشاريع هو <code>project_members</code>. تظهر
            المشاريع التي تملك صلاحية الوصول إليها فقط (دون توسيع صلاحيات الوثائق).
          </p>
          {projects.length === 0 ? (
            <p className="text-sm text-muted" data-testid="employee-projects-empty">
              لا توجد عضويات نشطة ضمن نطاق وصولك للمشاريع.
            </p>
          ) : (
            <ul className="grid gap-2 text-sm" data-testid="employee-projects-list">
              {projects.map((p) => {
                const proj = p.projects as {
                  id?: string;
                  project_code?: string;
                  name_ar?: string;
                  status?: string;
                } | null;
                return (
                  <li
                    key={p.id}
                    className="flex items-center justify-between border-b border-line pb-2"
                  >
                    <span>
                      {proj?.name_ar} ({proj?.project_code})
                    </span>
                    <Badge tone="neutral">{p.role_label ?? "عضو"}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ) : null}

      {tab === "activity" && canManage ? (
        <Card data-testid="employee-activity-card">
          <h2 className="mb-3 font-semibold text-navy">سجل العمليات</h2>
          {audit.length === 0 ? (
            <p className="text-sm text-muted">لا يوجد نشاط مسجل.</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {audit.map((a) => (
                <li key={a.id} className="flex justify-between gap-3 border-b border-line pb-1">
                  <span className="min-w-0 font-medium text-navy">{auditActionLabel(a.action)}</span>
                  <span className="shrink-0 text-muted">{new Date(a.created_at).toLocaleString("ar-SA")}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {canManage ? (
        <section className="rounded-[var(--radius-surface)] border border-danger/20 bg-danger/5 p-4 md:p-5">
          <h2 className="text-sm font-semibold text-danger">إجراء حساس</h2>
          <p className="mt-1 mb-3 text-xs text-muted">
            إيقاف الموظف يؤثر على الدخول التشغيلي وفق القواعد الحالية. لا يُنفَّذ إلا بصلاحية الإدارة.
          </p>
          <ServerActionForm action={setEmployeeActiveAction}>
            <input type="hidden" name="employeeId" value={employee.id} />
            <input type="hidden" name="isActive" value={(!employee.is_active).toString()} />
            <Button
              type="submit"
              variant={employee.is_active ? "danger" : "secondary"}
              data-testid="employee-toggle-active"
            >
              {employee.is_active ? "إيقاف الموظف (Deactivate)" : "تنشيط الموظف (Reactivate)"}
            </Button>
          </ServerActionForm>
        </section>
      ) : null}
    </PageContainer>
  );
}
