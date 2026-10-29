"use client";

import { useState } from "react";
import { Field, Input, Select } from "@/components/ui/primitives";

export type AttendanceAdjustRecordOption = {
  id: string;
  label: string;
  /** Existing check-in as a Riyadh `datetime-local` value ("" when none). */
  checkInLocal: string;
  /** Existing check-out as a Riyadh `datetime-local` value ("" when none). */
  checkOutLocal: string;
};

/**
 * Record picker + check-in/out inputs for the HR adjustment form.
 * Picking a record pre-fills its current times in Riyadh wall-clock time, which
 * is also how the server interprets the submitted values (+03:00).
 */
export function AttendanceAdjustFields({
  records,
  labels,
}: {
  records: AttendanceAdjustRecordOption[];
  labels: {
    record: string;
    chooseRecord: string;
    checkIn: string;
    checkOut: string;
    timeZoneHint: string;
  };
}) {
  const [recordId, setRecordId] = useState("");
  const selected = records.find((r) => r.id === recordId);

  return (
    <>
      <div className="md:col-span-2">
        <Field label={labels.record}>
          <Select name="recordId" required value={recordId} onChange={(e) => setRecordId(e.target.value)}>
            <option value="">{labels.chooseRecord}</option>
            {records.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={labels.checkIn} hint={labels.timeZoneHint}>
        <Input
          key={`in-${recordId}`}
          type="datetime-local"
          name="checkInAt"
          defaultValue={selected?.checkInLocal ?? ""}
          dir="ltr"
        />
      </Field>
      <Field label={labels.checkOut} hint={labels.timeZoneHint}>
        <Input
          key={`out-${recordId}`}
          type="datetime-local"
          name="checkOutAt"
          defaultValue={selected?.checkOutLocal ?? ""}
          dir="ltr"
        />
      </Field>
    </>
  );
}
