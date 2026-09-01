-- ============================================================================
-- Módulo KPIs e Metas
-- ============================================================================

do $$ begin
  create type kpi_unit as enum ('currency', 'percent', 'number', 'days', 'ratio');
exception when duplicate_object then null; end $$;

do $$ begin
  create type kpi_direction as enum ('up', 'down');
exception when duplicate_object then null; end $$;

do $$ begin
  create type kpi_frequency as enum ('daily', 'weekly', 'monthly', 'quarterly', 'yearly');
exception when duplicate_object then null; end $$;

do $$ begin
  create type goal_status as enum ('planned', 'active', 'at_risk', 'achieved', 'missed');
exception when duplicate_object then null; end $$;

create table if not exists public.kpis (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  name          text not null,
  description   text,
  category      text,
  unit          kpi_unit not null default 'number',
  direction     kpi_direction not null default 'up',
  frequency     kpi_frequency not null default 'monthly',
  target_value  numeric(18, 4),
  -- Aparece no painel consolidado da holding
  roll_up       boolean not null default true,
  source        text not null default 'manual' check (source in ('manual', 'integration')),
  integration_id uuid,
  display_order integer not null default 0,
  is_active     boolean not null default true,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, name)
);
create index if not exists kpis_company_idx on public.kpis (company_id) where is_active;

drop trigger if exists kpis_touch on public.kpis;
create trigger kpis_touch before update on public.kpis
  for each row execute function app.touch_updated_at();

create table if not exists public.kpi_values (
  id           uuid primary key default gen_random_uuid(),
  kpi_id       uuid not null references public.kpis (id) on delete cascade,
  company_id   uuid not null references public.companies (id) on delete cascade,
  period_start date not null,
  period_end   date not null,
  value        numeric(18, 4) not null,
  target_value numeric(18, 4),
  note         text,
  source       text not null default 'manual',
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (kpi_id, period_start)
);
create index if not exists kpi_values_lookup_idx
  on public.kpi_values (company_id, kpi_id, period_start desc);

drop trigger if exists kpi_values_touch on public.kpi_values;
create trigger kpi_values_touch before update on public.kpi_values
  for each row execute function app.touch_updated_at();

-- Impede que um valor seja gravado apontando para KPI de outra empresa.
create or replace function app.assert_kpi_company()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.kpis k
                  where k.id = new.kpi_id and k.company_id = new.company_id) then
    raise exception 'KPI % não pertence à empresa %', new.kpi_id, new.company_id;
  end if;
  return new;
end $$;

drop trigger if exists kpi_values_company_guard on public.kpi_values;
create trigger kpi_values_company_guard before insert or update on public.kpi_values
  for each row execute function app.assert_kpi_company();

create table if not exists public.goals (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  kpi_id        uuid references public.kpis (id) on delete set null,
  title         text not null,
  description   text,
  target_value  numeric(18, 4),
  current_value numeric(18, 4) not null default 0,
  unit          kpi_unit not null default 'number',
  start_date    date not null default current_date,
  due_date      date,
  status        goal_status not null default 'active',
  owner_id      uuid references public.profiles (id) on delete set null,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists goals_company_idx on public.goals (company_id, status);

drop trigger if exists goals_touch on public.goals;
create trigger goals_touch before update on public.goals
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------- RLS
alter table public.kpis       enable row level security;
alter table public.kpi_values enable row level security;
alter table public.goals      enable row level security;

drop policy if exists kpis_select on public.kpis;
create policy kpis_select on public.kpis for select to authenticated
  using (app.is_member(company_id));
drop policy if exists kpis_write on public.kpis;
create policy kpis_write on public.kpis for all to authenticated
  using (app.can_write(company_id)) with check (app.can_write(company_id));

drop policy if exists kpi_values_select on public.kpi_values;
create policy kpi_values_select on public.kpi_values for select to authenticated
  using (app.is_member(company_id));
drop policy if exists kpi_values_write on public.kpi_values;
create policy kpi_values_write on public.kpi_values for all to authenticated
  using (app.can_write(company_id)) with check (app.can_write(company_id));

drop policy if exists goals_select on public.goals;
create policy goals_select on public.goals for select to authenticated
  using (app.is_member(company_id));
drop policy if exists goals_write on public.goals;
create policy goals_write on public.goals for all to authenticated
  using (app.can_write(company_id)) with check (app.can_write(company_id));
