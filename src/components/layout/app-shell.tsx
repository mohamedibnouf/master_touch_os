import { Suspense } from "react";
import type { AuthContext } from "@/types/models";
import { can } from "@/lib/permissions/evaluate";
import { CoreRepository } from "@/server/repositories/core.repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import type { AppNavFlags } from "./nav-flags";
import { AppShellFrame } from "./app-shell-frame";
import { HeaderNotifications } from "./header-notifications";

function HeaderBellFallback() {
  return (
    <div
      className="mt-icon-btn animate-pulse"
      aria-hidden
      data-testid="header-notifications-loading"
    />
  );
}

async function HeaderNotificationsLoader({ userId }: { userId: string }) {
  let unreadCount = 0;
  let notices: Awaited<ReturnType<CoreRepository["listHeaderNotifications"]>>["notices"] = [];
  try {
    const supabase = await createServerSupabaseClient();
    const repo = new CoreRepository(supabase);
    const loaded = await repo.listHeaderNotifications(userId);
    unreadCount = loaded.unreadCount;
    notices = loaded.notices;
  } catch (error) {
    logger.error("header notifications failed", {
      code: isAppError(error) ? error.code : null,
    });
  }
  return <HeaderNotifications unreadCount={unreadCount} items={notices} />;
}

export async function AppShell({
  ctx,
  children,
}: {
  ctx: AuthContext;
  children: React.ReactNode;
}) {
  const orgCtx = { organizationId: ctx.organization.id };
  const g = (key: Parameters<typeof can>[1]) => can(ctx.grants, key, orgCtx);

  const flags: AppNavFlags = {
    employees: g("employee.read") || g("employee.manage") || g("employee.create") || g("department.update"),
    departments: g("department.read"),
    leave:
      g("leave.view_self") ||
      g("leave.request") ||
      g("leave.view_team") ||
      g("leave.view_all") ||
      g("leave.manage"),
    attendance:
      g("attendance.view_self") ||
      g("attendance.check_in") ||
      g("attendance.view_team") ||
      g("attendance.view_all") ||
      g("attendance.manage"),
    payroll:
      g("payroll.view_all") ||
      g("payroll.prepare") ||
      g("payroll.review") ||
      g("payroll.approve") ||
      g("payroll.record_payment") ||
      g("payroll.calculate") ||
      g("payroll.adjust") ||
      g("payroll.manage_settings"),
    payslips: g("payroll.view_self") || g("payroll.view_all"),
    hrLeave: g("leave.manage") || g("leave.view_all"),
    hrAttendance: g("attendance.manage") || g("attendance.view_all"),
    management: g("reports.management.read"),
    projects: true,
    engineering: g("engineering.read"),
    documentControl: g("document_control.read") || g("document.approve"),
    documents: g("document.read"),
    procurement:
      g("purchase_request.read") || g("rfq.read") || g("purchase_order.read") || g("supplier.read"),
    finance: g("finance.read") || g("supplier_invoice.read") || g("client_invoice.read"),
    approvals: g("approval.review") || g("approval.approve"),
    notifications: g("notification.read"),
    search: g("document.read") || g("project.read") || g("purchase_request.read"),
    settings: g("user.read") || g("settings.manage"),
    roles: g("role.manage") || g("role.read"),
    analyst: g("reports.management.read"),
    tasks: g("task.read"),
  };

  const { locale, t } = await getI18n();
  const organizationName = pickLocalized(locale, ctx.organization.name_ar, ctx.organization.name_en);

  return (
    <AppShellFrame
      organizationName={organizationName}
      organizationNameAlt={locale === "ar" ? ctx.organization.name_en : ctx.organization.name_ar}
      userName={pickLocalized(locale, ctx.profile.full_name_ar, ctx.profile.full_name_en) || t.common.user}
      jobTitle={
        pickLocalized(locale, ctx.employee?.job_title_ar, ctx.employee?.job_title_en) || t.shell.operationalAccount
      }
      flags={flags}
      notificationsSlot={
        flags.notifications ? (
          <Suspense fallback={<HeaderBellFallback />}>
            <HeaderNotificationsLoader userId={ctx.userId} />
          </Suspense>
        ) : null
      }
    >
      {children}
    </AppShellFrame>
  );
}
