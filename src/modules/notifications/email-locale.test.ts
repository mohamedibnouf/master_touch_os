import { describe, expect, it } from "vitest";
import { NotificationOrchestrator } from "./orchestrator";
import { MemoryHubStore } from "./memory-store";
import { MockEmailProvider, MockPushProvider, MockWhatsAppProvider } from "./providers";
import { operationalEmailCtaLabel, renderOperationalEmail } from "./email-render";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER_A = "22222222-2222-4222-8222-222222222222";
const ENTITY = "44444444-4444-4444-8444-444444444444";
const HREF = "https://app.mastertouch-ksa.com/approvals";

function approvalEvent(title: string, body: string) {
  return {
    organizationId: ORG,
    eventType: "APPROVAL_ASSIGNED" as const,
    entityType: "approval_request",
    entityId: ENTITY,
    recipientIds: [USER_A],
    title,
    body,
    href: "/approvals",
    priority: "high" as const,
    occurredAt: new Date().toISOString(),
    deduplicationKey: `approval-assigned:${ENTITY}:${USER_A}`,
  };
}

describe("operational e-mail chrome follows the recipient language", () => {
  it("keeps the Arabic chrome by default", () => {
    const rendered = renderOperationalEmail({ title: "طلب موافقة", body: "مطلوب إجراء موافقة", href: HREF });
    expect(rendered.subject).toBe("ماستر تاتش — طلب موافقة");
    expect(rendered.html).toContain('<html lang="ar" dir="rtl">');
    expect(rendered.html).toContain("font-family:Tahoma,Arial,sans-serif;color:#1b2430;direction:rtl;");
    expect(rendered.html).toContain(">فتح التنبيه في ماستر تاتش</a>");
    expect(rendered.html).toContain("هذه رسالة تشغيلية من نظام ماستر تاتش. لا تتضمن تفاصيل سرية.");
    expect(rendered.text).toBe(
      [
        "طلب موافقة",
        "",
        "مطلوب إجراء موافقة",
        "",
        `فتح التنبيه في ماستر تاتش: ${HREF}`,
        "",
        "هذه رسالة تشغيلية من نظام ماستر تاتش. لا تتضمن تفاصيل سرية.",
      ].join("\n"),
    );
    expect(renderOperationalEmail({ title: "x", body: "y", href: HREF, locale: "ar" })).toEqual(
      renderOperationalEmail({ title: "x", body: "y", href: HREF }),
    );
  });

  it("renders English chrome, ltr and lang=en for 'en' recipients", () => {
    const rendered = renderOperationalEmail({
      title: "New approval request",
      body: "Your approval is required.",
      href: HREF,
      locale: "en",
    });
    expect(rendered.subject).toBe("Master Touch — New approval request");
    expect(rendered.html).toContain('<html lang="en" dir="ltr">');
    expect(rendered.html).toContain("direction:ltr;");
    expect(rendered.html).toContain(">Open the alert in Master Touch</a>");
    expect(rendered.html).toContain("This is an operational message from the Master Touch system.");
    expect(rendered.html).not.toMatch(/[؀-ۿ]/);
    expect(rendered.text).not.toMatch(/[؀-ۿ]/);
  });

  it("uses English defaults and organization name fallback", () => {
    const rendered = renderOperationalEmail({ title: " ", body: "", href: HREF, locale: "en", organizationNameAr: "شركة" });
    expect(rendered.subject).toBe("شركة — Operational alert");
    expect(rendered.html).toContain("There is an alert that needs your attention in the system.");
    expect(
      renderOperationalEmail({ title: "t", body: "b", href: HREF, locale: "en", organizationNameEn: "Acme" }).subject,
    ).toBe("Acme — t");
  });

  it("localizes the CTA label", () => {
    expect(operationalEmailCtaLabel("approval.required", "ar")).toBe("عرض طلب الموافقة");
    expect(operationalEmailCtaLabel("approval.required", "en")).toBe("View approval request");
    expect(operationalEmailCtaLabel("leave_request.approved", null)).toBe("عرض المشروع");
    expect(operationalEmailCtaLabel("leave_request.approved", "en")).toBe("View project");
  });

  it("sends the e-mail with chrome in the recipient's locale", async () => {
    for (const locale of ["en", "ar"] as const) {
      const store = new MemoryHubStore();
      store.members = [{ profileId: USER_A, organizationId: ORG, status: "active", isActive: true }];
      store.contacts.set(USER_A, { email: "user@test.local", phone: null, name: "A", locale });
      const email = new MockEmailProvider();
      const orch = new NotificationOrchestrator(
        store,
        email,
        new MockWhatsAppProvider(),
        new MockPushProvider(),
        "https://app.mastertouch-ksa.com",
      );
      await orch.emit(
        locale === "en"
          ? approvalEvent("New approval request", "Your approval is required.")
          : approvalEvent("طلب موافقة", "مطلوب إجراء موافقة"),
      );
      const row = store.deliveries.find((d) => d.channel === "email")!;
      await orch.processDelivery(row);
      const sent = email.sent[0];
      if (locale === "en") {
        expect(sent.html).toContain('<html lang="en" dir="ltr">');
        // Hub event types are upper-case, so the historical CTA rule picks the project label.
        expect(sent.html).toContain(">View project</a>");
        expect(sent.subject).toBe("Master Touch — New approval request");
      } else {
        expect(sent.html).toContain('<html lang="ar" dir="rtl">');
        expect(sent.html).toContain(">عرض المشروع</a>");
        expect(sent.subject).toBe("ماستر تاتش — طلب موافقة");
      }
    }
  });
});
