/** Which project-detail datasets are required for the active tab. */

export function projectNeedsStagePackages(tab: string): boolean {
  return tab === "stages";
}

export function projectNeedsOrgUserDirectory(tab: string): boolean {
  return tab === "stages" || tab === "team" || tab === "approvals";
}

export function projectNeedsDocumentCatalog(tab: string): boolean {
  return tab === "documents" || tab === "stages";
}

export function projectNeedsActivity(tab: string): boolean {
  return tab === "activity";
}

export function projectNeedsEngineeringBundle(tab: string): boolean {
  return (
    tab === "engineering" ||
    tab === "rfis" ||
    tab === "submittals" ||
    tab === "shop" ||
    tab === "inspections" ||
    tab === "ncr" ||
    tab === "reports" ||
    tab === "correspondence"
  );
}

export function projectNeedsCommercialBundle(tab: string): boolean {
  return tab === "commercial";
}

export function currentPackageStepKeys(
  nodes: Array<{
    stepKey: string | null;
    canComplete?: boolean;
    visual?: string;
    engineStatus?: string | null;
  }>,
): string[] {
  const keys = new Set<string>();
  for (const node of nodes) {
    if (!node.stepKey) continue;
    if (
      node.canComplete === true ||
      node.visual === "current" ||
      node.engineStatus === "ready" ||
      node.engineStatus === "in_progress"
    ) {
      keys.add(node.stepKey);
    }
  }
  return [...keys];
}
