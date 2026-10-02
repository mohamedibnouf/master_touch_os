export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  href?: string | null;
  replyTo?: string | null;
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
  nextError: ProviderResult | null = null;
  async send(message: EmailMessage): Promise<ProviderResult> {
    if (this.nextError) {
      const err = this.nextError;
      this.nextError = null;
      return err;
    }
    if (this.failNext) {
      this.failNext = false;
      return { ok: false, code: "transient", retry: true };
    }
    this.sent.push(message);
    return { ok: true, providerMessageId: `mock-email-${this.sent.length}` };
  }
}

export function resendFromIsValid(from: string): boolean {
  return from.includes("@") && from.length >= 3;
}

export function resendTimeoutMs(): number {
  const raw = Number(process.env.RESEND_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 1000 && raw <= 30_000) return Math.floor(raw);
  return 8000;
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  readonly enabled: boolean;
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly timeoutMs = resendTimeoutMs(),
  ) {
    this.enabled = apiKey.length >= 8 && resendFromIsValid(from);
  }
  async send(message: EmailMessage): Promise<ProviderResult> {
    if (!this.enabled) return { ok: false, code: "disabled", retry: false };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const payload: Record<string, unknown> = {
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      };
      if (message.html) payload.html = message.html;
      const replyTo = message.replyTo?.trim();
      if (replyTo && replyTo.includes("@")) payload.reply_to = replyTo;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (res.status === 401 || res.status === 403) return { ok: false, code: "auth", retry: false };
      if (res.status === 422) return { ok: false, code: "invalid_recipient", retry: false };
      if (res.status === 429) return { ok: false, code: "http_429", retry: true };
      if (!res.ok) return { ok: false, code: `http_${res.status}`, retry: res.status >= 500 };
      const json = (await res.json().catch(() => ({}))) as { id?: string };
      return { ok: true, providerMessageId: json.id };
    } catch (err) {
      const aborted =
        (err instanceof Error && err.name === "AbortError") ||
        (typeof err === "object" && err !== null && "name" in err && (err as { name: string }).name === "AbortError");
      if (aborted || controller.signal.aborted) {
        return { ok: false, code: "timeout", retry: true };
      }
      return { ok: false, code: "network", retry: true };
    } finally {
      clearTimeout(timer);
    }
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
