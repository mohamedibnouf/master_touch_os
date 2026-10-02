/** Self-service attendance/leave on Home requires an employees row, not only RBAC. */
export function homeShowsSelfServiceCard(input: {
  hasEmployeeRow: boolean;
  permissionGranted: boolean;
}): boolean {
  return input.hasEmployeeRow && input.permissionGranted;
}
