-- Master Touch OS — 075
-- AI Intelligence Platform: permissions + optional run/artifact cache.
-- Safe for existing Production data. Do not apply in the AI-1 implementation run.

insert into public.permissions (key, resource, action, description_ar, description_en) values
  ('ai.use', 'ai', 'use', 'استخدام الذكاء الاصطناعي', 'Use AI intelligence'),
  ('ai.project.analyze', 'ai', 'project.analyze', 'تحليل المشروع بالذكاء الاصطناعي', 'Analyze project with AI'),
  ('ai.document.analyze', 'ai', 'document.analyze', 'تحليل المستندات بالذكاء الاصطناعي', 'Analyze documents with AI'),
  ('ai.report.generate', 'ai', 'report.generate', 'إنشاء تقرير ذكي', 'Generate AI executive report'),
  ('ai.management.view', 'ai', 'management.view', 'عرض رؤى الإدارة الذكية', 'View management AI insights')
on conflict (key) do nothing;

-- Super Admin / General Manager: all AI keys
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.code in ('super_admin', 'general_manager')
  and p.key in ('ai.use', 'ai.project.analyze', 'ai.document.analyze', 'ai.report.generate', 'ai.management.view')
on conflict do nothing;

-- Operations manager: org-wide management AI
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.code = 'operations_manager'
  and p.key in ('ai.use', 'ai.project.analyze', 'ai.document.analyze', 'ai.report.generate', 'ai.management.view')
on conflict do nothing;

-- Project manager: project/document/report — not org-wide management.view
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.code = 'project_manager'
  and p.key in ('ai.use', 'ai.project.analyze', 'ai.document.analyze', 'ai.report.generate')
on conflict do nothing;

create table if not exists public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_user_id uuid not null references public.profiles (id),
  project_id uuid references public.projects (id) on delete set null,
  document_id uuid,
  analysis_type text not null,
  provider text not null,
  model text,
  prompt_version text not null,
  status text not null check (status in ('succeeded', 'failed')),
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  latency_ms integer,
  input_chars_estimate integer,
  output_chars_estimate integer,
  prompt_tokens integer,
  completion_tokens integer,
  error_category text,
  input_hash text,
  constraint ai_runs_analysis_type_chk check (char_length(analysis_type) between 1 and 64),
  constraint ai_runs_no_raw_prompt check (true)
);

create index if not exists ai_runs_org_created_idx
  on public.ai_runs (organization_id, created_at desc);

create table if not exists public.ai_artifacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null,
  project_id uuid references public.projects (id) on delete cascade,
  document_id uuid,
  prompt_version text not null,
  model text,
  input_hash text,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  constraint ai_artifacts_kind_chk check (
    kind in (
      'project_intelligence',
      'executive_report',
      'document_analysis',
      'business_case',
      'management_insights'
    )
  ),
  constraint ai_artifacts_payload_object_chk check (jsonb_typeof(payload) = 'object')
);

create index if not exists ai_artifacts_org_kind_idx
  on public.ai_artifacts (organization_id, kind, created_at desc);

alter table public.ai_runs enable row level security;
alter table public.ai_artifacts enable row level security;

create or replace function public.can_use_ai(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_organization_member(p_organization_id)
    and (
      public.has_permission('ai.use', p_organization_id, 'organization', null)
      or public.has_permission('reports.management.read', p_organization_id, 'organization', null)
      or public.has_permission('project.manage_team', p_organization_id, 'organization', null)
    );
$$;

create policy ai_runs_select on public.ai_runs
  for select to authenticated
  using (
    public.can_use_ai(organization_id)
    and (project_id is null or public.can_access_project(project_id))
  );

create policy ai_runs_insert on public.ai_runs
  for insert to authenticated
  with check (
    actor_user_id = auth.uid()
    and public.can_use_ai(organization_id)
    and (project_id is null or public.can_access_project(project_id))
  );

create policy ai_artifacts_select on public.ai_artifacts
  for select to authenticated
  using (
    public.can_use_ai(organization_id)
    and (project_id is null or public.can_access_project(project_id))
  );

create policy ai_artifacts_insert on public.ai_artifacts
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.can_use_ai(organization_id)
    and (project_id is null or public.can_access_project(project_id))
  );

-- No UPDATE/DELETE policies: authenticated users cannot mutate/delete AI history.

grant execute on function public.can_use_ai(uuid) to authenticated;

comment on table public.ai_runs is
  'AI-1 operational metadata. Never store API keys, JWTs, cookies, or raw prompts.';
comment on table public.ai_artifacts is
  'Cached structured AI outputs (org-scoped). Invalidated by input_hash / document version in application code.';
