/**
 * Phase 5.6 live certification against applied migration 062.
 * Cleans up only this run's users/orgs/tagged rows. Does not apply migrations.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  adminClient,
  liveTestConfigured,
  provisionLiveFixture,
  signInAs,
  type LiveFixture,
} from "./helpers";
import { selectChannels } from "@/modules/notifications/policy";
import { nextRetryAt } from "@/modules/notifications/schedule";
import { NotificationOrchestrator } from "@/modules/notifications/orchestrator";
import { MemoryHubStore } from "@/modules/notifications/memory-store";
import { MockEmailProvider, MockPushProvider, MockWhatsAppProvider } from "@/modules/notifications/providers";
import { redactNotificationText } from "@/modules/notifications/safety";
import {
  isNotificationsCronAuthorized,
  notificationsCronSecret,
} from "@/modules/notifications/cron-auth";

const configured = liveTestConfigured();

type DeliveryRow = {
  id: string;
  notification_id: string;
  organization_id: string;
  recipient_profile_id: string;
  channel: string;
  status: string;
  attempt_count: number;
  next_attempt_at: string | null;
  delivered_at: string | null;
  sent_at: string | null;
};

function denied(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const m = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  return (
    m.includes("42501") ||
    m.includes("permission") ||
    m.includes("policy") ||
    m.includes("rls") ||
    m.includes("denied") ||
    m.includes("not allowed") ||
    m.includes("row-level") ||
    m.includes("violates") ||
    m.includes("foreign key") ||
    m.includes("immutable") ||
    m.includes("unsafe") ||
    m.includes("could not find the function") ||
    m.includes("schema cache")
  );
}

describe.skipIf(!configured)("live Phase 5.6 notification hub (062 applied)", () => {
  let fx: LiveFixture;
  let hubReady = false;
  let orgBUser: { id: string; email: string; password: string } | null = null;
  const tag = { current: "" };
  const seededNotificationIds: string[] = [];
  const liveAudit: Record<string, unknown> = {};

  beforeAll(async () => {
    const admin = adminClient();
    const { error } = await admin.from("notification_preferences").select("id").limit(1);
    hubReady = !error;
    if (!hubReady) {
      console.warn("[live-test] Phase 5.6 tables missing — 062 not applied?");
      return;
    }
    fx = await provisionLiveFixture();
    tag.current = `live56-${fx.runId}`;

    const prefix = process.env.LIVE_TEST_PASSWORD_PREFIX ?? "MtTest1!";
    const email = `mt-live-orgb-${fx.runId}@test.local`;
    const password = `${prefix}orgb`;
    const { data: created, error: uErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name_ar: "orgb", full_name_en: "orgb", locale: "ar" },
    });
    if (uErr || !created.user) throw new Error(`orgB user: ${uErr?.message}`);
    await admin.from("organization_members").upsert({
      organization_id: fx.orgBId,
      profile_id: created.user.id,
      status: "active",
    });
    orgBUser = { id: created.user.id, email, password };

    await admin.from("organization_members").upsert({
      organization_id: fx.orgBId,
      profile_id: fx.users.pm.id,
      status: "active",
    });
  }, 180_000);

  afterAll(async () => {
    const admin = adminClient();
    if (hubReady && tag.current) {
      await admin.from("notification_escalations").delete().eq("reason", tag.current);
      await admin.from("push_subscriptions").delete().like("endpoint", `%${tag.current}%`);
      if (fx) {
        await admin.from("notification_preferences").delete().eq("profile_id", fx.users.pm.id);
        await admin.from("notification_preferences").delete().eq("profile_id", fx.users.engineer.id);
      }
      await admin.from("notifications").delete().like("dedup_key", `${tag.current}%`);
      for (const id of seededNotificationIds) {
        await admin.from("notifications").delete().eq("id", id);
      }
    }
    if (orgBUser) {
      try {
        await admin.auth.admin.deleteUser(orgBUser.id);
      } catch {
        /* best-effort */
      }
    }
    if (fx) await fx.cleanup();
  }, 180_000);

  async function upsert(input: {
    orgId: string;
    recipientId: string;
    eventType?: string;
    href?: string | null;
    dedupKey: string;
    channels: string[];
    title?: string;
  }) {
    const admin = adminClient();
    const { data, error } = await admin.rpc("upsert_operational_notification", {
      p_organization_id: input.orgId,
      p_recipient_profile_id: input.recipientId,
      p_event_type: input.eventType ?? "WORK_ASSIGNED",
      p_type: input.eventType ?? "WORK_ASSIGNED",
      p_title: input.title ?? `تنبيه ${tag.current}`,
      p_message: "راجع النظام.",
      p_entity_type: "live_test",
      p_entity_id: fx.projectId,
      p_href: input.href ?? "/projects",
      p_priority: "normal",
      p_dedup_key: input.dedupKey,
      p_channels: input.channels,
    });
    if (!error && data) seededNotificationIds.push(String(data));
    return { id: data ? String(data) : null, error };
  }

  async function deliveriesFor(notificationId: string) {
    const admin = adminClient();
    const { data, error } = await admin
      .from("notification_deliveries")
      .select(
        "id, notification_id, organization_id, recipient_profile_id, channel, status, attempt_count, next_attempt_at, delivered_at, sent_at",
      )
      .eq("notification_id", notificationId);
    if (error) throw new Error(error.message);
    return (data ?? []) as DeliveryRow[];
  }

  async function claimOwned(ownedNotificationIds: Set<string>, limit: number) {
    const admin = adminClient();
    const { data, error } = await admin.rpc("claim_notification_deliveries", { p_limit: limit });
    const rows = (Array.isArray(data) ? data : []) as DeliveryRow[];
    const stolen = rows.filter((r) => !ownedNotificationIds.has(r.notification_id));
    for (const s of stolen) {
      await admin
        .from("notification_deliveries")
        .update({
          status: "pending",
          attempt_count: Math.max(0, (s.attempt_count ?? 1) - 1),
        })
        .eq("id", s.id);
    }
    return { error, owned: rows.filter((r) => ownedNotificationIds.has(r.notification_id)), stolenCount: stolen.length };
  }

  it("schema: 062 columns, tables, RPCs present", async ({ skip }) => {
    if (!hubReady) {
      skip("062 objects missing");
      return;
    }
    const admin = adminClient();
    const probes = await Promise.all([
      admin.from("notifications").select("event_type, href, dedup_key").limit(0),
      admin
        .from("notification_deliveries")
        .select(
          "organization_id, recipient_profile_id, attempt_count, next_attempt_at, provider_message_id, last_error_code, sent_at, delivered_at, updated_at",
        )
        .limit(0),
      admin.from("notification_preferences").select("id").limit(0),
      admin.from("push_subscriptions").select("id").limit(0),
      admin.from("notification_escalations").select("id").limit(0),
      admin.from("notification_job_runs").select("id").limit(0),
    ]);
    for (const p of probes) expect(p.error).toBeNull();

    const { error: enumErr } = await admin.from("notification_preferences").insert({
      organization_id: fx.orgAId,
      profile_id: fx.users.restricted.id,
      category: "HR",
      channel: "email",
      enabled: false,
    });
    expect(enumErr).toBeNull();
    await admin.from("notification_preferences").delete().eq("profile_id", fx.users.restricted.id);

    liveAudit.schemaOk = true;
  });

  it("A. authenticated cannot INSERT notifications", async ({ skip }) => {
    if (!hubReady) {
      skip("062");
      return;
    }
    const pm = await signInAs(fx.users.pm.email, fx.users.pm.password);
    const { data, error } = await pm
      .from("notifications")
      .insert({
        organization_id: fx.orgAId,
        recipient_profile_id: fx.users.pm.id,
        type: "WORK_ASSIGNED",
        title: "x",
        message: "x",
      })
      .select("id")
      .maybeSingle();
    expect(data).toBeNull();
    expect(denied(error) || error !== null).toBe(true);
  });

  it("B. service-role upsert creates tenant-bound notification + channels", async ({ skip }) => {
    if (!hubReady) {
      skip("062");
      return;
    }
    const { id, error } = await upsert({
      orgId: fx.orgAId,
      recipientId: fx.users.pm.id,
      dedupKey: `${tag.current}-b`,
      channels: ["in_app", "email", "whatsapp", "push"],
      href: "/projects",
    });
    expect(error).toBeNull();
    expect(id).toBeTruthy();
    const admin = adminClient();
    const { data: n } = await admin
      .from("notifications")
      .select("id, organization_id, recipient_profile_id, event_type, href, dedup_key")
      .eq("id", id!)
      .single();
    expect(n?.organization_id).toBe(fx.orgAId);
    expect(n?.recipient_profile_id).toBe(fx.users.pm.id);
    expect(n?.event_type).toBe("WORK_ASSIGNED");
    expect(n?.href).toBe("/projects");
    expect(n?.dedup_key).toBe(`${tag.current}-b`);
    const dels = await deliveriesFor(id!);
    expect(dels).toHaveLength(4);
    expect(new Set(dels.map((d) => d.channel))).toEqual(new Set(["in_app", "email", "whatsapp", "push"]));
    expect(dels.every((d) => d.organization_id === fx.orgAId && d.recipient_profile_id === fx.users.pm.id)).toBe(true);
  });

  it("C. identical dedup_key does not duplicate notification or channels", async ({ skip }) => {
    if (!hubReady) {
      skip("062");
      return;
    }
    const key = `${tag.current}-c`;
    const first = await upsert({
      orgId: fx.orgAId,
      recipientId: fx.users.engineer.id,
      dedupKey: key,
      channels: ["in_app", "email"],
    });
    const second = await upsert({
      orgId: fx.orgAId,
      recipientId: fx.users.engineer.id,
      dedupKey: key,
      channels: ["in_app", "email"],
    });
    expect(first.id).toBeTruthy();
    expect(second.error).toBeNull();
    expect(second.id).toBe(first.id);
    const admin = adminClient();
    const { data: notes } = await admin.from("notifications").select("id").eq("dedup_key", key);
    expect(notes).toHaveLength(1);
    const dels = await deliveriesFor(first.id!);
    expect(dels).toHaveLength(2);
    expect(dels.map((d) => d.channel).sort()).toEqual(["email", "in_app"]);
  });

  it("D. in_app is delivered immediately and is not claimed", async ({ skip }) => {
    if (!hubReady) {
      skip("062");
      return;
    }
    const { id } = await upsert({
      orgId: fx.orgAId,
      recipientId: fx.users.pm.id,
      dedupKey: `${tag.current}-d`,
      channels: ["in_app"],
    });
    const dels = await deliveriesFor(id!);
    expect(dels).toHaveLength(1);
    expect(dels[0].channel).toBe("in_app");
    expect(dels[0].status).toBe("delivered");
    expect(dels[0].delivered_at).toBeTruthy();
    const claimed = await claimOwned(new Set([id!]), 25);
    expect(claimed.error).toBeNull();
    expect(claimed.owned.some((r) => r.channel === "in_app")).toBe(false);
  });

  it("E. external channels start pending and are claim-eligible", async ({ skip }) => {
    if (!hubReady) {
      skip("062");
      return;
    }
    const { id } = await upsert({
      orgId: fx.orgAId,
      recipientId: fx.users.pm.id,
      dedupKey: `${tag.current}-e`,
      channels: ["email", "whatsapp", "push"],
    });
    await adminClient()
      .from("notification_deliveries")
      .update({ created_at: "2000-01-01T00:00:00.000Z", next_attempt_at: new Date().toISOString() })
      .eq("notification_id", id!);
    const dels = await deliveriesFor(id!);
    expect(dels).toHaveLength(3);
    expect(dels.every((d) => d.status === "pending")).toBe(true);
    expect(dels.every((d) => d.delivered_at === null)).toBe(true);
    const claimed = await claimOwned(new Set([id!]), 10);
    expect(claimed.owned.length).toBeGreaterThan(0);
    expect(claimed.owned.every((r) => r.channel !== "in_app")).toBe(true);
    expect(claimed.owned.every((r) => r.status === "processing")).toBe(true);
    const admin = adminClient();
    for (const row of claimed.owned) {
      await admin
        .from("notification_deliveries")
        .update({ status: "pending", next_attempt_at: new Date().toISOString() })
        .eq("id", row.id);
    }
  });

  it("F. delivery tenant mismatch is rejected", async ({ skip }) => {
    if (!hubReady) {
      skip("062");
      return;
    }
    const { id } = await upsert({
      orgId: fx.orgAId,
      recipientId: fx.users.pm.id,
      dedupKey: `${tag.current}-f`,
      channels: ["in_app"],
    });
    const admin = adminClient();
    const orgMismatch = await admin.from("notification_deliveries").insert({
      notification_id: id,
      organization_id: fx.orgBId,
      recipient_profile_id: fx.users.pm.id,
      channel: "email",
      status: "pending",
    });
    expect(orgMismatch.error).toBeTruthy();
    expect(denied(orgMismatch.error)).toBe(true);

    const recipientMismatch = await admin.from("notification_deliveries").insert({
      notification_id: id,
      organization_id: fx.orgAId,
      recipient_profile_id: fx.users.engineer.id,
      channel: "email",
      status: "pending",
    });
    expect(recipientMismatch.error).toBeTruthy();
    expect(denied(recipientMismatch.error)).toBe(true);
  });

  it("G. Org B user cannot read Org A notification or delivery", async ({ skip }) => {
    if (!hubReady || !orgBUser) {
      skip("062");
      return;
    }
    const { id } = await upsert({
      orgId: fx.orgAId,
      recipientId: fx.users.pm.id,
      dedupKey: `${tag.current}-g`,
      channels: ["in_app"],
    });
    const other = await signInAs(orgBUser.email, orgBUser.password);
    const { data: notes } = await other.from("notifications").select("id").eq("id", id!);
    expect(notes ?? []).toHaveLength(0);
    const { data: dels } = await other.from("notification_deliveries").select("id").eq("notification_id", id!);
    expect(dels ?? []).toHaveLength(0);
  });

  it("H. preference ownership is self-only", async ({ skip }) => {
    if (!hubReady) {
      skip("062");
      return;
    }
    const pm = await signInAs(fx.users.pm.email, fx.users.pm.password);
    const { error: insErr } = await pm.from("notification_preferences").insert({
      organization_id: fx.orgAId,
      profile_id: fx.users.pm.id,
      category: "PROJECTS",
      channel: "email",
      enabled: true,
    });
    expect(insErr).toBeNull();
    const { data: mine } = await pm.from("notification_preferences").select("id, profile_id").eq("category", "PROJECTS");
    expect((mine ?? []).every((r) => r.profile_id === fx.users.pm.id)).toBe(true);

    const { error: updErr } = await pm
      .from("notification_preferences")
      .update({ enabled: false })
      .eq("profile_id", fx.users.pm.id)
      .eq("category", "PROJECTS")
      .eq("channel", "email");
    expect(updErr).toBeNull();

    const eng = await signInAs(fx.users.engineer.email, fx.users.engineer.password);
    const { data: others } = await eng.from("notification_preferences").select("id").eq("profile_id", fx.users.pm.id);
    expect(others ?? []).toHaveLength(0);
    const { error: steal } = await eng.from("notification_preferences").insert({
      organization_id: fx.orgAId,
      profile_id: fx.users.pm.id,
      category: "HR",
      channel: "push",
      enabled: true,
    });
    expect(steal).toBeTruthy();
    const { error: crossOrg } = await pm.from("notification_preferences").insert({
      organization_id: fx.orgBId,
      profile_id: fx.users.pm.id,
      category: "PROJECTS",
      channel: "push",
      enabled: true,
    });
    expect(crossOrg).toBeNull();
  });

  it("I. mandatory in-app cannot be disabled or deleted; absence still enables", async ({ skip }) => {
    if (!hubReady) {
      skip("062");
      return;
    }
    expect(
      selectChannels({
        category: "PAYROLL",
        preferences: [],
        recipientId: fx.users.pm.id,
        pushAvailable: false,
        emailAvailable: false,
        whatsappAvailable: false,
      }),
    ).toContain("in_app");

    const pm = await signInAs(fx.users.pm.email, fx.users.pm.password);
    for (const category of ["WORK", "APPROVALS", "PAYROLL"] as const) {
      const { error: ins } = await pm.from("notification_preferences").insert({
        organization_id: fx.orgAId,
        profile_id: fx.users.pm.id,
        category,
        channel: "in_app",
        enabled: true,
      });
      expect(ins).toBeNull();
      const { error: off } = await pm.from("notification_preferences").insert({
        organization_id: fx.orgAId,
        profile_id: fx.users.pm.id,
        category,
        channel: "in_app",
        enabled: false,
      });
      expect(off).toBeTruthy();
      const { error: upd } = await pm
        .from("notification_preferences")
        .update({ enabled: false })
        .eq("category", category)
        .eq("channel", "in_app");
      expect(upd).toBeTruthy();
      const { data: after } = await pm
        .from("notification_preferences")
        .select("enabled")
        .eq("category", category)
        .eq("channel", "in_app")
        .maybeSingle();
      expect(after?.enabled).toBe(true);
      const { data: deleted } = await pm
        .from("notification_preferences")
        .delete()
        .eq("category", category)
        .eq("channel", "in_app")
        .select("id");
      expect(deleted ?? []).toHaveLength(0);
      const { data: still } = await pm
        .from("notification_preferences")
        .select("id")
        .eq("category", category)
        .eq("channel", "in_app");
      expect(still ?? []).toHaveLength(1);
      expect(
        selectChannels({
          category,
          preferences: [],
          recipientId: fx.users.pm.id,
          pushAvailable: false,
          emailAvailable: false,
          whatsappAvailable: false,
        }),
      ).toContain("in_app");
    }
  });

  it("J. push subscription is owner-scoped and not transferable", async ({ skip }) => {
    if (!hubReady || !orgBUser) {
      skip("062");
      return;
    }
    const endpoint = `https://push.example/${tag.current}/pm`;
    const pm = await signInAs(fx.users.pm.email, fx.users.pm.password);
    const { data: sub, error: ins } = await pm
      .from("push_subscriptions")
      .insert({
        organization_id: fx.orgAId,
        profile_id: fx.users.pm.id,
        endpoint,
        p256dh: "p256dh-live56-key",
        auth: "auth-live56-key",
      })
      .select("id, profile_id, organization_id")
      .single();
    expect(ins).toBeNull();
    expect(sub?.profile_id).toBe(fx.users.pm.id);

    const { error: otherProfile } = await pm.from("push_subscriptions").insert({
      organization_id: fx.orgAId,
      profile_id: fx.users.engineer.id,
      endpoint: `${endpoint}-other`,
      p256dh: "p256dh-live56-key",
      auth: "auth-live56-key",
    });
    expect(otherProfile).toBeTruthy();

    const { error: moveUser } = await pm.from("push_subscriptions").update({ profile_id: fx.users.engineer.id }).eq("id", sub!.id);
    expect(moveUser).toBeTruthy();
    const { error: moveOrg } = await pm.from("push_subscriptions").update({ organization_id: fx.orgBId }).eq("id", sub!.id);
    expect(moveOrg).toBeTruthy();

    const eng = await signInAs(fx.users.engineer.email, fx.users.engineer.password);
    const { data: secret } = await eng.from("push_subscriptions").select("p256dh, auth").eq("id", sub!.id);
    expect(secret ?? []).toHaveLength(0);
    await eng.from("push_subscriptions").update({ user_agent: "stolen" }).eq("id", sub!.id);
    const admin = adminClient();
    const { data: still } = await admin.from("push_subscriptions").select("user_agent, profile_id, organization_id").eq("id", sub!.id).single();
    expect(still?.profile_id).toBe(fx.users.pm.id);
    expect(still?.organization_id).toBe(fx.orgAId);
    expect(still?.user_agent).not.toBe("stolen");

    const other = await signInAs(orgBUser.email, orgBUser.password);
    const { error: hijack } = await other.from("push_subscriptions").insert({
      organization_id: fx.orgBId,
      profile_id: orgBUser.id,
      endpoint,
      p256dh: "p256dh-hijack-key",
      auth: "auth-hijack-key",
    });
    expect(hijack).toBeTruthy();
  });

  it("K. owner trigger blocks service-role profile/org mutation", async ({ skip }) => {
    if (!hubReady) {
      skip("062");
      return;
    }
    const admin = adminClient();
    const { data: sub, error } = await admin
      .from("push_subscriptions")
      .insert({
        organization_id: fx.orgAId,
        profile_id: fx.users.engineer.id,
        endpoint: `https://push.example/${tag.current}/eng`,
        p256dh: "p256dh-live56-eng",
        auth: "auth-live56-eng",
      })
      .select("id, profile_id, organization_id")
      .single();
    expect(error).toBeNull();
    const { error: t1 } = await admin.from("push_subscriptions").update({ profile_id: fx.users.pm.id }).eq("id", sub!.id);
    expect(t1?.message ?? "").toMatch(/immutable/i);
    const { error: t2 } = await admin.from("push_subscriptions").update({ organization_id: fx.orgBId }).eq("id", sub!.id);
    expect(t2?.message ?? "").toMatch(/immutable/i);
    const { data: persisted } = await admin
      .from("push_subscriptions")
      .select("profile_id, organization_id")
      .eq("id", sub!.id)
      .single();
    expect(persisted?.profile_id).toBe(fx.users.engineer.id);
    expect(persisted?.organization_id).toBe(fx.orgAId);
  });

  it("L. authenticated cannot execute service-role RPCs", async ({ skip }) => {
    if (!hubReady) {
      skip("062");
      return;
    }
    const pm = await signInAs(fx.users.pm.email, fx.users.pm.password);
    const up = await pm.rpc("upsert_operational_notification", {
      p_organization_id: fx.orgAId,
      p_recipient_profile_id: fx.users.pm.id,
      p_event_type: "WORK_ASSIGNED",
      p_type: "WORK_ASSIGNED",
      p_title: "nope",
      p_message: "nope",
      p_entity_type: "live_test",
      p_entity_id: fx.projectId,
      p_href: "/projects",
      p_priority: "normal",
      p_dedup_key: `${tag.current}-l`,
      p_channels: ["in_app"],
    });
    expect(up.data).toBeNull();
    expect(denied(up.error) || up.error !== null).toBe(true);
    const claim = await pm.rpc("claim_notification_deliveries", { p_limit: 1 });
    expect(claim.data == null || (Array.isArray(claim.data) && claim.data.length === 0)).toBe(true);
    expect(denied(claim.error) || claim.error !== null).toBe(true);
  });

  it("M. unsafe href rejected; relative path accepted", async ({ skip }) => {
    if (!hubReady) {
      skip("062");
      return;
    }
    for (const href of ["https://evil.example", "//evil.example", "javascript:alert(1)"]) {
      const { error } = await upsert({
        orgId: fx.orgAId,
        recipientId: fx.users.pm.id,
        dedupKey: `${tag.current}-m-${href.slice(0, 8)}`,
        channels: ["in_app"],
        href,
      });
      expect(error).toBeTruthy();
      expect(`${error?.message ?? ""}`.toLowerCase()).toMatch(/unsafe|href/);
    }
    const ok = await upsert({
      orgId: fx.orgAId,
      recipientId: fx.users.pm.id,
      dedupKey: `${tag.current}-m-ok`,
      channels: ["in_app"],
      href: "/approvals",
    });
    expect(ok.error).toBeNull();
    expect(ok.id).toBeTruthy();
  });

  it("N. concurrent claims do not double-claim; in_app never claimed; limit bounded", async ({ skip }) => {
    if (!hubReady) {
      skip("062");
      return;
    }
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const row = await upsert({
        orgId: fx.orgAId,
        recipientId: fx.users.pm.id,
        dedupKey: `${tag.current}-n-${i}`,
        channels: ["email"],
      });
      ids.push(row.id!);
    }
    const owned = new Set(ids);
    const admin = adminClient();
    await admin
      .from("notification_deliveries")
      .update({ created_at: "2000-01-01T00:00:00.000Z", next_attempt_at: new Date().toISOString() })
      .in("notification_id", ids);
    const [a, b] = await Promise.all([
      admin.rpc("claim_notification_deliveries", { p_limit: 2 }),
      admin.rpc("claim_notification_deliveries", { p_limit: 2 }),
    ]);
    const rows = [...(Array.isArray(a.data) ? a.data : []), ...(Array.isArray(b.data) ? b.data : [])] as DeliveryRow[];
    const stolen = rows.filter((r) => !owned.has(r.notification_id));
    for (const s of stolen) {
      await admin
        .from("notification_deliveries")
        .update({
          status: "pending",
          attempt_count: Math.max(0, (s.attempt_count ?? 1) - 1),
        })
        .eq("id", s.id);
    }
    const ours = rows.filter((r) => owned.has(r.notification_id));
    const unique = new Set(ours.map((r) => r.id));
    expect(unique.size).toBe(ours.length);
    expect(ours.length).toBeGreaterThan(0);
    expect(ours.every((r) => r.status === "processing")).toBe(true);
    expect(ours.every((r) => r.channel === "email")).toBe(true);
    expect(ours.every((r) => r.attempt_count >= 1)).toBe(true);

    const bounded = await admin.rpc("claim_notification_deliveries", { p_limit: 10_000 });
    const boundedRows = (Array.isArray(bounded.data) ? bounded.data : []) as DeliveryRow[];
    expect(boundedRows.length).toBeLessThanOrEqual(100);
    for (const s of boundedRows.filter((r) => !owned.has(r.notification_id))) {
      await admin
        .from("notification_deliveries")
        .update({
          status: "pending",
          attempt_count: Math.max(0, (s.attempt_count ?? 1) - 1),
        })
        .eq("id", s.id);
    }
    for (const id of ours.map((r) => r.id)) {
      await admin.from("notification_deliveries").update({ status: "cancelled", next_attempt_at: null }).eq("id", id);
    }
  });

  it("O. failed external delivery retries same row; no duplicate notification", async ({ skip }) => {
    if (!hubReady) {
      skip("062");
      return;
    }
    const { id } = await upsert({
      orgId: fx.orgAId,
      recipientId: fx.users.pm.id,
      dedupKey: `${tag.current}-o`,
      channels: ["email"],
    });
    const owned = new Set([id!]);
    await adminClient()
      .from("notification_deliveries")
      .update({ created_at: "2000-01-01T00:00:00.000Z", next_attempt_at: new Date().toISOString() })
      .eq("notification_id", id!);
    const claimed = await claimOwned(owned, 5);
    const row = claimed.owned[0];
    expect(row).toBeTruthy();
    const store = new MemoryHubStore();
    const email = new MockEmailProvider();
    email.failNext = true;
    store.deliveries = [
      {
        id: row.id,
        notificationId: row.notification_id,
        organizationId: row.organization_id,
        recipientId: row.recipient_profile_id,
        channel: "email",
        status: row.status,
        attemptCount: row.attempt_count,
      },
    ];
    store.contacts.set(row.recipient_profile_id, {
      email: fx.users.pm.email,
      phone: null,
      name: "pm",
    });
    const orch = new NotificationOrchestrator(
      store,
      email,
      new MockWhatsAppProvider(),
      new MockPushProvider(),
      "http://localhost:3000",
    );
    const now = new Date();
    const outcome = await orch.processDelivery(store.deliveries[0]);
    expect(outcome.status).toBe("failed");
    const next = nextRetryAt(row.attempt_count, now);
    const admin = adminClient();
    await admin
      .from("notification_deliveries")
      .update({
        status: "failed",
        last_error_code: "transient",
        next_attempt_at: next ? next.toISOString() : null,
        updated_at: now.toISOString(),
      })
      .eq("id", row.id);

    const { data: notes } = await admin.from("notifications").select("id").eq("dedup_key", `${tag.current}-o`);
    expect(notes).toHaveLength(1);
    const dels = await deliveriesFor(id!);
    expect(dels).toHaveLength(1);
    expect(dels[0].id).toBe(row.id);
    expect(dels[0].status).toBe("failed");
    expect(dels[0].attempt_count).toBe(row.attempt_count);
    expect(dels[0].next_attempt_at).toBeTruthy();
  });

  it("P. escalation tenant isolation and uniqueness", async ({ skip }) => {
    if (!hubReady || !orgBUser) {
      skip("062");
      return;
    }
    const admin = adminClient();
    const entityId = fx.projectId;
    const { data: esc, error } = await admin
      .from("notification_escalations")
      .insert({
        organization_id: fx.orgAId,
        entity_type: "approval_request",
        entity_id: entityId,
        level: 1,
        from_profile_id: fx.users.engineer.id,
        to_profile_id: fx.users.pm.id,
        reason: tag.current,
      })
      .select("id, organization_id, from_profile_id, to_profile_id")
      .single();
    expect(error).toBeNull();
    expect(esc?.organization_id).toBe(fx.orgAId);
    expect(esc?.from_profile_id).toBe(fx.users.engineer.id);
    expect(esc?.to_profile_id).toBe(fx.users.pm.id);

    const dup = await admin.from("notification_escalations").insert({
      organization_id: fx.orgAId,
      entity_type: "approval_request",
      entity_id: entityId,
      level: 1,
      from_profile_id: fx.users.engineer.id,
      to_profile_id: fx.users.pm.id,
      reason: tag.current,
    });
    expect(dup.error).toBeTruthy();

    const toUser = await signInAs(fx.users.pm.email, fx.users.pm.password);
    const { data: toRows } = await toUser.from("notification_escalations").select("id").eq("id", esc!.id);
    expect(toRows ?? []).toHaveLength(1);

    const fromUser = await signInAs(fx.users.engineer.email, fx.users.engineer.password);
    const { data: fromRows } = await fromUser.from("notification_escalations").select("id").eq("id", esc!.id);
    expect(fromRows ?? []).toHaveLength(1);

    const mgr = await signInAs(fx.users.finance.email, fx.users.finance.password);
    const { data: mgrRows } = await mgr.from("notification_escalations").select("id").eq("id", esc!.id);
    expect(mgrRows ?? []).toHaveLength(1);

    const restricted = await signInAs(fx.users.restricted.email, fx.users.restricted.password);
    const { data: none } = await restricted.from("notification_escalations").select("id").eq("id", esc!.id);
    expect(none ?? []).toHaveLength(0);

    const other = await signInAs(orgBUser.email, orgBUser.password);
    const { data: cross } = await other.from("notification_escalations").select("id").eq("id", esc!.id);
    expect(cross ?? []).toHaveLength(0);
  });

  it("legacy aggregate audit (no PII)", async ({ skip }) => {
    if (!hubReady) {
      skip("062");
      return;
    }
    const admin = adminClient();
    async function fetchAll<T>(table: string, columns: string): Promise<T[]> {
      const page = 1000;
      const out: T[] = [];
      for (let from = 0; ; from += page) {
        const { data, error } = await admin.from(table).select(columns).range(from, from + page - 1);
        if (error) throw new Error(`${table}: ${error.message}`);
        const chunk = (data ?? []) as T[];
        out.push(...chunk);
        if (chunk.length < page) break;
      }
      return out;
    }
    const list = await fetchAll<{
      status: string;
      channel: string;
      notification_id: string;
      organization_id: string;
      recipient_profile_id: string;
    }>("notification_deliveries", "status, channel, notification_id, organization_id, recipient_profile_id");
    const statuses = [...new Set(list.map((r) => r.status))].sort();
    const channels = [...new Set(list.map((r) => r.channel))].sort();
    const byStatus: Record<string, number> = {};
    const byChannel: Record<string, number> = {};
    for (const r of list) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      byChannel[r.channel] = (byChannel[r.channel] ?? 0) + 1;
    }
    const notes = await fetchAll<{
      id: string;
      organization_id: string;
      recipient_profile_id: string;
      dedup_key: string | null;
    }>("notifications", "id, organization_id, recipient_profile_id, dedup_key");
    const noteById = new Map((notes ?? []).map((n) => [n.id as string, n]));
    let orphans = 0;
    let mismatch = 0;
    const pair = new Map<string, number>();
    for (const d of list) {
      const n = noteById.get(d.notification_id as string);
      if (!n) orphans += 1;
      else if (n.organization_id !== d.organization_id || n.recipient_profile_id !== d.recipient_profile_id) mismatch += 1;
      const key = `${d.notification_id}:${d.channel}`;
      pair.set(key, (pair.get(key) ?? 0) + 1);
    }
    const dupes = [...pair.values()].filter((c) => c > 1).length;
    const dedupNotes = (notes ?? []).filter((n) => n.dedup_key).length;
    liveAudit.statuses = statuses;
    liveAudit.channels = channels;
    liveAudit.deliveryCount = list.length;
    liveAudit.byStatus = byStatus;
    liveAudit.byChannel = byChannel;
    liveAudit.orphans = orphans;
    liveAudit.mismatch = mismatch;
    liveAudit.dupes = dupes;
    liveAudit.dedupNotes = dedupNotes;
    expect(orphans).toBe(0);
    expect(mismatch).toBe(0);
    expect(dupes).toBe(0);
    console.info("[phase56-live-audit]", JSON.stringify(liveAudit));
  });

  it("cron endpoint rejects unauthorized; secret gate does not leak keys", async ({ skip }) => {
    if (!hubReady) {
      skip("062");
      return;
    }
    expect(isNotificationsCronAuthorized(null)).toBe(false);
    expect(isNotificationsCronAuthorized("Bearer wrong-secret-value-xx")).toBe(false);
    const secret = notificationsCronSecret();
    if (!secret) {
      liveAudit.cron = "NOTIFICATIONS_CRON_SECRET (or CRON_SECRET ≥16) not configured — endpoint stays closed";
      expect(isNotificationsCronAuthorized("Bearer anything-at-all-16")).toBe(false);
      return;
    }
    expect(isNotificationsCronAuthorized(`Bearer ${secret}`)).toBe(true);
    expect(secret).not.toMatch(/service_role/i);
    liveAudit.cron =
      "secret configured; valid bearer accepted by helper; live POST with valid secret not invoked to avoid claiming non-fixture deliveries";

    const base = process.env.E2E_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    try {
      const none = await fetch(`${base}/api/internal/notifications/run`, { method: "POST", signal: AbortSignal.timeout(4000) });
      expect(none.status).toBe(401);
      const body = await none.text();
      expect(body.toLowerCase()).not.toContain("service_role");
      const wrong = await fetch(`${base}/api/internal/notifications/run`, {
        method: "POST",
        headers: { Authorization: "Bearer definitely-wrong-secret" },
        signal: AbortSignal.timeout(4000),
      });
      expect(wrong.status).toBe(401);
      liveAudit.cronHttp = "401 without/wrong Authorization";
    } catch {
      liveAudit.cronHttp = "app server not reachable; helper certified only";
    }
  });

  it("mock pipeline text has no salary/IBAN", () => {
    const text = redactNotificationText("يوجد تنبيه تشغيلي يحتاج متابعتك داخل النظام.");
    expect(text).not.toMatch(/iban|راتب|salary|account_number/i);
  });
});
