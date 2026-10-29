import { roundMoney } from "@/server/domain/commercial";
import { intlLocale, type Locale } from "@/lib/i18n/config";

export function MoneyDisplay({
  amount,
  currency = "SAR",
  locale = "ar",
}: {
  amount: number | string | null | undefined;
  currency?: string;
  /** Number formatting locale; defaults to Arabic ("ar-SA") for existing callers. */
  locale?: Locale;
}) {
  const n = amount == null ? 0 : Number(amount);
  return (
    <span className="tabular-nums">
      {roundMoney(n).toLocaleString(intlLocale(locale), { minimumFractionDigits: 2 })} {currency}
    </span>
  );
}
