import { PageContainer } from "@/components/layout/page-container";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createProjectAction } from "@/server/use-cases/platform";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { Button, Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui/primitives";
import { CoreRepository } from "@/server/repositories/core.repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function NewProjectPage() {
  const ctx = authorize(await getAuthContext(), "project.create");
  const supabase = await createServerSupabaseClient();
  const repo = new CoreRepository(supabase);
  const users = await repo.listUsers(ctx.organization.id);

  return (
    <PageContainer className="mx-auto max-w-2xl">
      <PageHeader title="إنشاء مشروع" description="يتم توليد رمز المشروع تلقائياً وبشكل آمن من قاعدة البيانات" />
      <Card>
        <ServerActionForm action={createProjectAction} className="space-y-4">
          <Field label="اسم المشروع بالعربية">
            <Input name="name_ar" required />
          </Field>
          <Field label="Project name">
            <Input name="name_en" required />
          </Field>
          <Field label="الوصف">
            <Textarea name="description" />
          </Field>
          <Field label="مدير المشروع">
            <Select name="project_manager_id" defaultValue="">
              <option value="">بدون تعيين</option>
              {users.map((row) => {
                const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
                return (
                  <option key={row.profile_id} value={row.profile_id}>
                    {profile?.full_name_ar || profile?.full_name_en || row.profile_id}
                  </option>
                );
              })}
            </Select>
          </Field>
          <Field label="الأولوية">
            <Select name="priority" defaultValue="medium">
              <option value="low">منخفضة</option>
              <option value="medium">متوسطة</option>
              <option value="high">مرتفعة</option>
              <option value="critical">حرجة</option>
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="تاريخ البداية">
              <Input name="start_date" type="date" />
            </Field>
            <Field label="تاريخ الانتهاء المخطط">
              <Input name="planned_end_date" type="date" />
            </Field>
          </div>
          <Field label="الموقع">
            <Input name="location" />
          </Field>
          <Button type="submit" className="w-full sm:w-auto">
            حفظ المشروع
          </Button>
        </ServerActionForm>
      </Card>
    </PageContainer>
  );
}
