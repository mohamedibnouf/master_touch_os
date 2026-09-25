import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { CoreRepository } from "@/server/repositories/core.repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { uploadDocumentAction } from "@/server/use-cases/platform";

export default async function DocumentsPage() {
  const ctx = await getAuthContext();
  if (!ctx || !hasPermission(ctx, "document.read")) redirect("/login");

  const supabase = await createServerSupabaseClient();
  const repo = new CoreRepository(supabase);
  const [documents, projects] = await Promise.all([
    repo.listDocuments(ctx.organization.id),
    repo.listProjects({ organizationId: ctx.organization.id, page: 1, pageSize: 100 }),
  ]);
  const canUpload = hasPermission(ctx, "document.upload");

  return (
    <div>
      <PageHeader title="المستندات" description="مستندات خاصة بإصدارات محفوظة وروابط موقّعة" />

      {canUpload ? (
        <Card className="mb-6">
          <h2 className="mb-4 text-base font-semibold text-navy">رفع مستند</h2>
          <form action={uploadDocumentAction} className="grid gap-3 md:grid-cols-2">
            <Field label="العنوان">
              <Input name="title" required />
            </Field>
            <Field label="التصنيف">
              <Select name="category" required defaultValue="other">
                <option value="business_case">دراسة حالة / Business Case</option>
                <option value="contract">عقد</option>
                <option value="drawing">مخطط</option>
                <option value="shop_drawing">مخطط ورشة</option>
                <option value="material_submittal">تقديم مواد</option>
                <option value="rfi">استفسار RFI</option>
                <option value="method_statement">بيان طريقة</option>
                <option value="inspection_request">طلب فحص</option>
                <option value="ncr">NCR</option>
                <option value="invoice">فاتورة</option>
                <option value="purchase_order">أمر شراء</option>
                <option value="change_order">أمر تغيير</option>
                <option value="handover">تسليم</option>
                <option value="warranty">ضمان</option>
                <option value="other">أخرى</option>
              </Select>
            </Field>
            <Field label="المشروع (اختياري)">
              <Select name="projectId" defaultValue="">
                <option value="">بدون مشروع</option>
                {projects.rows.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.project_code} — {project.name_ar}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="الملف">
              <Input name="file" type="file" required />
            </Field>
            <div className="md:col-span-2">
              <Button type="submit">رفع</Button>
            </div>
          </form>
        </Card>
      ) : null}

      {documents.length === 0 ? (
        <EmptyState title="لا توجد مستندات بعد." />
      ) : (
        <TableScroll className="rounded-lg border border-line bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-paper text-right text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">العنوان</th>
                <th className="px-4 py-3 font-medium">التصنيف</th>
                <th className="px-4 py-3 font-medium">الإصدار</th>
                <th className="px-4 py-3 font-medium">الحالة</th>
                <th className="px-4 py-3 font-medium">التاريخ</th>
                <th className="px-4 py-3 font-medium">ذكاء</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id} className="border-t border-line">
                  <td className="px-4 py-3 font-medium text-navy">{doc.title}</td>
                  <td className="px-4 py-3">{doc.category}</td>
                  <td className="px-4 py-3">
                    <Badge tone="navy">{doc.current_revision}</Badge>
                  </td>
                  <td className="px-4 py-3">{doc.status}</td>
                  <td className="px-4 py-3 text-muted">
                    {new Date(doc.created_at).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })}
                  </td>
                  <td className="px-4 py-3">
                    {doc.category === "business_case" ? (
                      <a
                        href={`/documents/${doc.id}/intelligence`}
                        className="text-navy underline"
                        data-testid={`doc-intel-link-${doc.id}`}
                      >
                        تحليل
                      </a>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </div>
  );
}
