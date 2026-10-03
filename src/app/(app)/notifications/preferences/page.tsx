import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NOTIFICATION_CATEGORIES, NOTIFICATION_CHANNELS } from "@/modules/notifications/catalog";
import {
  saveNotificationPreferenceAction,
  saveOwnContactPhoneAction,
  saveWhatsAppOptInAction,
} from "@/server/use-cases/notification-preferences";
import { PushOptInButton } from "@/components/notifications/push-opt-in";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { isValidE164, maskE164 } from "@/lib/phone/e164";

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

  const { data: contact } = await supabase
    .from("profiles")
    .select("phone, whatsapp_opt_in")
    .eq("id", ctx.userId)
    .maybeSingle<{ phone: string | null; whatsapp_opt_in: boolean }>();
  const phone = contact?.phone ?? null;
  const hasValidPhone = Boolean(phone && isValidE164(phone));
  const optIn = contact?.whatsapp_opt_in === true;

  return (
    <PageContainer data-testid="notification-preferences" className="space-y-5">
      <PageHeader
        title="تفضيلات التنبيه"
        description="التحكم بالقنوات لا يلغي صلاحياتك. التنبيه داخل التطبيق إلزامي للعمل والموافقات والرواتب. واتساب التشغيلي يتطلب موافقة صريحة بالإضافة إلى تفضيل الفئة."
      />
      <Card data-testid="whatsapp-operational-opt-in">
        <h2 className="mb-2 font-semibold text-navy">إشعارات واتساب التشغيلية</h2>
        <p className="mb-3 text-sm text-muted">
          موافقة تشغيلية فقط — ليست تسويقاً. لا تُفعَّل تلقائياً. يلزم رقم جوال صالح وتفضيل الفئة ومزوّد مفعّل لاحقاً.
        </p>
        <ServerActionForm action={saveOwnContactPhoneAction} className="mb-4 max-w-md space-y-3">
          <Field label="رقم الجوال" hint={hasValidPhone && phone ? `المحفوظ: ${maskE164(phone)}` : "أضف رقم جوال صالحاً أولاً لتفعيل إشعارات واتساب."}>
            <Input name="phone" type="tel" dir="ltr" defaultValue={phone ?? ""} autoComplete="tel" />
          </Field>
          <Button type="submit">حفظ الرقم</Button>
        </ServerActionForm>
        {hasValidPhone ? (
          <ServerActionForm action={saveWhatsAppOptInAction}>
            <input type="hidden" name="whatsapp_opt_in" value={optIn ? "false" : "true"} />
            <Button type="submit" variant={optIn ? "primary" : "secondary"} data-testid="whatsapp-opt-in-toggle">
              {optIn ? "واتساب التشغيلي: مفعّل" : "تفعيل واتساب التشغيلي"}
            </Button>
          </ServerActionForm>
        ) : (
          <p className="text-sm text-muted" data-testid="whatsapp-opt-in-blocked">
            أضف رقم جوال صالحاً أولاً لتفعيل إشعارات واتساب.
          </p>
        )}
      </Card>
      {!hubReady ? (
        <EmptyState
          title="مركز القنوات غير مفعّل بعد"
          description="سيتم تفعيل التفضيلات واشتراك الأجهزة بعد مراجعة وتطبيق الترحيل 062."
        />
      ) : (
        <Card className="mb-6 p-0">
          <TableScroll>
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
          </TableScroll>
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
    </PageContainer>
  );
}
