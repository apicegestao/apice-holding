-- ============================================================================
-- Ápice Holding — núcleo: empresas, perfis, vínculos, auditoria e notificações
-- Isolamento: TODA tabela de módulo carrega company_id e é filtrada por RLS.
-- ============================================================================

create extension if not exists pgcrypto;

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------- enums
do $$ begin
  create type app_role as enum ('admin', 'collaborator', 'viewer');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- utilidades
create or replace function app.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------- empresas
create table if not exists public.companies (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  legal_name    text,
  tax_id        text,
  sector        text,
  description   text,
  color         text not null default '#0EA5E9',
  logo_url      text,
  is_holding    boolean not null default false,
  parent_id     uuid references public.companies (id) on delete set null,
  display_order integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists companies_parent_idx on public.companies (parent_id);
create unique index if not exists companies_single_holding_idx
  on public.companies ((true)) where is_holding;

drop trigger if exists companies_touch on public.companies;
create trigger companies_touch before update on public.companies
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------- perfis
create table if not exists public.profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  email                 text not null unique,
  full_name             text not null default '',
  phone                 text,
  job_title             text,
  avatar_url            text,
  is_super_admin        boolean not null default false,
  must_change_password  boolean not null default true,
  is_active             boolean not null default true,
  last_login_at         timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------- vínculos
create table if not exists public.company_members (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       app_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index if not exists company_members_user_idx on public.company_members (user_id);

drop trigger if exists company_members_touch on public.company_members;
create trigger company_members_touch before update on public.company_members
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------- permissões
-- SECURITY DEFINER para evitar recursão de RLS ao consultar vínculos.
create or replace function app.is_super_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select p.is_super_admin and p.is_active
                   from public.profiles p where p.id = auth.uid()), false);
$$;

create or replace function app.company_role(p_company uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when app.is_super_admin() then 'admin'
    else (select m.role::text
            from public.company_members m
            join public.profiles p on p.id = m.user_id
           where m.company_id = p_company and m.user_id = auth.uid() and p.is_active)
  end;
$$;

create or replace function app.is_member(p_company uuid)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select app.company_role(p_company) is not null;
$$;

create or replace function app.is_company_admin(p_company uuid)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select app.company_role(p_company) = 'admin';
$$;

-- Colaborador e admin escrevem; "usuário" (viewer) apenas lê.
create or replace function app.can_write(p_company uuid)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select app.company_role(p_company) in ('admin', 'collaborator');
$$;

create or replace function app.shares_company(p_user uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
      from public.company_members mine
      join public.company_members theirs on theirs.company_id = mine.company_id
     where mine.user_id = auth.uid() and theirs.user_id = p_user
  );
$$;

revoke all on function app.is_super_admin(), app.company_role(uuid), app.is_member(uuid),
                       app.is_company_admin(uuid), app.can_write(uuid), app.shares_company(uuid)
  from public;
grant execute on function app.is_super_admin(), app.company_role(uuid), app.is_member(uuid),
                          app.is_company_admin(uuid), app.can_write(uuid), app.shares_company(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------- auditoria
create table if not exists public.audit_logs (
  id         bigint generated always as identity primary key,
  company_id uuid references public.companies (id) on delete set null,
  actor_id   uuid references public.profiles (id) on delete set null,
  action     text not null,
  entity     text not null,
  entity_id  text,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_company_idx on public.audit_logs (company_id, created_at desc);

-- ---------------------------------------------------------------- notificações
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  kind       text not null default 'info',
  title      text not null,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------- novo usuário
create or replace function app.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, email, full_name, must_change_password)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data ->> 'must_change_password')::boolean, true)
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.companies       enable row level security;
alter table public.profiles        enable row level security;
alter table public.company_members enable row level security;
alter table public.audit_logs      enable row level security;
alter table public.notifications   enable row level security;

-- empresas ------------------------------------------------------------------
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select to authenticated
  using (app.is_member(id));

drop policy if exists companies_insert on public.companies;
create policy companies_insert on public.companies for insert to authenticated
  with check (app.is_super_admin());

drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies for update to authenticated
  using (app.is_company_admin(id)) with check (app.is_company_admin(id));

drop policy if exists companies_delete on public.companies;
create policy companies_delete on public.companies for delete to authenticated
  using (app.is_super_admin());

-- perfis --------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or app.is_super_admin() or app.shares_company(id));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Elevação de privilégio e exclusão de conta só via Edge Function (service_role).

-- vínculos ------------------------------------------------------------------
drop policy if exists company_members_select on public.company_members;
create policy company_members_select on public.company_members for select to authenticated
  using (app.is_member(company_id));

drop policy if exists company_members_write on public.company_members;
create policy company_members_write on public.company_members for all to authenticated
  using (app.is_company_admin(company_id)) with check (app.is_company_admin(company_id));

-- auditoria -----------------------------------------------------------------
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using ((company_id is null and app.is_super_admin()) or app.is_company_admin(company_id));

drop policy if exists audit_logs_insert on public.audit_logs;
create policy audit_logs_insert on public.audit_logs for insert to authenticated
  with check (actor_id = auth.uid() and (company_id is null or app.is_member(company_id)));

-- notificações --------------------------------------------------------------
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
