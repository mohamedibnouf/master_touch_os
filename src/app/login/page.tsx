import { PageHeader } from "@/components/ui/primitives";
import { LoginForm } from "@/components/auth/login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ disabled?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-4" data-testid="login-page">
      <div className="w-full max-w-md rounded-xl border border-line bg-white p-5 shadow-sm sm:p-8">
        <div className="mb-8">
          <p className="text-xs font-semibold tracking-[0.2em] text-bronze">MASTER TOUCH</p>
          <PageHeader title="تسجيل الدخول" description="نظام التشغيل الداخلي للشركة" />
        </div>
        {params.disabled ? (
          <p className="mb-4 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            تم إيقاف صلاحية الدخول لهذا الحساب.
          </p>
        ) : null}
        <LoginForm />
      </div>
    </main>
  );
}
