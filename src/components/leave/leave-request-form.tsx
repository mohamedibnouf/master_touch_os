"use client";

import { useActionState, useMemo, useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { calculateLeaveDays, type LeaveDayBasis } from "@/lib/leave/days";
import { submitLeaveRequestAction } from "@/server/use-cases/leave";
import type { FormActionState } from "@/server/forms/form-state";
import { useI18n } from "@/lib/i18n/client";

type LeaveTypeOption = {
  id: string;
  name: string;
  requires_attachment: boolean;
  minimum_notice_days: number;
  allow_negative_balance: boolean;
};

export function LeaveRequestForm({
  types,
  balances,
  dayBasis,
}: {
  types: LeaveTypeOption[];
  balances: Array<{ leave_type_id: string; available_days: number }>;
  dayBasis: LeaveDayBasis;
}) {
  const { t } = useI18n();
  const tf = t.leave.form;
  const [leaveTypeId, setLeaveTypeId] = useState(types[0]?.id ?? "");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [attachmentDocumentId, setAttachmentDocumentId] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState<FormActionState, FormData>(
    submitLeaveRequestAction,
    null,
  );

  const available = useMemo(() => {
    const b = balances.find((x) => x.leave_type_id === leaveTypeId);
    return b?.available_days ?? 0;
  }, [balances, leaveTypeId]);

  const days = useMemo(() => {
    if (!startDate || !endDate) return null;
    try {
      return calculateLeaveDays(startDate, endDate, dayBasis);
    } catch {
      return null;
    }
  }, [startDate, endDate, dayBasis]);

  const selectedType = types.find((ty) => ty.id === leaveTypeId);
  const attachmentRequired = Boolean(selectedType?.requires_attachment);

  function onSubmit(formData: FormData) {
    setClientError(null);
    if (attachmentRequired && !String(formData.get("attachmentDocumentId") ?? "").trim()) {
      setClientError(tf.attachmentMissing);
      return;
    }
    formAction(formData);
  }

  const error = clientError || (state && !state.ok ? state.message : null);

  return (
    <form action={onSubmit} className="grid gap-4" data-testid="leave-request-form">
      <fieldset disabled={pending} className="grid min-w-0 gap-4 border-0 p-0">
      <Field label={tf.leaveType}>
        <Select
          name="leaveTypeId"
          value={leaveTypeId}
          onChange={(e) => setLeaveTypeId(e.target.value)}
          required
          data-testid="leave-type"
        >
          {types.map((ty) => (
            <option key={ty.id} value={ty.id}>
              {ty.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={tf.startDate}>
          <Input
            name="startDate"
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            data-testid="leave-start"
          />
        </Field>
        <Field label={tf.endDate}>
          <Input
            name="endDate"
            type="date"
            required
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            data-testid="leave-end"
          />
        </Field>
      </div>
      <div className="grid gap-3 rounded-lg border border-line bg-surface-muted p-3 text-sm sm:grid-cols-2">
        <p className="flex items-baseline justify-between gap-2">
          <span className="text-muted">{tf.calculatedDays}</span>
          <strong className="text-base font-semibold tabular-nums text-ink" data-testid="leave-days">
            {days ?? "—"}
          </strong>
        </p>
        <p className="flex items-baseline justify-between gap-2">
          <span className="text-muted">{tf.availableBalance}</span>
          <strong className="text-base font-semibold tabular-nums text-primary" data-testid="leave-available">
            {available}
          </strong>
        </p>
      </div>
      <Field label={attachmentRequired ? tf.attachmentRequired : tf.attachmentOptional}>
        <Input
          name="attachmentDocumentId"
          value={attachmentDocumentId}
          onChange={(e) => setAttachmentDocumentId(e.target.value)}
          placeholder={tf.attachmentPlaceholder}
          required={attachmentRequired}
          data-testid="leave-attachment"
        />
      </Field>
      {attachmentRequired ? (
        <p className="text-sm text-warning">{tf.attachmentHint}</p>
      ) : null}
      <Field label={tf.reason}>
        <Textarea name="reason" data-testid="leave-reason" />
      </Field>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <Button type="submit" className="w-full sm:w-auto" disabled={pending} data-testid="leave-submit">
        {pending ? tf.submitting : tf.submit}
      </Button>
      </fieldset>
    </form>
  );
}
