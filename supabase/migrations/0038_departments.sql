-- ============================================================================
-- Área/Departamento: organiza indicador, tarefa e orçamento por frente
-- interna da empresa (Comercial, Financeiro, Administrativo...) — Fase 2 do
-- plano discutido com o usuário pra evoluir o sistema de "indicadores e
-- metas" pra uma gestão completa por empresa. Cada empresa define as
-- próprias áreas (não é uma lista fixa pro grupo inteiro) — mesmo padrão de
-- `products`, mas sem "turma" por baixo (área não tem subdivisão).
--
-- Vínculo com kpi/tarefa/orçamento é opcional (nullable) — nada que já
-- existe muda de comportamento. Coexiste com `kpis.category` (texto livre
-- já usado só pra agrupar a Visão Geral de Metas): não substitui, área é o
-- contêiner estruturado que também organiza tarefa e orçamento, algo que
-- category nunca alcançou.
-- ============================================================================

create table if not exists public.departments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  name          text not null,
  color         text,
  display_order integer not null default 0,
  is_active     boolean not null default true,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, name)
);
create index if not exists departments_company_idx on public.departments (company_id) where is_active;

drop trigger if exists departments_touch on public.departments;
create trigger departments_touch before update on public.departments
  for each row execute function app.touch_updated_at();

-- ------------------------------------------------- vínculo opcional: KPI, tarefa, orçamento
alter table public.kpis
  add column if not exists department_id uuid references public.departments (id) on delete set null;
create index if not exists kpis_department_idx on public.kpis (department_id) where department_id is not null;

alter table public.tasks
  add column if not exists department_id uuid references public.departments (id) on delete set null;
create index if not exists tasks_department_idx on public.tasks (department_id) where department_id is not null;

alter table public.budgets
  add column if not exists department_id uuid references public.departments (id) on delete set null;
create index if not exists budgets_department_idx on public.budgets (department_id) where department_id is not null;

-- Confere, na gravação, que a área é da mesma empresa do registro — mesmo
-- padrão de app.assert_kpi_product()/app.assert_budget_product()
-- (0024_products.sql). Uma função por tabela (não uma genérica) porque o
-- texto do erro precisa dizer de qual registro se trata.
create or replace function app.assert_kpi_department()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.department_id is not null and not exists (
    select 1 from public.departments d
     where d.id = new.department_id and d.company_id = new.company_id
  ) then
    raise exception 'Área % não pertence à empresa do indicador', new.department_id;
  end if;
  return new;
end $$;

drop trigger if exists kpis_department_guard on public.kpis;
create trigger kpis_department_guard before insert or update on public.kpis
  for each row execute function app.assert_kpi_department();

create or replace function app.assert_task_department()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.department_id is not null and not exists (
    select 1 from public.departments d
     where d.id = new.department_id and d.company_id = new.company_id
  ) then
    raise exception 'Área % não pertence à empresa da tarefa', new.department_id;
  end if;
  return new;
end $$;

drop trigger if exists tasks_department_guard on public.tasks;
create trigger tasks_department_guard before insert or update on public.tasks
  for each row execute function app.assert_task_department();

create or replace function app.assert_budget_department()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.department_id is not null and not exists (
    select 1 from public.departments d
     where d.id = new.department_id and d.company_id = new.company_id
  ) then
    raise exception 'Área % não pertence à empresa do orçamento', new.department_id;
  end if;
  return new;
end $$;

drop trigger if exists budgets_department_guard on public.budgets;
create trigger budgets_department_guard before insert or update on public.budgets
  for each row execute function app.assert_budget_department();

-- ---------------------------------------------------------------- RLS
-- Mesmo padrão de todo módulo por empresa: quem é membro vê, quem tem
-- permissão de escrita mexe.
alter table public.departments enable row level security;

drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments for select to authenticated
  using (app.is_member(company_id));
drop policy if exists departments_write on public.departments;
create policy departments_write on public.departments for all to authenticated
  using (app.can_write(company_id)) with check (app.can_write(company_id));

-- ------------------------------------------------- seed a partir do uso real
-- Toda empresa que já tem indicador com `category` preenchida ganha uma
-- área com esse nome — não é uma lista fixa inventada, é o que a empresa já
-- vinha usando informalmente. Indicador sem categoria continua sem área
-- (department_id null) — nada é obrigatório.
insert into public.departments (company_id, name, display_order)
select k.company_id, k.category,
       row_number() over (partition by k.company_id order by min(k.created_at)) - 1
  from public.kpis k
 where k.category is not null and trim(k.category) <> ''
 group by k.company_id, k.category
on conflict (company_id, name) do nothing;

update public.kpis k
   set department_id = d.id
  from public.departments d
 where d.company_id = k.company_id
   and d.name = k.category
   and k.department_id is null;
