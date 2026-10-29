import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, EmptyState, PageHeader } from "@/components/ui/primitives";
import { resolveNotificationHref } from "@/lib/notifications/href";
import { NotificationNavLink } from "@/components/notifications/notification-nav-link";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { CoreRepository } from "@/server/repositories/core.repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { markNotificationReadAction } from "@/server/use-cases/platform";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { intlLocale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

function notificationAccent(type: string, priority: string): "info" | "success" | "warning" | "danger" {
  if (priority === "urgent" || priority === "high") return "danger";
  const t = type.toLowerCase();
  if (t.includes("overdue") || t.includes("reject")) return "danger";
  if (t.includes("deadline") || t.includes("warning") || t.includes("due")) return "warning";
  if (t.includes("approv")) return "warning";
  if (t.includes("complete") || t.includes("success")) return "success";
  return "info";
}

export default async function NotificationsPage() {
  const ctx = await getAuthContext();
  if (!ctx || !hasPermission(ctx, "notification.read")) redirect("/login");

  const supabase = await createServerSupabaseClient();
  const repo = new CoreRepository(supabase);
  const notifications = await repo.listNotifications(ctx.userId);
  const { t, locale } = await getI18n();
  const tn = t.workspace.notifications;
  const priorityLabel = (priority: string) =>
    (tn.priorities as Record<string, string>)[priority] ?? priority;

  return (
    <PageContainer data-testid="notifications-page" className="space-y-5">
      <PageHeader
        title={tn.title}
        description={tn.description}
        actions={
          <Link href="/notifications/preferences" className="inline-flex min-h-10 items-center rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm font-medium text-primary hover:bg-surface-muted">
            {tn.preferencesLink}
          </Link>
        }
      />

      {notifications.length === 0 ? (
        <EmptyState title={tn.empty} />
      ) : (
        <div className="mt-surface divide-y divide-line overflow-hidden">
          {notifications.map((item) => {
            const href = resolveNotificationHref({
              type: item.type,
              entityType: item.entity_type,
              entityId: item.entity_id,
              storedHref: item.href,
              dedupKey: item.dedup_key,
            });
            const accent = notificationAccent(item.type, item.priority);
            return (
            <div
              key={item.id}
              className={item.read_at ? "bg-surface px-4 py-3" : "bg-primary-soft/60 px-4 py-3"}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className={
                        accent === "danger"
                          ? "h-1.5 w-1.5 shrink-0 rounded-full bg-danger"
                          : accent === "warning"
                            ? "h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
                            : accent === "success"
                              ? "h-1.5 w-1.5 shrink-0 rounded-full bg-success"
                              : "h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                      }
                      aria-hidden
                    />
                    <h2 className="text-sm font-semibold text-ink">{item.title}</h2>
                    <Badge tone={accent === "info" ? "info" : accent}>
                      {priorityLabel(item.priority)}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted">{item.message}</p>
                  <p className="mt-2 text-xs text-muted">
                    {item.type} ·{" "}
                    {new Date(item.created_at).toLocaleString(intlLocale(locale), { timeZone: "Asia/Riyadh" })}
                  </p>
                  {href ? (
                    <NotificationNavLink
                      id={item.id}
                      href={href}
                      unread={!item.read_at}
                      className="mt-2 inline-block text-sm font-medium text-primary"
                    >
                      {tn.openRecord}
                    </NotificationNavLink>
                  ) : null}
                </div>
                {!item.read_at ? (
                  <ServerActionForm action={markNotificationReadAction}>
                    <input type="hidden" name="id" value={item.id} />
                    <Button type="submit" variant="secondary">
                      {tn.markRead}
                    </Button>
                  </ServerActionForm>
                ) : null}
              </div>
            </div>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
