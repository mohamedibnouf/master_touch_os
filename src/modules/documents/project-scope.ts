import { ValidationError } from "@/lib/errors";

export function assertProjectBelongsToOrganization(
  project: { id: string; organization_id: string } | null,
  organizationId: string,
): void {
  if (!project || project.organization_id !== organizationId) {
    throw new ValidationError("المشروع المحدد غير صالح.", "The selected project is not valid.");
  }
}
