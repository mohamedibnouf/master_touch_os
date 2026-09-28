import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { ManagementNav } from "@/components/management/management-nav";
import { ManagementAnalystClient } from "@/components/management/management-analyst-client";
import { getAuthContext } from "@/server/context";
import { canViewManagement } from "@/modules/management/access";
import { getManagementAIConfig } from "@/modules/management/ai/config";
import { riyadhTodayYmd } from "@/modules/management/riyadh-date";

export default async function ManagementAnalystPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");

  const cfg = getManagementAIConfig();
  const asOfDate = riyadhTodayYmd();

  return (
    <PageContainer data-testid="management-analyst" className="space-y-5">
      <PageHeader
        title="محلل الإدارة (ذكاء اصطناعي)"
        description="قراءة فقط — يعتمد حصراً على تقارير المخاطر والبيانات الإدارية المصرّح بها. لا يكتب في النظام."
      />
      <ManagementNav pathname="/management/analyst" />
      <ManagementAnalystClient
        asOfDate={asOfDate}
        aiEnabled={cfg.enabled}
        providerLabel={cfg.enabled ? `${cfg.provider}${cfg.model ? ` / ${cfg.model}` : ""}` : "none"}
      />
    </PageContainer>
  );
}
