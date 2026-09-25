export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  href?: string | null;
};

export type WhatsAppMessage = {
  toE164: string;
  templateId: string;
  parameters: string[];
};

export type PushMessage = {
  endpoint: string;
  title: string;
  body: string;
  href: string;
};

export type ProviderResult = { ok: true; providerMessageId?: string } | { ok: false; code: string; retry: boolean };

export interface EmailProvider {
  readonly name: string;
  readonly enabled: boolean;
  send(message: EmailMessage): Promise<ProviderResult>;
}

export interface WhatsAppProvider {
  readonly name: string;
  readonly enabled: boolean;
  send(message: WhatsAppMessage): Promise<ProviderResult>;
}

export interface PushProvider {
  readonly name: string;
  readonly enabled: boolean;
  send(message: PushMessage): Promise<ProviderResult>;
}

export class DisabledEmailProvider implements EmailProvider {
  readonly name = "disabled";
  readonly enabled = false;
  async send(): Promise<ProviderResult> {
    return { ok: false, code: "disabled", retry: false };
  }
}

export class MockEmailProvider implements EmailProvider {
  readonly name = "mock";
  readonly enabled = true;
  readonly sent: EmailMessage[] = [];
  failNext = false;
  async send(message: EmailMessage): Promise<ProviderResult> {
    if (this.failNext) {
      this.failNext = false;
      return { ok: false, code: "transient", retry: true };
    }
    this.sent.push(message);
    return { ok: true, providerMessageId: `mock-email-${this.sent.length}` };
  }
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  readonly enabled: boolean;
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {
    this.enabled = apiKey.length >= 8 && from.includes("@");
  }
  async send(message: EmailMessage): Promise<ProviderResult> {
    if (!this.enabled) return { ok: false, code: "disabled", retry: false };
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: `${message.text}\n\n${message.href ? `Master Touch OS: ${message.href}` : ""}\n\nهذه رسالة تشغيلية من نظام ماستر تاتش. لا تتضمن تفاصيل سرية.`,
      }),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, code: "auth", retry: false };
    if (!res.ok) return { ok: false, code: `http_${res.status}`, retry: res.status >= 500 };
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, providerMessageId: json.id };
  }
}

export class DisabledWhatsAppProvider implements WhatsAppProvider {
  readonly name = "disabled";
  readonly enabled = false;
  async send(): Promise<ProviderResult> {
    return { ok: false, code: "disabled", retry: false };
  }
}

export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly name = "mock";
  readonly enabled = true;
  readonly sent: WhatsAppMessage[] = [];
  async send(message: WhatsAppMessage): Promise<ProviderResult> {
    this.sent.push(message);
    return { ok: true, providerMessageId: `mock-wa-${this.sent.length}` };
  }
}

export class DisabledPushProvider implements PushProvider {
  readonly name = "disabled";
  readonly enabled = false;
  async send(): Promise<ProviderResult> {
    return { ok: false, code: "disabled", retry: false };
  }
}

export class MockPushProvider implements PushProvider {
  readonly name = "mock";
  readonly enabled = true;
  readonly sent: PushMessage[] = [];
  async send(message: PushMessage): Promise<ProviderResult> {
    this.sent.push(message);
    return { ok: true, providerMessageId: `mock-push-${this.sent.length}` };
  }
}

export function createEmailProvider(): EmailProvider {
  const mode = (process.env.NOTIFICATION_EMAIL_PROVIDER ?? "none").toLowerCase();
  if (mode === "mock") return new MockEmailProvider();
  if (mode === "resend") {
    return new ResendEmailProvider(process.env.RESEND_API_KEY ?? "", process.env.NOTIFICATION_EMAIL_FROM ?? "");
  }
  return new DisabledEmailProvider();
}

export function createWhatsAppProvider(): WhatsAppProvider {
  const mode = (process.env.NOTIFICATION_WHATSAPP_PROVIDER ?? "none").toLowerCase();
  if (mode === "mock") return new MockWhatsAppProvider();
  return new DisabledWhatsAppProvider();
}

export function createPushProvider(): PushProvider {
  const mode = (process.env.NOTIFICATION_PUSH_PROVIDER ?? "none").toLowerCase();
  if (mode === "mock") return new MockPushProvider();
  return new DisabledPushProvider();
}
