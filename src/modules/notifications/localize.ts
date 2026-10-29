import { resolveLocale, type Locale } from "@/lib/i18n/config";

/**
 * Notification text is written in the RECIPIENT's language. Arabic is always
 * provided and stays the default; English is optional and used only when the
 * recipient's `profiles.locale` is 'en'.
 */
export type LocalizedNotificationText = {
  title: string;
  message: string;
  titleEn?: string | null;
  messageEn?: string | null;
};

export function recipientLocale(raw: unknown): Locale {
  return resolveLocale(raw);
}

export function pickNotificationText(
  locale: Locale,
  text: LocalizedNotificationText,
): { title: string; message: string } {
  if (locale !== "en") return { title: text.title, message: text.message };
  return {
    title: text.titleEn?.trim() || text.title,
    message: text.messageEn?.trim() || text.message,
  };
}
