import type { ReactNode } from "react";
import { FolderKanban, Stamp, Users, AlertTriangle } from "lucide-react";
import { Card, StatCard } from "@/components/ui/primitives";
import { DonutChart, HorizontalBarList, StackedCountBars } from "@/components/charts/semantic-charts";
import type { DashboardViz } from "@/server/use-cases/dashboard-viz";

export function HomeDashboardViz({ viz }: { viz: DashboardViz }) {
  const kpis = [
    viz.kpis.activeProjects != null
      ? {
          label: "المشاريع النشطة",
          value: viz.kpis.activeProjects,
          tone: "info" as const,
          icon: <FolderKanban className="h-4 w-4" />,
        }
      : null,
    viz.kpis.pendingApprovals != null
      ? {
          label: "الموافقات المعلقة",
          value: viz.kpis.pendingApprovals,
          tone: "warning" as const,
          icon: <Stamp className="h-4 w-4" />,
        }
      : null,
    viz.kpis.overdueStages != null
      ? {
          label: "المراحل المتأخرة",
          value: viz.kpis.overdueStages,
          tone: "danger" as const,
          icon: <AlertTriangle className="h-4 w-4" />,
        }
      : null,
    viz.kpis.activeEmployees != null
      ? {
          label: "الموظفون النشطون",
          value: viz.kpis.activeEmployees,
          tone: "success" as const,
          icon: <Users className="h-4 w-4" />,
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
          <HorizontalBarList title="تقدم المشاريع" rows={viz.progressRows} />
        </Card>
        <Card className="min-w-0 lg:col-span-5">
          <DonutChart
            title="حالة المشاريع"
            segments={viz.projectStatus}
            centerValue={viz.projectStatusTotal}
            centerLabel="إجمالي"
          />
        </Card>
        <Card className="min-w-0 lg:col-span-7">
          <StackedCountBars title="حالة المراحل" rows={viz.stageAttention} />
        </Card>
        <Card className="min-w-0 lg:col-span-5">
          <DonutChart
            title="الموافقات"
            segments={viz.approvalStatus}
            centerValue={viz.approvalTotal}
            centerLabel="إجمالي"
          />
        </Card>
      </div>
    </div>
  );
}
