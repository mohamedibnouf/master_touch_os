# Phases 5.6–5.9 readiness (audit only — not implemented in 5.5.1)

Reusable today: `NotificationService` + `notifications` + `notification_deliveries`,
in-app channel, stub `EmailChannel` / `WhatsAppChannel` / `PushChannel`,
`NotificationPayload.entityType/entityId`, existing leave/attendance/payroll/approval events.

| Track | Reuse | Missing | DB? | External | Security |
| --- | --- | --- | --- | --- | --- |
| A. Email | Service + deliveries | Provider adapter, templates, bounce handling | Likely preference columns | SMTP/API (e.g. SES) | No secrets in client; PII in body |
| B. WhatsApp | Same service | Meta Cloud API, opt-in, templates | Yes (phone, consent) | WhatsApp Business | Consent + number privacy |
| C. Web Push | Pass-through `sw.js` | VAPID keys, subscription table, push adapter | Yes (`push_subscriptions`) | Browser Push | Endpoint is a secret; user consent |
| D. Reminders | Server time / Riyadh dates | Scheduler/cron/queue | Yes (jobs) | Worker | Idempotent, tenant-scoped |
| E. Escalation | Approval steps + due_at + risk engine | Escalation policy tables, SLA | Yes | None required | Do not auto-approve |
| F. Manager summaries | Reports + Analyst | Scheduled digest job | Maybe | Email/push | Same RBAC as reports |
| G. Geofence attendance | Attendance records, server time | Workplace locations, lat/lng, radius, accuracy, permission denial, evidence | **Yes (new tables)** | Browser Geolocation | GPS spoofing is not solvable in browser; store accuracy + client UA; never trust client alone |
| H–I. HR incentives/deductions | Payroll adjustments exist | Policy engine, recurring rules | Likely | None | Payroll privacy |
| J. Payroll input generation | Attendance minutes + leave days | Job that writes draft payroll inputs | Maybe | None | No browser service role |

Geofencing note (5.8): need workplaces (org+project/site), allowed radius, optional shift binding,
browser permission UX, accuracy threshold, offline denial, and audit fields. Client coords are
evidence, not proof.
