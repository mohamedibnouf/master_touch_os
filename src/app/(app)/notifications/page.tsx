import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { notificationEntityHref } from "@/lib/notifications/href";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { CoreRepository } from "@/server/repositories/core.repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { markNotificationReadAction } from "@/server/use-cases/platform";
import { ServerActionForm } from "@/components/forms/server-action-form";

export default async function NotificationsPage() {
  const ctx = await getAuthContext();
  if (!ctx || !hasPermission(ctx, "notification.read")) redirect("/login");

  const supabase = await createServerSupabaseClient();
  const repo = new CoreRepository(supabase);
  const notifications = await repo.listNotifications(ctx.userId);

  return (
    <div data-testid="notifications-page">
      <PageHeader
        title="التنبيهات"
        description="القناة الداخلية المعتمدة. البريد وواتساب والجهاز تُدار من التفضيلات بعد ترحيل 062."
        actions={
          <Link href="/notifications/preferences" className="text-sm text-navy underline">
            التفضيلات وإشعارات الجهاز
          </Link>
        }
      />

      {notifications.length === 0 ? (
        <EmptyState title="لا توجد تنبيهات." />
      ) : (
        <div className="space-y-3">
          {notifications.map((item) => {
            const href = notificationEntityHref(item.entity_type, item.entity_id);
            return (
            <Card key={item.id} className={item.read_at ? "opacity-70" : undefined}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-navy">{item.title}</h2>
                    <Badge
                      tone={
                        item.priority === "urgent" || item.priority === "high" ? "danger" : "neutral"
                      }
                    >
                      {item.priority}
                    </Badge>
                    {!item.read_at ? <Badge tone="navy">جديد</Badge> : null}
                  </div>
                  <p className="text-sm text-muted">{item.message}</p>
                  <p className="mt-2 text-xs text-muted">
                    {item.type} ·{" "}
                    {new Date(item.created_at).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })}
                  </p>
                  {href ? (
                    <Link href={href} className="mt-2 inline-block text-sm text-navy underline">
                      فتح السجل المرتبط
                    </Link>
                  ) : null}
                </div>
                {!item.read_at ? (
                  <ServerActionForm action={markNotificationReadAction}>
                    <input type="hidden" name="id" value={item.id} />
                    <Button type="submit" variant="secondary">
                      تعليم كمقروء
                    </Button>
                  </ServerActionForm>
                ) : null}
              </div>
            </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
