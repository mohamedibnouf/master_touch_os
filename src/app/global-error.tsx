"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen bg-[#F6F3EE] p-6 text-[#1a1c1f]">
        <div className="mx-auto max-w-lg rounded-lg border border-[#e4dfd6] bg-white p-6">
          <h1 className="text-lg font-semibold">تعذّر تشغيل التطبيق</h1>
          <p className="mt-2 text-sm text-[#5c6170]">أعد المحاولة. إن استمر الخطأ تواصل مع الدعم دون مشاركة بيانات الدخول.</p>
          {error.digest ? <p className="mt-2 text-xs text-[#5c6170]">مرجع: {error.digest}</p> : null}
          <button
            type="button"
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-md bg-[#1B2A4A] px-4 text-sm text-white"
            onClick={() => reset()}
          >
            إعادة المحاولة
          </button>
        </div>
      </body>
    </html>
  );
}
