# Master Touch OS — V1.0 Known Limitations & Post-V1 Roadmap

---

## 1. Scope & Delivery Intent

The V1.0 release candidate of **Master Touch OS** is focused on delivering a stable, production-grade core for **Project Document Control, Supply Chain & Procurement, Client Commercial Revenue, and Employee Master Data / HR Baseline**.

The items below are **explicitly deferred post-V1 roadmap capabilities** that are designed to build upon the established V1.0 foundational data models and security boundaries.

---

## 2. Deferred Post-V1 Modules & Capabilities

### A. Human Resources & Payroll (Phases 4.3 – 4.6)
1. **Payroll Management (Phase 4.5)**
   - *Status:* Implemented in migration `059` (`payroll_settings`, `payroll_periods`, `payroll_entries`, segments, earnings, deductions, payments + engine v1 RPCs). Apply `supabase/phase4_fix_059.sql` on production before enabling.
   - *Known limits:* calendar proration only (standard payable days, default 30); no GOSI/WPS/Mudad/tax/EOS; no bank API; attendance financial impact only when org settings enable deductions; unlock-after-lock not supported in MVP; PDF payslip export deferred.
2. **Leave Management & Balances (Phase 4.3)**
   - *Status:* Implemented in migration `056` (`leave_types`, `employee_leave_balances`, `leave_requests`, manager→HR RPCs). Apply `supabase/phase4_fix_056.sql` on production before enabling.
   - *Known limits:* calendar/working day basis only (no public-holiday calendar yet); cross-year ranges rejected; attachment is document UUID reference (no dedicated leave upload UI); email/WhatsApp leave alerts deferred.
3. **Attendance & Time Tracking (Phase 4.4)**
   - *Status:* Implemented in migration `057` (+ RPC repair `058`). Apply `supabase/phase4_fix_057.sql` then `phase4_fix_058.sql` on production before enabling.
   - *Known limits:* self-service + HR adjust only (no biometric device sync / geofencing); holiday calendar not wired (status supports `holiday` when reconciled).
### B. Management Intelligence & AI (Phases 5.x)
1. **Executive Command Center (Phase 5.1)**
   - *Status:* Implemented as `/management` deterministic intelligence layer (aggregates + attention from risk engine). Gate: `reports.management.read`. No AI provider.
   - *Known limits:* no AI summarization (Phase 5.4); domain_events not queried (audit_logs only); no fabricated SLAs; payroll amounts only with `payroll.view_all`.
2. **Deterministic Risk & Alert Engine (Phase 5.2)**
   - *Status:* Implemented as pure `RiskEngine` over bounded `RiskInputSnapshot` (derived findings; no risks table). UI: `/management/risks`. ECC Attention Required summarizes the same findings.
   - *Known limits:* candidate row cap (`candidateLimit`); no acknowledgement/assignment lifecycle; no WhatsApp/email escalation (later); no repeated-absence trend rule; no contractual SLA claims; amounts/IBAN never projected into findings.
3. **Management Reports & Decision Briefs (Phase 5.3)**
   - *Status:* Deterministic report builders + `/management/reports/*` (executive, projects, operations, finance, people, payroll, risks). Print CSS + CSV for projects/operations/risks. No AI. No dedicated migration.
   - *Known limits:* finance report uses status counts (not money registers); historical reconstruction not supported (as-of + bounded audit only); no scheduled email/WhatsApp reports; department distribution bounded/primary only.
4. **AI Management Analyst (Phase 5.4)**
   - *Status:* Read-only `/management/analyst` over trusted report DTOs + RiskFinding[]. Provider abstraction (`none`|`mock`|`openai`), structured Zod output, citation verification, in-process rate limit. No write tools, no chat persistence, no RAG/pgvector. No dedicated migration (reuses report/risk DTOs).
   - *Known limits:* rate limit is per-process (not distributed); no conversation memory; AI observations ≠ official RiskFindings; human verification required; OpenAI-compatible HTTP only (no streaming SDK); mock provider for CI/E2E.
5. **AI Document & Business Case Intelligence (Phase 5.5)**
   - *Status:* Implemented in migration `061` (`document_intelligence`). Route `/documents/[id]/intelligence`. TXT/PDF/DOCX text extraction (no OCR), bounded chunking, evidence-grounded Business Case schema, human VERIFY gate, deterministic operational comparison after VERIFIED. Apply `supabase/phase5_apply_061.sql` before enabling.
   - *Known limits:* no OCR for scanned PDFs; no pgvector/embeddings/chat-with-PDF; deliverables have no structured system mapping (comparison states mapping unavailable — does not claim “missing”); document findings are NOT auto-merged into Phase 5.2 RiskFinding[]; synchronous extraction (Vercel timeout risk for very large files — 8MB/60k char bounds); in-process rate limit; OpenAI-compatible HTTP only.
6. **Saudi Statutory Labor Calculations**
   - *Status:* Deferred (post Phase 4.5). Extension points reserved; GOSI/EOS/WPS not implemented.
7. **Employee Expense Claims & Reimbursements**
   - *Status in V1:* Deferred.
   - *Post-V1:* Expense submission, receipt attachment, manager approval, and finance reimbursement batching.
8. **Offboarding & Exit Workflows**
   - *Status in V1:* Safe deactivation preserves complete historical records.
   - *Post-V1:* Formal clearance workflows, asset return checklists, and exit interview logs.
---

### B. Intelligent Automation & Integrations (Phases 5.x)
1. **AI Manager Assistant / Generative Insights**
   - *Status in V1:* Not included.
   - *Post-V1:* Natural language document queries, automated submittal summaries, and risk forecasting.
2. **External Messaging / WhatsApp / SMS Notifications**
   - *Status in V1:* System in-app notification center and domain events are active.
   - *Post-V1:* Direct WhatsApp Business API and SMS gateway dispatch for urgent approval alerts.
3. **Advanced Executive BI & Predictive Analytics**
   - *Status in V1:* High-performance operational counts and real-time entity status summaries are active.
   - *Post-V1:* Multi-project cash-flow forecasting, earned value management (EVM), and predictive procurement timeline analytics.

---

## 3. Post-V1 Technical Hardening Notes

1. **Banking Concurrency Partial Index:**
   - *Current Implementation:* Primary bank account uniqueness is serialized at the transactional RPC layer via `upsert_employee_banking` and `deactivate_employee_bank_account`.
   - *Post-V1 Hardening:* Add an explicit partial unique index on `employee_bank_accounts (employee_id) WHERE (is_primary = true AND is_active = true)`.
