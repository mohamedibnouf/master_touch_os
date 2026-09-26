# Phase 5.7 — Attendance geofencing (migration review)

**063 is not applied.** Apply only after this hardening review, from `supabase/phase5_apply_063.sql` (byte-identical to `supabase/migrations/063_phase5_attendance_geofencing.sql`).

Do not apply 001–062. Do not create 064. Do not start Phase 5.8.

## Safe rollout (required)

1. Deploy this geo-aware application **first** (feature detection: if 063 tables/views are missing, UI still uses zero-arg 058 punch).
2. Apply `supabase/phase5_apply_063.sql` in the SQL editor.
3. Configure at least one workplace (employee assignment or org primary).
4. Confirm punches use 3-arg RPCs. Zero-arg overloads remain but **fail closed** (`GEOFENCE_LOCATION_REQUIRED`) — they never record attendance without a geofence.

Do **not** apply 063 before this application is in production.

## Hardening in this revision

- Invalid coordinates persist as NULL/NULL, never fabricated 0,0.
- Punch RPCs return jsonb `{ accepted, reason_code, attempt_id, attendance_record }` so rejected attempts COMMIT. Zero-arg remains fail-closed.
- Employee-facing `workplace_locations_directory` omits HQ lat/lng.
- Accuracy column is `max_accuracy_meters` (accept if reported accuracy ≤ threshold).
