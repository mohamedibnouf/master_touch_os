# Phase 5.7 / 5.7.1 — Attendance geofencing

**063 is applied** (immutable). **064 is not applied.** Apply 064 only after this review, from `supabase/phase5_apply_064.sql` (byte-identical to `supabase/migrations/064_phase5_multi_workplace_attendance.sql`).

Do not edit 001–063. Do not create 065. Do not start Phase 5.8.

## Safe rollout (064)

1. Deploy this multi-workplace application **first** (matching still works with a single assignment on 063 until 064 is applied; overlapping second sites will fail until 064).
2. Apply `supabase/phase5_apply_064.sql` in the SQL editor (preflight aborts if same-site overlapping assignment rows already exist).
3. Assign each employee explicitly to every workplace they may punch. Org primary does **not** authorize attendance.
4. Confirm punches still use 3-arg RPCs. Zero-arg overloads remain fail-closed (`GEOFENCE_LOCATION_REQUIRED`).

## 064 behavior

- Eligible set = covering **explicit** assignments of **active** workplaces (Riyadh today).
- Nearest valid site wins (per-site radius + accuracy). Tie-break: workplace id.
- Check-out from any currently authorized site.
- Deactivate rather than delete historical workplaces.
