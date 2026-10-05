# Master Touch Intelligence Platform

Advisory AI layer for project, document, and management intelligence. AI **reads, analyzes, summarizes, explains, and recommends**. It does **not** approve, reject, complete stages, mutate payroll/attendance/employees, send email/WhatsApp, or run privileged database operations.

## Architecture

Unified module: `src/modules/ai/`

- **Provider:** `AiProvider` (`generateStructured`, `generateText`) with `OpenAIProvider` (server `fetch` to OpenAI-compatible Chat Completions) and `MockAiProvider`.
- **Existing reuse:** Management Analyst (`src/modules/management/ai`) and Document Intelligence (`src/modules/document-intelligence`) now honor `AI_ENABLED` and `AI_PROVIDER` / `OPENAI_API_KEY` with legacy `MANAGEMENT_AI_*` / `DOCUMENT_AI_*` aliases.
- **Context:** `buildProjectAiContext` — org-scoped project, workflow projection, document **metadata**, recent activity. No payroll, tokens, or unrelated employees.
- **Health/risk:** Deterministic in `src/modules/ai/health.ts`. AI explains; it cannot change health or invent evidence.
- **Actions:** `src/server/use-cases/ai-platform.ts` (auth → permission → load authorized data → provider).

## Permissions

| Key | Super Admin | General Manager | Operations Manager | Project Manager |
|-----|-------------|-----------------|--------------------|-----------------|
| `ai.use` | yes | yes | yes | yes |
| `ai.project.analyze` | yes | yes | yes | yes |
| `ai.document.analyze` | yes | yes | yes | yes |
| `ai.report.generate` | yes | yes | yes | yes |
| `ai.management.view` | yes | yes | yes | **no** |

Not granted to `employee`, `viewer`, or external roles.

**Fallback until migration 075 is applied:** `reports.management.read` ⇒ management/project/report AI; `project.manage_team` + `project.read` ⇒ project/document/report; existing `document.upload`/`document.update` ⇒ document analysis. Inactive membership is denied.

## Provider and env

Server-only (never `NEXT_PUBLIC_OPENAI_API_KEY`):

```
AI_ENABLED=false
AI_PROVIDER=none
OPENAI_API_KEY=
AI_MODEL=
AI_DOCUMENT_MODEL=
```

Legacy aliases still work: `MANAGEMENT_AI_PROVIDER`, `MANAGEMENT_AI_API_KEY`, `DOCUMENT_AI_*`.

Default model name is centralized in `AI_LIMITS.defaultModel` (`gpt-4o-mini`) and overridable via `AI_MODEL`. Do not scatter model strings in UI.

`AI_ENABLED=false` is the kill switch (including mock). Core product does not call the provider.

## Data flow

1. Resolve auth + active org membership (never trust browser `organization_id`).
2. Check AI capability + target access (`project.read` / `document.read` + org-scoped queries).
3. Build minimized context.
4. Structured JSON via Zod schemas in `src/modules/ai/schemas.ts`.
5. Optional persist to `ai_runs` / `ai_artifacts` (if 075 applied). In-memory cache always.

## Conversation persistence

**MVP decision: do not store chat history.** Each assistant turn sends at most 6 client-side turns plus a **fresh** project context. Prevents stale facts and sensitive prompt retention.

## Documents

Supported content analysis: PDF, DOCX, plain text (existing `extractDocumentText`). Size/text limits in `AI_LIMITS` / `DOCUMENT_AI_LIMITS`. Scanned PDFs with no text → `NO_EXTRACTABLE_TEXT`. Google Drive: **metadata only** — no OAuth scope expansion. Prompt-injection: document text wrapped as untrusted data.

Business-case structured analysis is a separate `analysisType`. Existing `document_intelligence` verification RPC is unchanged.

## Cost / rate limits

In-process per-user limits (not shared across serverless isolates): assistant 12 / 5 min; analysis 8 / 10 min; report 6 / 10 min. One retry on 429/5xx. Timeouts 45s (60s documents). Inflight de-dupe per user+target. No background OpenAI on workflow events.

## Audit

Actions: `ai.project.analyzed`, `ai.document.analyzed`, `ai.report.generated`, `ai.assistant.queried`. Metadata only (type, status) — not full prompts or document bodies.

## Prompt versions

`ai-safety:v1`, `project-intelligence:v1`, `risk-explanation:v1`, `project-assistant:v1`, `document-analysis:v1`, `business-case:v1`, `executive-report:v1`, `management-insights:v1`.

## Migration 075

File: `supabase/migrations/075_ai_intelligence_platform.sql`

Adds `ai.*` permissions, role grants, `ai_runs`, `ai_artifacts`, RLS deny-by-default (select/insert for org members with AI capability + project access). **Do not apply to Production until reviewed.** App works without the tables (persist is best-effort).

## RLS / service role

New tables use authenticated RLS. Application uses the user session client. Service role is **not** used for AI context load.

## Integrations (unchanged)

- Google Drive: closed connected mode; content analysis unavailable.
- Resend: no AI emails.
- WhatsApp: untouched / paused.

## Testing

`src/modules/ai/ai-platform.test.ts` — permissions, tenants, health/risk, mock provider, invalid JSON, injection, documents, rate limit, kill switch. Tests never call OpenAI.

## Deployment / rollback

1. Review this document and migration 075.
2. Apply 075 to a non-prod project first.
3. Set `AI_ENABLED=false` in Production until ready.
4. Configure `AI_PROVIDER=openai`, `OPENAI_API_KEY`, `AI_MODEL` in the **server** environment only.
5. Set `AI_ENABLED=true`.
6. Rollback: set `AI_ENABLED=false`. No database rollback required to disable AI.

## Health endpoints

Main app health must not fail because OpenAI is down. AI is optional.
