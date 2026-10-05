import { PageHeader } from "@/components/ui/primitives";
import { LoginForm } from "@/components/auth/login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ disabled?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4" data-testid="login-page">
      <div className="w-full max-w-md rounded-[var(--radius-hero)] border border-line bg-white p-5 sm:p-8">
        <div className="mb-6">
          <p className="text-sm font-semibold text-ink">Master Touch</p>
          <PageHeader
            title="تسجيل الدخول"
            description="ادخل الرقم الوظيفي وكلمة المرور. لا تحتاج إلى بريد إلكتروني."
          />
        </div>
        {params.disabled ? (
          <p className="mb-4 rounded-[var(--radius-control)] bg-danger/10 px-3 py-2 text-sm text-danger">
            تم إيقاف صلاحية الدخول لهذا الحساب.
          </p>
        ) : null}
        <LoginForm />
      </div>
    </main>
  );
}
