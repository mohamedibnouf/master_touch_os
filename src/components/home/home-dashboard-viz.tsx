import type { ReactNode } from "react";
import { FolderKanban, Stamp, Users, AlertTriangle } from "lucide-react";
import { Card, StatCard } from "@/components/ui/primitives";
import { DonutChart, HorizontalBarList, StackedCountBars } from "@/components/charts/semantic-charts";
import type { DashboardViz } from "@/server/use-cases/dashboard-viz";
import { getI18n } from "@/lib/i18n/server";

export async function HomeDashboardViz({ viz }: { viz: DashboardViz }) {
  const { t } = await getI18n();
  const kpis = [
    viz.kpis.activeProjects != null
      ? {
          label: t.home.kpiActiveProjects,
          value: viz.kpis.activeProjects,
          tone: "info" as const,
          icon: <FolderKanban className="size-5" />,
        }
      : null,
    viz.kpis.pendingApprovals != null
      ? {
          label: t.home.kpiPendingApprovals,
          value: viz.kpis.pendingApprovals,
          tone: "warning" as const,
          icon: <Stamp className="size-5" />,
        }
      : null,
    viz.kpis.overdueStages != null
      ? {
          label: t.home.kpiOverdueStages,
          value: viz.kpis.overdueStages,
          tone: "danger" as const,
          icon: <AlertTriangle className="size-5" />,
        }
      : null,
    viz.kpis.activeEmployees != null
      ? {
          label: t.home.kpiActiveEmployees,
          value: viz.kpis.activeEmployees,
          tone: "success" as const,
          icon: <Users className="size-5" />,
        }
      : null,
  ].filter(Boolean) as Array<{
    label: string;
    value: number;
    tone: "info" | "warning" | "danger" | "success";
    icon: ReactNode;
  }>;

  return (
    <div className="space-y-4" data-testid="home-dashboard-viz">
      {kpis.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((kpi) => (
            <StatCard key={kpi.label} label={kpi.label} value={kpi.value} icon={kpi.icon} tone={kpi.tone} />
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="min-w-0 lg:col-span-7">
          <HorizontalBarList title={t.home.chartProjectProgress} emptyLabel={t.common.noDataYet} rows={viz.progressRows} />
        </Card>
        <Card className="min-w-0 lg:col-span-5">
          <DonutChart
            emptyLabel={t.common.noDataYet}
            title={t.home.chartProjectStatus}
            segments={viz.projectStatus}
            centerValue={viz.projectStatusTotal}
            centerLabel={t.home.chartTotal}
          />
        </Card>
        <Card className="min-w-0 lg:col-span-7">
          <StackedCountBars title={t.home.chartStageStatus} emptyLabel={t.common.noDataYet} rows={viz.stageAttention} />
        </Card>
        <Card className="min-w-0 lg:col-span-5">
          <DonutChart
            emptyLabel={t.common.noDataYet}
            title={t.home.chartApprovals}
            segments={viz.approvalStatus}
            centerValue={viz.approvalTotal}
            centerLabel={t.home.chartTotal}
          />
        </Card>
      </div>
    </div>
  );
}
