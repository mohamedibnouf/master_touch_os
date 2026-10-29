import { Button, Select } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { inviteRfqSupplierAction, removeRfqSupplierAction } from "@/server/use-cases/procurement";
import { format, type Locale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/server";

export function RfqSupplierInvitePanel({
  rfqId,
  candidates,
  locale = "ar",
}: {
  rfqId: string;
  candidates: Array<{ id: string; supplier_code: string; legal_name: string }>;
  /** Label locale; Arabic unless passed. */
  locale?: Locale;
}) {
  const sourcing = getDictionary(locale).procurementSourcing;
  const tp = sourcing.invitePanel;
  return (
    <div className="mt-4 space-y-3 border-t border-line pt-4" data-testid="rfq-supplier-manage">
      <div>
        <h3 className="text-sm font-semibold text-ink">{tp.title}</h3>
        <p className="mt-1 text-xs text-muted">{tp.hint}</p>
      </div>
      {candidates.length === 0 ? (
        <p className="rounded-md bg-surface-muted px-3 py-2 text-sm text-muted">{tp.noCandidates}</p>
      ) : (
        <ServerActionForm action={inviteRfqSupplierAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="rfqId" value={rfqId} />
          <label className="grid min-w-56 flex-1 gap-1.5 text-sm">
            <span className="font-medium text-ink">{tp.supplier}</span>
            <Select name="supplierId" required defaultValue="" data-testid="rfq-invite-supplier">
              <option value="" disabled>
                {tp.selectSupplier}
              </option>
              {candidates.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {format(sourcing.common.codeName, { code: supplier.supplier_code, name: supplier.legal_name })}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit">{tp.invite}</Button>
        </ServerActionForm>
      )}
    </div>
  );
}

export function RfqSupplierRemoveButton({
  rfqId,
  invitationId,
  locale = "ar",
}: {
  rfqId: string;
  invitationId: string;
  /** Label locale; Arabic unless passed. */
  locale?: Locale;
}) {
  return (
    <ServerActionForm action={removeRfqSupplierAction}>
      <input type="hidden" name="rfqId" value={rfqId} />
      <input type="hidden" name="invitationId" value={invitationId} />
      <Button type="submit" variant="ghost">
        {getDictionary(locale).procurementSourcing.invitePanel.remove}
      </Button>
    </ServerActionForm>
  );
}
