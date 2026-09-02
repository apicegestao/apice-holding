-- ============================================================================
-- Une KPIs e Metas numa estrutura só. Hoje cadastrar um objetivo exigia dois
-- passos (criar o KPI, depois criar a meta e ligar manualmente ao KPI), com
-- dois lugares de navegação e duas telas de formulário quase iguais.
--
-- Um KPI passa a carregar, ele mesmo, prazo, responsável e andamento — os
-- três dados que faltavam para ele ser também a meta. O "valor atual" da
-- meta antiga (digitado à mão e sempre defasado) sai de cena: o andamento
-- agora vem sempre do último lançamento em kpi_values, que já existia.
--
-- A tabela public.goals tinha 0 linhas em produção neste momento (conferido
-- antes de escrever esta migração) — não há dado para migrar.
-- ============================================================================

alter table public.kpis
  add column if not exists due_date date,
  add column if not exists owner_id uuid references public.profiles (id) on delete set null,
  add column if not exists status   goal_status not null default 'active';

create index if not exists kpis_due_date_idx on public.kpis (company_id, due_date) where due_date is not null;
create index if not exists kpis_owner_idx on public.kpis (owner_id);

-- --------------------------------------------------- repartição por semana
-- Divide o alvo de um KPI com prazo em parcelas semanais — pra quem prefere
-- acompanhar um ritmo ("essa semana precisa de X") em vez de só o número
-- final. Gerado e editado pela tela de KPIs; nunca pelo banco sozinho.
create table if not exists public.kpi_checkpoints (
  id           uuid primary key default gen_random_uuid(),
  kpi_id       uuid not null references public.kpis (id) on delete cascade,
  company_id   uuid not null references public.companies (id) on delete cascade,
  seq          integer not null,
  period_start date not null,
  period_end   date not null,
  target_value numeric(18, 4) not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (kpi_id, seq)
);
create index if not exists kpi_checkpoints_kpi_idx on public.kpi_checkpoints (kpi_id, period_start);

drop trigger if exists kpi_checkpoints_touch on public.kpi_checkpoints;
create trigger kpi_checkpoints_touch before update on public.kpi_checkpoints
  for each row execute function app.touch_updated_at();

drop trigger if exists kpi_checkpoints_company_guard on public.kpi_checkpoints;
create trigger kpi_checkpoints_company_guard before insert or update on public.kpi_checkpoints
  for each row execute function app.assert_kpi_company();

alter table public.kpi_checkpoints enable row level security;

drop policy if exists kpi_checkpoints_select on public.kpi_checkpoints;
create policy kpi_checkpoints_select on public.kpi_checkpoints for select to authenticated
  using (app.is_member(company_id));
drop policy if exists kpi_checkpoints_write on public.kpi_checkpoints;
create policy kpi_checkpoints_write on public.kpi_checkpoints for all to authenticated
  using (app.can_write(company_id)) with check (app.can_write(company_id));

-- ---------------------------------------------- notifica o responsável
create or replace function app.notify_kpi_ownership()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  previous_owner uuid := case when tg_op = 'UPDATE' then old.owner_id else null end;
begin
  if new.owner_id is not null
     and new.owner_id is distinct from previous_owner
     and new.owner_id is distinct from auth.uid() then
    insert into public.notifications (user_id, company_id, kind, title, body, link)
    values (new.owner_id, new.company_id, 'kpi',
            'Você é o responsável por um indicador', new.name,
            '/empresa/' || new.company_id || '/kpis');
  end if;
  return new;
end $$;

drop trigger if exists kpis_notify_ownership on public.kpis;
create trigger kpis_notify_ownership after insert or update of owner_id on public.kpis
  for each row execute function app.notify_kpi_ownership();

-- ----------------------------------------------------- tarefas ligadas a KPI
-- tasks.goal_id apontava pra uma tabela que deixa de existir. Nenhuma tela
-- gravava nele (a ligação tarefa↔objetivo nunca saiu do papel), então troca
-- direto pela referência que faz sentido agora: o próprio KPI.
alter table public.tasks drop column if exists goal_id;
alter table public.tasks add column if not exists kpi_id uuid references public.kpis (id) on delete set null;
create index if not exists tasks_kpi_idx on public.tasks (kpi_id) where kpi_id is not null;

drop table if exists public.goals;

-- ------------------------------------------- company_snapshots() atualizada
-- goals_active/at_risk/achieved passam a contar KPIs com prazo (due_date),
-- que é o que hoje faz um KPI também ser uma meta. Nomes de coluna mantidos
-- de propósito — o painel da holding já lê por esses nomes.
create or replace function public.company_snapshots()
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
  where c.is_active
  order by c.is_holding desc, c.display_order, c.name;
$$;

grant execute on function public.company_snapshots() to authenticated;

-- kpi_latest_values também ganha os campos novos, pra quem já lê essa view
-- não precisar fazer um segundo round-trip só pra saber prazo/responsável.
-- A forma da view não muda (continua só KPI com pelo menos um lançamento —
-- é assim que outras telas já esperam consumir); só entram três colunas.
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
       k.status
  from public.kpi_values v
  join public.kpis k on k.id = v.kpi_id
 where k.is_active
 order by v.kpi_id, v.period_start desc;
