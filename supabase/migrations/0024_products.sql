-- ============================================================================
-- Produtos e edições: dentro de uma empresa há várias frentes de produto ou
-- serviço (ex.: Entre Donos, Imersão, Mentoria, Club — caso real da MDD), e
-- frentes recorrentes como Entre Donos e Imersão rodam várias edições/turmas
-- por ano. Dois níveis:
--   product          — a frente em si, permanente (ex. "Entre Donos")
--   product_edition  — uma rodada dela, com data (ex. "Turma 12")
-- Produto sem edição cadastrada funciona normal — Mentoria e Club, que rodam
-- contínuo, não precisam de corte por turma.
--
-- KPI, tarefa e orçamento continuam existindo no nível da empresa por padrão
-- — o vínculo com produto/edição é uma coluna nova e opcional (nullable),
-- então nada que já existe muda de comportamento.
-- ============================================================================

create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  name          text not null,
  description   text,
  color         text,
  display_order integer not null default 0,
  is_active     boolean not null default true,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, name)
);
create index if not exists products_company_idx on public.products (company_id) where is_active;

drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products
  for each row execute function app.touch_updated_at();

create table if not exists public.product_editions (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  name       text not null,
  start_date date,
  end_date   date,
  status     text not null default 'planejamento'
               check (status in ('planejamento', 'em_andamento', 'encerrado')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, name)
);
create index if not exists product_editions_product_idx
  on public.product_editions (product_id, start_date desc);

drop trigger if exists product_editions_touch on public.product_editions;
create trigger product_editions_touch before update on public.product_editions
  for each row execute function app.touch_updated_at();

-- Impede edição apontando pra produto de outra empresa (mesma ideia de
-- app.assert_kpi_company(), já usada em kpi_values e kpi_checkpoints).
create or replace function app.assert_product_company()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (
    select 1 from public.products p
     where p.id = new.product_id and p.company_id = new.company_id
  ) then
    raise exception 'Produto % não pertence à empresa %', new.product_id, new.company_id;
  end if;
  return new;
end $$;

drop trigger if exists product_editions_company_guard on public.product_editions;
create trigger product_editions_company_guard before insert or update on public.product_editions
  for each row execute function app.assert_product_company();

-- ------------------------------------------------- vínculo opcional: KPI, tarefa, orçamento
alter table public.kpis
  add column if not exists product_id uuid references public.products (id) on delete set null,
  add column if not exists product_edition_id uuid references public.product_editions (id) on delete set null;
create index if not exists kpis_product_idx on public.kpis (product_id) where product_id is not null;

alter table public.tasks
  add column if not exists product_id uuid references public.products (id) on delete set null;
create index if not exists tasks_product_idx on public.tasks (product_id) where product_id is not null;

alter table public.budgets
  add column if not exists product_id uuid references public.products (id) on delete set null,
  add column if not exists product_edition_id uuid references public.product_editions (id) on delete set null;
create index if not exists budgets_product_idx on public.budgets (product_id) where product_id is not null;

-- Confere, na gravação do KPI, que o produto é da mesma empresa e que a
-- edição (se houver) é desse mesmo produto — evita ligar um KPI à edição
-- errada por engano.
create or replace function app.assert_kpi_product()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.product_id is not null and not exists (
    select 1 from public.products p
     where p.id = new.product_id and p.company_id = new.company_id
  ) then
    raise exception 'Produto % não pertence à empresa do KPI', new.product_id;
  end if;
  if new.product_edition_id is not null and not exists (
    select 1 from public.product_editions e
     where e.id = new.product_edition_id and e.product_id = new.product_id
  ) then
    raise exception 'Edição % não pertence ao produto do KPI', new.product_edition_id;
  end if;
  return new;
end $$;

drop trigger if exists kpis_product_guard on public.kpis;
create trigger kpis_product_guard before insert or update on public.kpis
  for each row execute function app.assert_kpi_product();

-- Mesma guarda pro orçamento.
create or replace function app.assert_budget_product()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.product_id is not null and not exists (
    select 1 from public.products p
     where p.id = new.product_id and p.company_id = new.company_id
  ) then
    raise exception 'Produto % não pertence à empresa do orçamento', new.product_id;
  end if;
  if new.product_edition_id is not null and not exists (
    select 1 from public.product_editions e
     where e.id = new.product_edition_id and e.product_id = new.product_id
  ) then
    raise exception 'Edição % não pertence ao produto do orçamento', new.product_edition_id;
  end if;
  return new;
end $$;

drop trigger if exists budgets_product_guard on public.budgets;
create trigger budgets_product_guard before insert or update on public.budgets
  for each row execute function app.assert_budget_product();

-- ---------------------------------------------------------------- RLS
-- Mesmo padrão de todo módulo por empresa: quem é membro vê, quem tem
-- permissão de escrita mexe.
alter table public.products         enable row level security;
alter table public.product_editions enable row level security;

drop policy if exists products_select on public.products;
create policy products_select on public.products for select to authenticated
  using (app.is_member(company_id));
drop policy if exists products_write on public.products;
create policy products_write on public.products for all to authenticated
  using (app.can_write(company_id)) with check (app.can_write(company_id));

drop policy if exists product_editions_select on public.product_editions;
create policy product_editions_select on public.product_editions for select to authenticated
  using (app.is_member(company_id));
drop policy if exists product_editions_write on public.product_editions;
create policy product_editions_write on public.product_editions for all to authenticated
  using (app.can_write(company_id)) with check (app.can_write(company_id));

-- ------------------------------------------------- company_snapshots(): + produtos ativos
-- Pro painel da holding saber, sem consulta extra, quantas frentes de
-- produto cada empresa está controlando — mesma função de sempre, só
-- acrescenta a contagem. Muda o conjunto de colunas de saída, então o
-- Postgres exige recriar (create or replace não basta pra isso).
drop function if exists public.company_snapshots();
create function public.company_snapshots()
returns table (
  company_id      uuid,
  company_name    text,
  company_color   text,
  company_slug    text,
  is_holding      boolean,
  kpis_total      bigint,
  kpis_on_target  bigint,
  kpis_off_target bigint,
  goals_active    bigint,
  goals_at_risk   bigint,
  goals_achieved  bigint,
  tasks_open      bigint,
  tasks_overdue   bigint,
  tasks_done_30d  bigint,
  members_total   bigint,
  products_active bigint,
  last_activity   timestamptz
)
language sql stable set search_path = public, pg_temp as $$
  select
    c.id,
    c.name,
    c.color,
    c.slug,
    c.is_holding,
    coalesce(k.total, 0),
    coalesce(k.on_target, 0),
    coalesce(k.off_target, 0),
    coalesce(g.active, 0),
    coalesce(g.at_risk, 0),
    coalesce(g.achieved, 0),
    coalesce(t.open, 0),
    coalesce(t.overdue, 0),
    coalesce(t.done_30d, 0),
    coalesce(m.total, 0),
    coalesce(pr.total, 0),
    greatest(c.updated_at, coalesce(t.last_touch, c.updated_at))
  from public.companies c
  left join lateral (
    select count(*) as total
      from public.kpis kk
     where kk.company_id = c.id and kk.is_active
  ) k0 on true
  left join lateral (
    select k0.total,
           count(*) filter (
             where l.target_value is not null
               and ((l.direction = 'up' and l.value >= l.target_value)
                 or (l.direction = 'down' and l.value <= l.target_value))
           ) as on_target,
           count(*) filter (
             where l.target_value is not null
               and ((l.direction = 'up' and l.value < l.target_value)
                 or (l.direction = 'down' and l.value > l.target_value))
           ) as off_target
      from public.kpi_latest_values l
     where l.company_id = c.id
  ) k on true
  left join lateral (
    select count(*) filter (where kg.status in ('active', 'planned')) as active,
           count(*) filter (where kg.status = 'at_risk') as at_risk,
           count(*) filter (where kg.status = 'achieved') as achieved
      from public.kpis kg
     where kg.company_id = c.id and kg.is_active and kg.due_date is not null
  ) g on true
  left join lateral (
    select count(*) filter (where tt.status in ('todo', 'doing', 'blocked')) as open,
           count(*) filter (
             where tt.status in ('todo', 'doing', 'blocked')
               and tt.due_date is not null
               and tt.due_date < current_date
           ) as overdue,
           count(*) filter (
             where tt.status = 'done' and tt.completed_at > now() - interval '30 days'
           ) as done_30d,
           max(tt.updated_at) as last_touch
      from public.tasks tt
     where tt.company_id = c.id
  ) t on true
  left join lateral (
    select count(*) as total from public.company_members mm where mm.company_id = c.id
  ) m on true
  left join lateral (
    select count(*) as total from public.products pp
     where pp.company_id = c.id and pp.is_active
  ) pr on true
  where c.is_active
  order by c.is_holding desc, c.display_order, c.name;
$$;

grant execute on function public.company_snapshots() to authenticated;

-- kpi_latest_values ganha as duas colunas novas, pro painel poder mostrar
-- de qual produto/edição é cada indicador sem outra consulta.
drop view if exists public.kpi_latest_values;
create view public.kpi_latest_values
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
       k.due_date,
       k.owner_id,
       k.status,
       k.product_id,
       k.product_edition_id
  from public.kpi_values v
  join public.kpis k on k.id = v.kpi_id
 where k.is_active
 order by v.kpi_id, v.period_start desc;
