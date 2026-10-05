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
      <body className="min-h-screen bg-white p-6 text-[#111318]">
        <div className="mx-auto max-w-lg rounded-[14px] border border-[#E8EAED] bg-white p-6">
          <h1 className="text-lg font-semibold">تعذّر تشغيل التطبيق</h1>
          <p className="mt-2 text-sm text-[#667085]">أعد المحاولة. إن استمر الخطأ تواصل مع الدعم دون مشاركة بيانات الدخول.</p>
          {error.digest ? <p className="mt-2 text-xs text-[#667085]">مرجع: {error.digest}</p> : null}
          <button
            type="button"
            className="mt-4 inline-flex min-h-10 items-center justify-center rounded-[9px] bg-[#2563EB] px-4 text-sm text-white"
            onClick={() => reset()}
          >
            إعادة المحاولة
          </button>
        </div>
      </body>
    </html>
  );
}
