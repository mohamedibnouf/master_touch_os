import type { ManagementSectionFlags } from "@/modules/management/types";
import type { ManagementRiskCategory } from "@/modules/management/types";

export function findingVisibleForSections(
  category: ManagementRiskCategory | string,
  sections: ManagementSectionFlags,
): boolean {
  switch (category) {
    case "PROJECT_DELAY":
      return sections.projects;
    case "APPROVAL_DELAY":
      return sections.approvals;
    case "PROCUREMENT":
      return sections.procurement;
    case "COMMERCIAL":
      return sections.finance;
    case "COMPLIANCE":
      return sections.compliance;
    case "HR":
      return sections.contracts || sections.people;
    case "ATTENDANCE":
    case "LEAVE":
      return sections.attendanceLeave;
    case "PAYROLL":
      return sections.payroll;
    default:
      return false;
  }
}
