-- ============================================================================
-- Módulo Integrações (puxar dados de outros sistemas via API) e Insights de IA
-- ============================================================================

do $$ begin
  create type integration_status as enum ('idle', 'running', 'success', 'error');
exception when duplicate_object then null; end $$;

do $$ begin
  create type insight_severity as enum ('info', 'opportunity', 'warning', 'critical');
exception when duplicate_object then null; end $$;

create table if not exists public.integrations (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  name          text not null,
  provider      text not null default 'rest',
  base_url      text not null,
  http_method   text not null default 'GET' check (http_method in ('GET', 'POST')),
  request_body  jsonb,
  headers       jsonb not null default '{}'::jsonb,
  auth_type     text not null default 'none'
                check (auth_type in ('none', 'bearer', 'api_key', 'basic')),
  auth_header   text not null default 'Authorization',
  -- de quantos em quantos minutos sincronizar (0 = só manual)
  sync_interval_minutes integer not null default 0,
  is_active     boolean not null default true,
  last_run_at   timestamptz,
  last_status   integration_status not null default 'idle',
  last_error    text,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, name)
);
create index if not exists integrations_company_idx on public.integrations (company_id);

drop trigger if exists integrations_touch on public.integrations;
create trigger integrations_touch before update on public.integrations
  for each row execute function app.touch_updated_at();

alter table public.kpis drop constraint if exists kpis_integration_id_fkey;
alter table public.kpis
  add constraint kpis_integration_id_fkey
  foreign key (integration_id) references public.integrations (id) on delete set null;

-- Credenciais ficam separadas: nenhuma policy de SELECT é criada, portanto
-- nem admin lê de volta pelo cliente. Só o service_role (Edge Function) acessa.
create table if not exists public.integration_secrets (
  integration_id uuid primary key references public.integrations (id) on delete cascade,
  company_id     uuid not null references public.companies (id) on delete cascade,
  auth_value     text not null,
  updated_at     timestamptz not null default now()
);

-- Mapeia um caminho do JSON da resposta para um KPI.
create table if not exists public.integration_mappings (
  id             uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.integrations (id) on delete cascade,
  company_id     uuid not null references public.companies (id) on delete cascade,
  kpi_id         uuid not null references public.kpis (id) on delete cascade,
  json_path      text not null,
  multiplier     numeric(18, 6) not null default 1,
  period_mode    text not null default 'current_month'
                 check (period_mode in ('current_day', 'current_week', 'current_month',
                                        'current_quarter', 'current_year')),
  created_at     timestamptz not null default now(),
  unique (integration_id, kpi_id, json_path)
);

create table if not exists public.integration_runs (
  id             uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.integrations (id) on delete cascade,
  company_id     uuid not null references public.companies (id) on delete cascade,
  status         integration_status not null default 'running',
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  records        integer not null default 0,
  error          text,
  trigger_source text not null default 'manual'
);
create index if not exists integration_runs_idx
  on public.integration_runs (integration_id, started_at desc);

create table if not exists public.insights (
  id           uuid primary key default gen_random_uuid(),
  -- company_id nulo = insight consolidado da holding
  company_id   uuid references public.companies (id) on delete cascade,
  scope        text not null default 'company' check (scope in ('company', 'holding')),
  title        text not null,
  body         text not null,
  severity     insight_severity not null default 'info',
  recommendation text,
  payload      jsonb not null default '{}'::jsonb,
  model        text,
  generated_at timestamptz not null default now(),
  generated_by uuid references public.profiles (id) on delete set null,
  is_archived  boolean not null default false
);
create index if not exists insights_company_idx on public.insights (company_id, generated_at desc);

-- ---------------------------------------------------------------- consolidado
-- security_invoker: a view respeita a RLS de quem consulta, então continua
-- impossível ver KPI de empresa da qual o usuário não é membro.
create or replace view public.kpi_latest_values
with (security_invoker = true) as
select distinct on (v.kpi_id)
       v.kpi_id,
       v.company_id,
       v.period_start,
       v.period_end,
       v.value,
       coalesce(v.target_value, k.target_value) as target_value,
       k.name,
       k.unit,
       k.direction,
       k.frequency,
       k.category,
       k.roll_up
  from public.kpi_values v
  join public.kpis k on k.id = v.kpi_id
 where k.is_active
 order by v.kpi_id, v.period_start desc;

-- ---------------------------------------------------------------- RLS
alter table public.integrations         enable row level security;
alter table public.integration_secrets  enable row level security;
alter table public.integration_mappings enable row level security;
alter table public.integration_runs     enable row level security;
alter table public.insights             enable row level security;

drop policy if exists integrations_select on public.integrations;
create policy integrations_select on public.integrations for select to authenticated
  using (app.is_member(company_id));
drop policy if exists integrations_write on public.integrations;
create policy integrations_write on public.integrations for all to authenticated
  using (app.is_company_admin(company_id)) with check (app.is_company_admin(company_id));

-- sem policy de select: credencial é write-only pelo cliente
drop policy if exists integration_secrets_insert on public.integration_secrets;
create policy integration_secrets_insert on public.integration_secrets for insert to authenticated
  with check (app.is_company_admin(company_id));
drop policy if exists integration_secrets_update on public.integration_secrets;
create policy integration_secrets_update on public.integration_secrets for update to authenticated
  using (app.is_company_admin(company_id)) with check (app.is_company_admin(company_id));
drop policy if exists integration_secrets_delete on public.integration_secrets;
create policy integration_secrets_delete on public.integration_secrets for delete to authenticated
  using (app.is_company_admin(company_id));

drop policy if exists integration_mappings_select on public.integration_mappings;
create policy integration_mappings_select on public.integration_mappings for select to authenticated
  using (app.is_member(company_id));
drop policy if exists integration_mappings_write on public.integration_mappings;
create policy integration_mappings_write on public.integration_mappings for all to authenticated
  using (app.is_company_admin(company_id)) with check (app.is_company_admin(company_id));

drop policy if exists integration_runs_select on public.integration_runs;
create policy integration_runs_select on public.integration_runs for select to authenticated
  using (app.is_member(company_id));

drop policy if exists insights_select on public.insights;
create policy insights_select on public.insights for select to authenticated
  using (
    (scope = 'holding' and app.is_super_admin())
    or (company_id is not null and app.is_company_admin(company_id))
  );
drop policy if exists insights_update on public.insights;
create policy insights_update on public.insights for update to authenticated
  using (
    (scope = 'holding' and app.is_super_admin())
    or (company_id is not null and app.is_company_admin(company_id))
  )
  with check (
    (scope = 'holding' and app.is_super_admin())
    or (company_id is not null and app.is_company_admin(company_id))
  );
