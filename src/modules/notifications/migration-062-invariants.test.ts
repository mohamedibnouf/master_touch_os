import { describe, expect, it } from "vitest";
import {
  backfillTimestamps,
  backfillTenant,
  duplicateNotificationChannelGroups,
  incompatibleStatuses,
  orphanDeliveries,
  pushOwnerTransferBlocked,
  tenantBindingHolds,
  type LegacyDelivery,
} from "./migration-062-invariants";
import { selectChannels } from "./policy";

const ATTEMPT = "2026-01-02T03:04:05.000Z";

function row(over: Partial<LegacyDelivery> = {}): LegacyDelivery {
  return {
    id: "d1",
    notification_id: "n1",
    status: "pending",
    channel: "in_app",
    attempted_at: ATTEMPT,
    delivered_at: null,
    sent_at: null,
    organization_id: null,
    recipient_profile_id: null,
    ...over,
  };
}

describe("062 timestamp backfill", () => {
  it("A. failed legacy delivery does not become delivered", () => {
    const next = backfillTimestamps(row({ status: "failed" }));
    expect(next.delivered_at).toBeNull();
    expect(next.sent_at).toBeNull();
  });

  it("B. pending (and processing) legacy delivery does not become delivered", () => {
    expect(backfillTimestamps(row({ status: "pending" })).delivered_at).toBeNull();
    expect(backfillTimestamps(row({ status: "processing" })).delivered_at).toBeNull();
  });

  it("C. delivered legacy delivery backfills delivered_at from attempted_at only", () => {
    expect(backfillTimestamps(row({ status: "delivered" })).delivered_at).toBe(ATTEMPT);
    expect(backfillTimestamps(row({ status: "delivered", delivered_at: "2026-02-02T00:00:00.000Z" })).delivered_at).toBe(
      "2026-02-02T00:00:00.000Z",
    );
  });

  it("sent uses attempted_at for sent_at, not delivered_at", () => {
    const next = backfillTimestamps(row({ status: "sent" }));
    expect(next.sent_at).toBe(ATTEMPT);
    expect(next.delivered_at).toBeNull();
  });
});

describe("062 orphans and duplicates", () => {
  it("D. unresolved orphan is detected and not deleted", () => {
    const orphans = orphanDeliveries([row({ notification_id: "missing" })], new Set(["n1"]));
    expect(orphans).toHaveLength(1);
    expect(backfillTenant(orphans[0], null)).toEqual({ ok: false, reason: "unresolved" });
  });

  it("G. duplicate notification/channel groups are detected not silently dropped", () => {
    const dupes = duplicateNotificationChannelGroups([
      row({ id: "a" }),
      row({ id: "b" }),
    ]);
    expect(dupes).toEqual([{ notification_id: "n1", channel: "in_app", count: 2 }]);
  });

  it("H. invalid status is listed as incompatible", () => {
    expect(incompatibleStatuses([row({ status: "DELIVERED" })])).toEqual(["DELIVERED"]);
  });
});

describe("062 tenant binding", () => {
  it("E/F. org or recipient mismatch is rejected", () => {
    const n = { id: "n1", organization_id: "org-a", recipient_profile_id: "user-a" };
    expect(
      tenantBindingHolds(
        { notification_id: "n1", organization_id: "org-b", recipient_profile_id: "user-a" },
        n,
      ),
    ).toBe(false);
    expect(
      tenantBindingHolds(
        { notification_id: "n1", organization_id: "org-a", recipient_profile_id: "user-b" },
        n,
      ),
    ).toBe(false);
    expect(
      tenantBindingHolds(
        { notification_id: "n1", organization_id: "org-a", recipient_profile_id: "user-a" },
        n,
      ),
    ).toBe(true);
  });
});

describe("062 preferences and push owner", () => {
  it("I. mandatory in-app survives preference absence", () => {
    expect(
      selectChannels({
        category: "PAYROLL",
        preferences: [],
        recipientId: "u",
        pushAvailable: false,
        emailAvailable: false,
        whatsappAvailable: false,
      }),
    ).toContain("in_app");
  });

  it("J. mandatory in-app survives preference deletion (enabled false or missing row)", () => {
    expect(
      selectChannels({
        category: "APPROVALS",
        preferences: [{ profileId: "u", category: "APPROVALS", channel: "in_app", enabled: false }],
        recipientId: "u",
        pushAvailable: false,
        emailAvailable: false,
        whatsappAvailable: false,
      }),
    ).toContain("in_app");
  });

  it("K/L. push owner/org cannot be transferred", () => {
    expect(
      pushOwnerTransferBlocked(
        { profile_id: "a", organization_id: "org1" },
        { profile_id: "b", organization_id: "org1" },
      ),
    ).toBe(true);
    expect(
      pushOwnerTransferBlocked(
        { profile_id: "a", organization_id: "org1" },
        { profile_id: "a", organization_id: "org2" },
      ),
    ).toBe(true);
  });
});
