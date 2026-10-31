import Link from "next/link";
import { PageContainer } from "@/components/layout/page-container";
import { EmptyState } from "@/components/ui/primitives";
import { getI18n } from "@/lib/i18n/server";

export default async function TaskNotFound() {
  const { t } = await getI18n();
  const nf = t.tasksDetail.notFound;
  return (
    <PageContainer variant="form" data-testid="task-not-found">
      <EmptyState
        title={nf.title}
        description={nf.body}
        action={
          <Link
            href="/tasks"
            className="inline-flex min-h-10 items-center justify-center rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            {nf.back}
          </Link>
        }
      />
    </PageContainer>
  );
}
