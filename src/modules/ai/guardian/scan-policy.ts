export function shouldDispatchGuardianAlerts(settings: {
  alertsEnabled: boolean;
  baselineCompletedAt: string | null;
}): boolean {
  return Boolean(settings.alertsEnabled && settings.baselineCompletedAt);
}

export function shouldRecordBaseline(orgCoverageComplete: boolean): boolean {
  return orgCoverageComplete;
}

export function shouldMarkGuardianWindowCompleted(input: {
  coverageComplete: boolean;
  failed: boolean;
}): boolean {
  return !input.failed && input.coverageComplete;
}

export function remainingOrganizationIds(all: string[], processedComplete: string[]): string[] {
  const done = new Set(processedComplete);
  return all.filter((id) => !done.has(id));
}
