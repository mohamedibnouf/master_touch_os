import { Field, Input, Button } from "@/components/ui/primitives";
import { attachEntityDocumentAction } from "@/server/use-cases/commercial";
import { ServerActionForm } from "@/components/forms/server-action-form";

type Props = {
  entityType: string;
  entityId: string;
  projectId?: string;
  revalidatePath: string;
  label?: string;
  testId?: string;
};

export function EntityAttachmentForm({
  entityType,
  entityId,
  projectId,
  revalidatePath: path,
  label = "إرفاق ملف",
  testId = "entity-attachment-form",
}: Props) {
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
      <Field label={label}>
        <Input type="file" name="file" required data-testid="attachment-file" />
      </Field>
      <Button type="submit" data-testid="attachment-submit">
        رفع
      </Button>
    </ServerActionForm>
  );
}
