import { escapeHtml } from "./html";

export type OperationalEmailContent = {
  subject: string;
  text: string;
  html: string;
};

export function renderOperationalEmail(input: {
  title: string;
  body: string;
  href: string;
  organizationNameAr?: string | null;
  ctaLabel?: string | null;
}): OperationalEmailContent {
  const title = input.title.trim() || "تنبيه تشغيلي";
  const body = input.body.trim() || "يوجد تنبيه يحتاج متابعتك داخل النظام.";
  const brand = input.organizationNameAr?.trim() || "ماستر تاتش";
  const cta = input.ctaLabel?.trim() || "فتح التنبيه في ماستر تاتش";
  const subject = `${brand} — ${title}`.slice(0, 200);
  const text = [
    title,
    "",
    body,
    "",
    `${cta}: ${input.href}`,
    "",
    "هذه رسالة تشغيلية من نظام ماستر تاتش. لا تتضمن تفاصيل سرية.",
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:24px;background:#f4f1ea;font-family:Tahoma,Arial,sans-serif;color:#1b2430;direction:rtl;">
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
      هذه رسالة تشغيلية من نظام ماستر تاتش. لا تتضمن تفاصيل سرية.
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}
