# Attendance geofencing — privacy & operational boundaries (Phase 5.7)

- Location is requested **only** when the employee taps check-in or check-out. There is no live tracking.
- Exact coordinates are stored on `attendance_location_attempts` (restricted RLS). Daily `attendance_records` store workplace id, distance, accuracy, and verified flag — not lat/lng.
- Coordinates must not appear in notification bodies, AI analyst context, or generic audit text.
- Browser geolocation is a **business control**, not anti-spoofing.
- Rejected attempts are operational evidence only. They **must not** change salary.
- Location-attempt retention should become configurable in a later phase (no auto-purge in 063).
