import Link from "next/link";
import { PageContainer } from "@/components/layout/page-container";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createProjectAction } from "@/server/use-cases/platform";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { Button, Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui/primitives";
import { CoreRepository } from "@/server/repositories/core.repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

const PRIORITIES = ["low", "medium", "high", "critical"] as const;

export default async function NewProjectPage() {
  const ctx = authorize(await getAuthContext(), "project.create");
  const { t, locale } = await getI18n();
  const tp = t.projects;
  const supabase = await createServerSupabaseClient();
  const repo = new CoreRepository(supabase);
  const users = await repo.listUsers(ctx.organization.id);

  return (
    <PageContainer className="mx-auto max-w-2xl">
      <PageHeader title={tp.newTitle} description={tp.newDescription} />
      <Card className="md:p-6">
        <ServerActionForm action={createProjectAction} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tp.nameAr} required>
              <Input name="name_ar" required dir="rtl" lang="ar" />
            </Field>
            <Field label={tp.nameEn} required>
              <Input name="name_en" required dir="ltr" lang="en" />
            </Field>
          </div>
          <Field label={tp.descriptionField}>
            <Textarea name="description" dir="auto" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tp.manager}>
              <Select name="project_manager_id" defaultValue="">
                <option value="">{tp.unassigned}</option>
                {users.map((row) => {
                  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
                  return (
                    <option key={row.profile_id} value={row.profile_id}>
                      {pickLocalized(locale, profile?.full_name_ar, profile?.full_name_en) || row.profile_id}
                    </option>
                  );
                })}
              </Select>
            </Field>
            <Field label={tp.priority}>
              <Select name="priority" defaultValue="medium">
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {tp.priorities[p]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tp.startDate}>
              <Input name="start_date" type="date" />
            </Field>
            <Field label={tp.plannedEndDate}>
              <Input name="planned_end_date" type="date" />
            </Field>
          </div>
          <Field label={tp.location}>
            <Input name="location" dir="auto" />
          </Field>
          <div className="flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:justify-end">
            <Link href="/projects">
              <Button type="button" variant="ghost" className="w-full sm:w-auto">
                {tp.cancel}
              </Button>
            </Link>
            <Button type="submit" className="w-full sm:w-auto">
              {tp.save}
            </Button>
          </div>
        </ServerActionForm>
      </Card>
    </PageContainer>
  );
}
