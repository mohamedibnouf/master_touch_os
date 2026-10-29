import type { Locale } from "@/lib/i18n/config";
import { escapeHtml } from "./html";

export type OperationalEmailContent = {
  subject: string;
  text: string;
  html: string;
};

type EmailChrome = {
  lang: Locale;
  dir: "rtl" | "ltr";
  defaultTitle: string;
  defaultBody: string;
  defaultBrand: string;
  defaultCta: string;
  footer: string;
};

/** E-mail chrome per recipient language. The Arabic strings are the historical output. */
const EMAIL_CHROME: Record<Locale, EmailChrome> = {
  ar: {
    lang: "ar",
    dir: "rtl",
    defaultTitle: "تنبيه تشغيلي",
    defaultBody: "يوجد تنبيه يحتاج متابعتك داخل النظام.",
    defaultBrand: "ماستر تاتش",
    defaultCta: "فتح التنبيه في ماستر تاتش",
    footer: "هذه رسالة تشغيلية من نظام ماستر تاتش. لا تتضمن تفاصيل سرية.",
  },
  en: {
    lang: "en",
    dir: "ltr",
    defaultTitle: "Operational alert",
    defaultBody: "There is an alert that needs your attention in the system.",
    defaultBrand: "Master Touch",
    defaultCta: "Open the alert in Master Touch",
    footer: "This is an operational message from the Master Touch system. It contains no confidential details.",
  },
};

export function emailChrome(locale: Locale | null | undefined): EmailChrome {
  return EMAIL_CHROME[locale === "en" ? "en" : "ar"];
}

/** CTA label for the operational e-mail button, in the recipient's language. */
export function operationalEmailCtaLabel(eventType: string, locale: Locale | null | undefined): string {
  const isApproval = eventType.startsWith("approval");
  if (locale === "en") return isApproval ? "View approval request" : "View project";
  return isApproval ? "عرض طلب الموافقة" : "عرض المشروع";
}

export function renderOperationalEmail(input: {
  title: string;
  body: string;
  href: string;
  organizationNameAr?: string | null;
  /** Organization name to use for English recipients (falls back to the Arabic name). */
  organizationNameEn?: string | null;
  ctaLabel?: string | null;
  /** Recipient language; Arabic by default. */
  locale?: Locale | null;
}): OperationalEmailContent {
  const chrome = emailChrome(input.locale);
  const isEn = chrome.lang === "en";
  const title = input.title.trim() || chrome.defaultTitle;
  const body = input.body.trim() || chrome.defaultBody;
  const brand =
    (isEn ? input.organizationNameEn?.trim() || input.organizationNameAr?.trim() : input.organizationNameAr?.trim()) ||
    chrome.defaultBrand;
  const cta = input.ctaLabel?.trim() || chrome.defaultCta;
  const subject = `${brand} — ${title}`.slice(0, 200);
  const text = [title, "", body, "", `${cta}: ${input.href}`, "", chrome.footer].join("\n");
  const fontFamily = isEn ? "Arial,Helvetica,sans-serif" : "Tahoma,Arial,sans-serif";

  const html = `<!DOCTYPE html>
<html lang="${chrome.lang}" dir="${chrome.dir}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:24px;background:#f4f1ea;font-family:${fontFamily};color:#1b2430;direction:${chrome.dir};">
  <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #d9d2c5;border-radius:8px;">
    <tr><td style="padding:20px 24px;border-bottom:1px solid #d9d2c5;">
      <p style="margin:0;font-size:13px;color:#5c564c;">${escapeHtml(brand)}</p>
      <h1 style="margin:8px 0 0;font-size:20px;color:#1a365d;">${escapeHtml(title)}</h1>
    </td></tr>
    <tr><td style="padding:20px 24px;">
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escapeHtml(body)}</p>
      <p style="margin:0;">
        <a href="${escapeHtml(input.href)}" style="display:inline-block;background:#1a365d;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px;">${escapeHtml(cta)}</a>
      </p>
    </td></tr>
    <tr><td style="padding:12px 24px 20px;font-size:12px;color:#5c564c;">
      ${chrome.footer}
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}
