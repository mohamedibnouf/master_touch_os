/** App-level mirror of document_versions_select after 065. Not a substitute for RLS. */
export function canSelectDocumentVersion(input: {
  hasDocumentRead: boolean;
  documentOrganizationId: string;
  actorOrganizationId: string;
  documentProjectId: string | null;
  accessibleProjectIds: readonly string[];
}): boolean {
  if (input.documentOrganizationId !== input.actorOrganizationId) return false;
  if (input.hasDocumentRead) return true;
  if (!input.documentProjectId) return false;
  return input.accessibleProjectIds.includes(input.documentProjectId);
}
