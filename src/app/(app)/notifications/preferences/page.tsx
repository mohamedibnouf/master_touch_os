import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NOTIFICATION_CATEGORIES, NOTIFICATION_CHANNELS } from "@/modules/notifications/catalog";
import { saveNotificationPreferenceAction } from "@/server/use-cases/notification-preferences";
import { PushOptInButton } from "@/components/notifications/push-opt-in";
import { ServerActionForm } from "@/components/forms/server-action-form";

export default async function NotificationPreferencesPage() {
  const ctx = await getAuthContext();
  if (!ctx || !hasPermission(ctx, "notification.read")) redirect("/login");

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("notification_preferences")
    .select("category, channel, enabled")
    .eq("organization_id", ctx.organization.id)
    .eq("profile_id", ctx.userId);

  const hubReady = !error;
  const prefs = new Map((data ?? []).map((p) => [`${p.category}:${p.channel}`, p.enabled as boolean]));

  return (
    <div data-testid="notification-preferences">
      <PageHeader
        title="تفضيلات التنبيه"
        description="التحكم بالقنوات لا يلغي صلاحياتك. التنبيه داخل التطبيق إلزامي للعمل والموافقات والرواتب."
      />
      {!hubReady ? (
        <EmptyState
          title="مركز القنوات غير مفعّل بعد"
          description="سيتم تفعيل التفضيلات واشتراك الأجهزة بعد مراجعة وتطبيق الترحيل 062."
        />
      ) : (
        <Card className="mb-6 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="text-muted">
              <tr>
                <th className="px-2 py-2 text-right">الفئة</th>
                {NOTIFICATION_CHANNELS.map((ch) => (
                  <th key={ch} className="px-2 py-2 text-right">
                    {ch}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {NOTIFICATION_CATEGORIES.map((category) => (
                <tr key={category} className="border-t border-line">
                  <td className="px-2 py-3 font-medium">{category}</td>
                  {NOTIFICATION_CHANNELS.map((channel) => {
                    const enabled = prefs.get(`${category}:${channel}`) ?? (channel === "in_app" || (channel === "email" && (category === "APPROVALS" || category === "WORK")));
                    return (
                      <td key={channel} className="px-2 py-3">
                        <ServerActionForm action={saveNotificationPreferenceAction}>
                          <input type="hidden" name="category" value={category} />
                          <input type="hidden" name="channel" value={channel} />
                          <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
                          <Button type="submit" variant={enabled ? "primary" : "secondary"} className="min-h-9 px-2 text-xs">
                            {enabled ? "تشغيل" : "إيقاف"}
                          </Button>
                        </ServerActionForm>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card>
        <h2 className="mb-2 font-semibold text-navy">إشعارات الجهاز (PWA)</h2>
        <p className="mb-3 text-sm text-muted">لا يُطلب الإذن تلقائياً. اضغط فقط إذا رغبت بتلقي تنبيهات على هذا الجهاز.</p>
        <PushOptInButton vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null} />
        <Badge className="mt-3" tone="neutral">
          Web Push يحتاج مفاتيح VAPID بعد تطبيق 062
        </Badge>
      </Card>
    </div>
  );
}
