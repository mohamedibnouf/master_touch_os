import { Field, Input, Button } from "@/components/ui/primitives";
import { attachEntityDocumentAction } from "@/server/use-cases/commercial";
import { ServerActionForm } from "@/components/forms/server-action-form";
import type { Locale } from "@/lib/i18n/config";
import { commercialComponentLabels } from "./labels";

type Props = {
  entityType: string;
  entityId: string;
  projectId?: string;
  revalidatePath: string;
  label?: string;
  testId?: string;
  /** Label locale; Arabic unless passed. */
  locale?: Locale;
};

export function EntityAttachmentForm({
  entityType,
  entityId,
  projectId,
  revalidatePath: path,
  label,
  testId = "entity-attachment-form",
  locale = "ar",
}: Props) {
  const l = commercialComponentLabels(locale);
  return (
    <ServerActionForm
      action={attachEntityDocumentAction}
      className="flex flex-wrap items-end gap-3"
      data-testid={testId}
    >
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="entityId" value={entityId} />
      {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
      <input type="hidden" name="revalidatePath" value={path} />
      <Field label={label ?? l.attachmentLabel}>
        <Input type="file" name="file" required data-testid="attachment-file" />
      </Field>
      <Button type="submit" data-testid="attachment-submit">
        {l.attachmentSubmit}
      </Button>
    </ServerActionForm>
  );
}
