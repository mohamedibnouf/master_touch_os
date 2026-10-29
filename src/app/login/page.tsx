import Image from "next/image";
import { CheckCircle2 } from "lucide-react";
import { LoginForm } from "@/components/auth/login-form";
import { LanguageSwitch } from "@/components/layout/language-switch";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { getI18n } from "@/lib/i18n/server";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ disabled?: string; next?: string }>;
}) {
  const params = await searchParams;
  const { t } = await getI18n();

  return (
    <main className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]" data-testid="login-page">
      <section className="relative flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Image src="/icons/icon-192x192.png" alt="" width={36} height={36} priority className="size-9 rounded-[0.6rem]" />
            <span className="text-[0.9375rem] font-semibold tracking-tight text-ink">{t.common.appName}</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageSwitch />
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight text-ink">{t.auth.title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">{t.auth.description}</p>
          {params.disabled ? (
            <p className="mt-6 rounded-[var(--radius-control)] border border-danger-border bg-danger-soft px-3 py-2.5 text-sm text-danger">
              {t.auth.disabled}
            </p>
          ) : null}
          <div className="mt-8">
            <LoginForm nextPath={params.next ?? ""} />
          </div>
        </div>
      </section>

      <section className="mt-hero-glow relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-end lg:p-14">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:48px_48px]"
        />
        <div className="relative max-w-lg">
          <Image
            src="/master-touch-app-icon.png"
            alt={t.common.appName}
            width={88}
            height={88}
            className="mb-10 size-[5.5rem] rounded-[1.4rem] shadow-[0_20px_60px_-15px_var(--brand-glow)]"
          />
          <h2 className="text-[2rem] font-semibold leading-[1.25] tracking-tight text-white">{t.auth.heroTitle}</h2>
          <p className="mt-4 text-base leading-relaxed text-sidebar-ink/75">{t.auth.heroBody}</p>
          <ul className="mt-8 space-y-3">
            {t.auth.heroPoints.map((point) => (
              <li key={point} className="flex items-center gap-3 text-sm text-sidebar-ink/90">
                <CheckCircle2 className="size-5 shrink-0 text-brand" aria-hidden />
                {point}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
