# Attendance geofencing — privacy & operational boundaries (Phase 5.7 / 5.7.1)

- Location is requested **only** when the employee taps check-in or check-out. There is no live tracking.
- Exact coordinates are stored on `attendance_location_attempts` (restricted RLS). Daily `attendance_records` store workplace id, distance, accuracy, and verified flag — not lat/lng.
- Coordinates must not appear in notification bodies, AI analyst context, or generic audit text.
- Browser geolocation is a **business control**, not anti-spoofing.
- Rejected attempts are operational evidence only. They **must not** change salary.

## Multi-workplace (Phase 5.7.1 / migration 064)

- An organization may have unlimited workplaces. Authorization is **explicit** via `employee_workplace_assignments` only.
- There is **no** “all current/future locations” flag. New workplaces never silently authorize anyone.
- The organization **primary** workplace is for HR/UI only. It does **not** authorize punches.
- No assignment covering Riyadh today → `NO_WORKPLACE`.
- Overlapping assignment dates are allowed for **different** workplaces. The same employee + same workplace cannot overlap.
- On punch, the client sends only lat/lng/accuracy. The server matches the **nearest** authorized **active** workplace that is inside that site’s radius **and** meets that site’s `max_accuracy_meters` (if set). Equal distance → lower workplace UUID.
- Accuracy failure at site A does not reject site B if B is in range and accuracy-ok.
- Check-out may be from **any currently authorized** workplace, not necessarily the check-in site. Worked minutes / payroll are unchanged.
- Retire locations with `is_active = false`. Do not hard-delete a workplace that has assignments or attendance history (064 uses `ON DELETE RESTRICT` on history FKs).
- Employee directory (`workplace_locations_directory`) still omits latitude/longitude.
- Location-attempt retention should become configurable in a later phase (no auto-purge in 063/064).
- **064 is not applied until review.** Apply `supabase/phase5_apply_064.sql` (byte-identical to `supabase/migrations/064_phase5_multi_workplace_attendance.sql`) only after the app is deployed.
