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
import { format } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

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
  const { t } = await getI18n();
  const tp = t.workspace.preferences;

  return (
    <PageContainer data-testid="notification-preferences" className="space-y-5">
      <PageHeader
        title={tp.title}
        description={tp.description}
      />
      <Card data-testid="whatsapp-operational-opt-in">
        <h2 className="mb-2 font-semibold text-ink">{tp.whatsappTitle}</h2>
        <p className="mb-3 text-sm text-muted">
          {tp.whatsappBody}
        </p>
        <ServerActionForm action={saveOwnContactPhoneAction} className="mb-4 max-w-md space-y-3">
          <Field label={tp.phone} hint={hasValidPhone && phone ? format(tp.savedPhone, { phone: maskE164(phone) }) : tp.phoneRequired}>
            <Input name="phone" type="tel" dir="ltr" defaultValue={phone ?? ""} autoComplete="tel" />
          </Field>
          <Button type="submit">{tp.savePhone}</Button>
        </ServerActionForm>
        {hasValidPhone ? (
          <ServerActionForm action={saveWhatsAppOptInAction}>
            <input type="hidden" name="whatsapp_opt_in" value={optIn ? "false" : "true"} />
            <Button type="submit" variant={optIn ? "primary" : "secondary"} data-testid="whatsapp-opt-in-toggle">
              {optIn ? tp.whatsappOn : tp.whatsappEnable}
            </Button>
          </ServerActionForm>
        ) : (
          <p className="text-sm text-muted" data-testid="whatsapp-opt-in-blocked">
            {tp.phoneRequired}
          </p>
        )}
      </Card>
      {!hubReady ? (
        <EmptyState
          title={tp.hubNotReadyTitle}
          description={tp.hubNotReadyBody}
        />
      ) : (
        <Card className="mb-6 p-0">
          <TableScroll>
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-surface-muted text-muted">
              <tr>
                <th className="px-3 py-2 text-start font-medium">{tp.category}</th>
                {NOTIFICATION_CHANNELS.map((ch) => (
                  <th key={ch} className="px-3 py-2 text-start font-medium">
                    {tp.channels[ch]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {NOTIFICATION_CATEGORIES.map((category) => (
                <tr key={category} className="border-t border-line">
                  <td className="px-3 py-3 font-medium text-ink">{tp.categories[category]}</td>
                  {NOTIFICATION_CHANNELS.map((channel) => {
                    const enabled = prefs.get(`${category}:${channel}`) ?? (channel === "in_app" || (channel === "email" && (category === "APPROVALS" || category === "WORK")));
                    return (
                      <td key={channel} className="px-3 py-3">
                        <ServerActionForm action={saveNotificationPreferenceAction}>
                          <input type="hidden" name="category" value={category} />
                          <input type="hidden" name="channel" value={channel} />
                          <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
                          <Button type="submit" variant={enabled ? "primary" : "secondary"} className="min-h-9 px-2 text-xs">
                            {enabled ? tp.on : tp.off}
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
        <h2 className="mb-2 font-semibold text-ink">{tp.deviceTitle}</h2>
        <p className="mb-3 text-sm text-muted">{tp.deviceBody}</p>
        <PushOptInButton vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null} />
        <Badge className="mt-3" tone="neutral">
          {tp.vapidNote}
        </Badge>
      </Card>
    </PageContainer>
  );
}
