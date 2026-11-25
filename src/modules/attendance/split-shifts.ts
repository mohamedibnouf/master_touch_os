import type { AttendanceRecord, AttendanceShift, EmployeeShiftAssignment } from "@/types/models";

/**
 * Split shifts (092): an employee may hold several shifts on the same day (e.g. 08–12 and
 * 16–20) and checks in / out once per shift. These helpers decide what the self-service
 * screens show; the database RPCs remain the authority on which shift a punch lands on.
 */

export type SplitShiftLike = Pick<
  AttendanceShift,
  "id" | "start_time" | "end_time" | "crosses_midnight" | "working_days"
>;

export type SplitRecordLike = Pick<
  AttendanceRecord,
  | "id"
  | "shift_id"
  | "attendance_date"
  | "check_in_at"
  | "check_out_at"
  | "scheduled_end"
  | "attendance_status"
  | "worked_minutes"
  | "late_minutes"
  | "early_leave_minutes"
>;

export type ShiftRowState = "not_started" | "open" | "done";

export type TodayShiftRow<S extends SplitShiftLike, R extends SplitRecordLike> = {
  shift: S | null;
  record: R | null;
  state: ShiftRowState;
};

function timeKey(value: string): string {
  return String(value).slice(0, 8);
}

/** Shifts scheduled on this weekday (0 = Sunday), earliest first. Falls back to all shifts on an off day. */
export function shiftsForWeekday<S extends SplitShiftLike>(shifts: S[], dow: number): S[] {
  const sorted = [...shifts].sort((a, b) => timeKey(a.start_time).localeCompare(timeKey(b.start_time)));
  const working = sorted.filter((s) => (s.working_days ?? []).map(Number).includes(dow));
  return working.length > 0 ? working : sorted;
}

function rowState(record: SplitRecordLike | null): ShiftRowState {
  if (!record?.check_in_at) return "not_started";
  return record.check_out_at ? "done" : "open";
}

/**
 * One row per shift of the day with its attendance row (if any). Rows whose shift is no
 * longer assigned (or a still-open night shift from yesterday) are appended so nothing
 * recorded is hidden.
 */
export function buildTodayShiftRows<S extends SplitShiftLike, R extends SplitRecordLike>(
  shifts: S[],
  todayRecords: R[],
  carriedOpenRecords: R[] = [],
): TodayShiftRow<S, R>[] {
  const used = new Set<string>();
  const rows: TodayShiftRow<S, R>[] = [];
  for (const open of carriedOpenRecords) {
    used.add(open.id);
    rows.push({ shift: null, record: open, state: rowState(open) });
  }
  for (const shift of shifts) {
    const record = todayRecords.find((r) => r.shift_id === shift.id && !used.has(r.id)) ?? null;
    if (record) used.add(record.id);
    rows.push({ shift, record, state: rowState(record) });
  }
  for (const record of todayRecords) {
    if (used.has(record.id)) continue;
    rows.push({ shift: null, record, state: rowState(record) });
  }
  return rows;
}

export type TodayPunchState<R extends SplitRecordLike> = {
  /** Most recent row checked in and not out (may be yesterday's night shift). */
  openRecord: R | null;
  /** The row whose status headlines the day. */
  headlineRecord: R | null;
  canCheckIn: boolean;
  canCheckOut: boolean;
  /** Some shift is finished and another of today's shifts is still to be checked in. */
  betweenShifts: boolean;
  totals: { worked: number; late: number; early: number };
};

function latestBy<R>(rows: R[], pick: (r: R) => string | null): R | null {
  let best: R | null = null;
  let bestKey = "";
  for (const r of rows) {
    const key = pick(r);
    if (key && key > bestKey) {
      best = r;
      bestKey = key;
    }
  }
  return best;
}

export function todayPunchState<R extends SplitRecordLike>(input: {
  shiftsToday: SplitShiftLike[];
  todayRecords: R[];
  /** Open rows of yesterday (night shift still running past midnight). */
  carriedOpenRecords?: R[];
  now?: Date;
}): TodayPunchState<R> {
  const now = (input.now ?? new Date()).getTime();
  const all = [...(input.carriedOpenRecords ?? []), ...input.todayRecords];
  const openRecord = latestBy(
    all.filter((r) => r.check_in_at && !r.check_out_at),
    (r) => r.check_in_at,
  );
  const openStillRunning =
    openRecord != null && (!openRecord.scheduled_end || now <= new Date(openRecord.scheduled_end).getTime());

  const checkedInShiftIds = new Set(
    input.todayRecords.filter((r) => r.check_in_at && r.shift_id).map((r) => r.shift_id as string),
  );
  const pendingShifts = input.shiftsToday.filter((s) => !checkedInShiftIds.has(s.id));
  const anyCheckedInToday = input.todayRecords.some((r) => r.check_in_at);

  // No shift assigned: keep the pre-092 behaviour (button shown, server explains).
  const hasPending = input.shiftsToday.length === 0 ? !anyCheckedInToday : pendingShifts.length > 0;

  const headlineRecord =
    openRecord ??
    latestBy(input.todayRecords, (r) => r.check_out_at ?? r.check_in_at) ??
    input.todayRecords[0] ??
    null;

  const totals = input.todayRecords.reduce(
    (acc, r) => ({
      worked: acc.worked + (r.worked_minutes ?? 0),
      late: acc.late + (r.late_minutes ?? 0),
      early: acc.early + (r.early_leave_minutes ?? 0),
    }),
    { worked: 0, late: 0, early: 0 },
  );

  return {
    openRecord,
    headlineRecord,
    canCheckIn: !openStillRunning && hasPending,
    canCheckOut: openRecord != null,
    betweenShifts: openRecord == null && anyCheckedInToday && hasPending,
    totals,
  };
}

export type ShiftAssignmentState = "current" | "ended" | "upcoming";

export function shiftAssignmentState(
  assignment: Pick<EmployeeShiftAssignment, "effective_from" | "effective_to">,
  today: string,
): ShiftAssignmentState {
  if (assignment.effective_from > today) return "upcoming";
  if (assignment.effective_to != null && assignment.effective_to < today) return "ended";
  return "current";
}

const SHIFT_ASSIGNMENT_ERRORS: Array<[RegExp, { ar: string; en: string }]> = [
  [
    /SHIFT_TIME_OVERLAP/,
    {
      ar: "ساعات هذه الوردية تتداخل مع وردية أخرى معيّنة للموظف في نفس الفترة. اختر وردية لا تتداخل أو أنهِ الوردية الأخرى أولاً.",
      en: "This shift's hours overlap another shift the employee already has for those dates. Pick a non-overlapping shift or end the other one first.",
    },
  ],
  [
    /SHIFT_ALREADY_ASSIGNED|employee_shift_assignments_same_shift_no_overlap/,
    {
      ar: "هذه الوردية معيّنة للموظف بالفعل في فترة متداخلة.",
      en: "The employee already has this shift for overlapping dates.",
    },
  ],
  [
    /SHIFT_ASSIGNMENT_HAS_ATTENDANCE/,
    {
      ar: "لا يمكن حذف التعيين لأن للموظف حضوراً مسجّلاً على هذه الوردية. استخدم «إنهاء» بدلاً من ذلك.",
      en: "This assignment has attendance recorded on it, so it cannot be deleted. Use End instead.",
    },
  ],
  [
    /SHIFT_END_BEFORE_START/,
    {
      ar: "آخر يوم لا يمكن أن يسبق تاريخ بداية التعيين. لإلغاء تعيين لم يبدأ استخدم «حذف».",
      en: "The last day cannot be before the assignment starts. To cancel one that has not started, use Delete.",
    },
  ],
  [
    /SHIFT_END_EXTENDS/,
    {
      ar: "لا يمكن تمديد التعيين بعد تاريخ انتهائه الحالي. أنشئ تعييناً جديداً بدلاً من ذلك.",
      en: "An assignment cannot be extended past its current end. Create a new assignment instead.",
    },
  ],
];

/** Friendly message for a shift-assignment RPC error, or null if it is not one of ours. */
export function shiftAssignmentErrorMessage(
  error: { message?: string | null; code?: string | null } | null | undefined,
): { ar: string; en: string } | null {
  const msg = `${error?.message ?? ""}`;
  for (const [re, text] of SHIFT_ASSIGNMENT_ERRORS) {
    if (re.test(msg)) return text;
  }
  if (error?.code === "23P01") return SHIFT_ASSIGNMENT_ERRORS[1][1];
  return null;
}
