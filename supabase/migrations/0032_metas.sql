-- ============================================================================
-- Meta vira o centro do sistema: separada de Indicador (kpis). Até aqui, um
-- KPI só podia ter uma meta por vez, porque a meta ERA o KPI (due_date +
-- target_value + owner_id + status na mesma linha, desde
-- 0016_merge_kpis_goals.sql — feito quando a tabela goals separada tinha 0
-- linhas e o fluxo de dois passos era só fricção). Isso trouxe dois
-- problemas reais: (1) um indicador com meta vencida era arquivado inteiro
-- — indicador e histórico junto — só porque a meta acabou (é a razão do
-- nome "Vendas - Entre Donos Set.26": um KPI novo a cada mês, porque o
-- anterior "sumia" com a meta); (2) não dava pra ter duas metas sobre o
-- mesmo indicador (ex. meta mensal e meta anual de "Faturamento") sem
-- duplicar o indicador inteiro e lançar o valor duas vezes.
--
-- Sai: kpis.target_value / due_date / owner_id / status.
-- Entra: metas (kpi_id, target_value, due_date, owner_id, status,
-- archived_at próprio) — um indicador passa a poder ter 0, N metas.
--
-- Nenhuma hierarquia nova: parent_kpi_id continua em kpis (é soma de VALOR
-- medido — turma soma em produto —, não meta; o teto de 2 níveis já tinha
-- sido removido em 0028_kpi_parent_chain.sql, é profundidade livre com
-- detecção de ciclo). "Meta de empresa/produto/turma" já existe via
-- kpis.product_id/product_edition_id — uma meta herda o nível do indicador
-- que ela referencia, sem campo novo.
--
-- kpis/kpi_values/kpi_checkpoints estavam vazias em produção no momento
-- desta migração (conferido antes de escrever) — sem dado real pra migrar,
-- mas os passos de cópia abaixo são escritos pra funcionar corretamente
-- mesmo se não estivessem.
-- ============================================================================

-- ------------------------------------------------------------------- metas
create table public.metas (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  kpi_id       uuid not null references public.kpis (id) on delete cascade,
  target_value numeric(18, 4),
  due_date     date,
  owner_id     uuid references public.profiles (id) on delete set null,
  status       goal_status not null default 'active',
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index metas_kpi_idx on public.metas (kpi_id);
create index metas_due_date_idx on public.metas (company_id, due_date) where due_date is not null;
create index metas_archived_idx on public.metas (company_id, archived_at);
create index metas_owner_idx on public.metas (owner_id);

drop trigger if exists metas_touch on public.metas;
create trigger metas_touch before update on public.metas
  for each row execute function app.touch_updated_at();

-- Reaproveita a mesma guarda que kpi_values/kpi_value_entries já usam —
-- ela confere kpi_id/company_id, formato idêntico ao de metas.
drop trigger if exists metas_company_guard on public.metas;
create trigger metas_company_guard before insert or update on public.metas
  for each row execute function app.assert_kpi_company();

alter table public.metas enable row level security;
drop policy if exists metas_select on public.metas;
create policy metas_select on public.metas for select to authenticated
  using (app.is_member(company_id));
drop policy if exists metas_write on public.metas;
create policy metas_write on public.metas for all to authenticated
  using (app.can_write(company_id)) with check (app.can_write(company_id));

-- Migra qualquer KPI com meta hoje (due_date not null) pra uma linha de
-- metas própria, preservando target_value/owner_id/status e, se o KPI já
-- estava arquivado por causa do prazo, o próprio archived_at.
insert into public.metas (company_id, kpi_id, target_value, due_date, owner_id, status, archived_at, created_at)
select company_id, id, target_value, due_date, owner_id, status, archived_at, created_at
  from public.kpis
 where due_date is not null;

-- --------------------------------------------------- kpi_checkpoints: kpi_id → meta_id
-- Repartição semanal é da META (um alvo por semana), não do indicador — um
-- indicador com duas metas teria duas repartições diferentes.
alter table public.kpi_checkpoints add column meta_id uuid references public.metas (id) on delete cascade;
update public.kpi_checkpoints c
   set meta_id = m.id
  from public.metas m
 where m.kpi_id = c.kpi_id;
alter table public.kpi_checkpoints alter column meta_id set not null;
alter table public.kpi_checkpoints drop constraint kpi_checkpoints_kpi_id_fkey;
alter table public.kpi_checkpoints drop constraint kpi_checkpoints_kpi_id_seq_key;
alter table public.kpi_checkpoints drop column kpi_id;
alter table public.kpi_checkpoints add constraint kpi_checkpoints_meta_id_seq_key unique (meta_id, seq);
create index kpi_checkpoints_meta_idx on public.kpi_checkpoints (meta_id, period_start);

-- Guarda de empresa de kpi_checkpoints também troca de alvo: confere
-- meta_id agora, não kpi_id.
create or replace function app.assert_meta_company()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.metas m
                  where m.id = new.meta_id and m.company_id = new.company_id) then
    raise exception 'Meta % não pertence à empresa %', new.meta_id, new.company_id;
  end if;
  return new;
end $$;

drop trigger if exists kpi_checkpoints_company_guard on public.kpi_checkpoints;
create trigger kpi_checkpoints_company_guard before insert or update on public.kpi_checkpoints
  for each row execute function app.assert_meta_company();

-- ------------------------------------------------------- kpis perde a meta
drop trigger if exists kpis_notify_ownership on public.kpis;

-- company_snapshots() (language sql) e a view antiga leem
-- target_value/due_date/owner_id/status direto de kpis — os dois precisam
-- sair ANTES do alter, senão o Postgres recusa dropar as colunas por causa
-- da dependência. Recriados mais abaixo, já apontando pro modelo novo.
drop function if exists public.company_snapshots();
drop view if exists public.kpi_latest_values;

alter table public.kpis
  drop column target_value,
  drop column due_date,
  drop column owner_id,
  drop column status;

-- --------------------------------------------- notificação de responsável
-- Mesmo gatilho de sempre, só que em metas agora — o nome do indicador
-- vem de um join, já que não mora mais na mesma linha.
create or replace function app.notify_meta_ownership()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  previous_owner uuid := case when tg_op = 'UPDATE' then old.owner_id else null end;
  kpi_name text;
begin
  if new.owner_id is not null
     and new.owner_id is distinct from previous_owner
     and new.owner_id is distinct from auth.uid() then
    select name into kpi_name from public.kpis where id = new.kpi_id;
    insert into public.notifications (user_id, company_id, kind, title, body, link)
    values (new.owner_id, new.company_id, 'kpi',
            'Você é o responsável por uma meta', coalesce(kpi_name, 'Meta'),
            '/empresa/' || new.company_id || '/kpis');
  end if;
  return new;
end $$;

drop trigger if exists metas_notify_ownership on public.metas;
create trigger metas_notify_ownership after insert or update of owner_id on public.metas
  for each row execute function app.notify_meta_ownership();

-- ------------------------------------------------- arquivamento por prazo
-- O indicador nunca mais é arquivado só porque uma meta venceu — só a meta
-- em si. kpis.archived_at continua existindo, só que agora só muda por ação
-- manual (arquivar/desarquivar indicador, já existente na tela de KPIs).
create or replace function app.archive_overdue_metas()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  affected integer;
begin
  with done as (
    update public.metas
       set archived_at = now()
     where due_date is not null
       and due_date < (now() at time zone 'America/Sao_Paulo')::date
       and archived_at is null
    returning 1
  )
  select count(*) into affected from done;
  return affected;
end $$;

revoke all on function app.archive_overdue_metas() from public;
grant execute on function app.archive_overdue_metas() to service_role;

drop function if exists app.archive_overdue_kpis();

select cron.unschedule('apice_archive_overdue_kpis')
 where exists (select 1 from cron.job where jobname = 'apice_archive_overdue_kpis');

select cron.schedule(
  'apice_archive_overdue_metas',
  '0 6 * * *',
  $$ select app.archive_overdue_metas(); $$
);

-- ------------------------------------------------------ kpi_latest_values
-- Enxuta: só indicador + último valor. Quem quer saber "isso é meta?"
-- agora pergunta pra meta_latest_values. (view já dropada acima, antes do
-- alter table kpis, por causa da dependência de coluna)
create view public.kpi_latest_values
with (security_invoker = true) as
select distinct on (v.kpi_id)
       v.kpi_id,
       v.company_id,
       v.period_start,
       v.period_end,
       v.value,
       k.name,
       k.unit,
       k.direction,
       k.frequency,
       k.category,
       k.product_id,
       k.product_edition_id,
       k.parent_kpi_id,
       k.archived_at
  from public.kpi_values v
  join public.kpis k on k.id = v.kpi_id
 where k.is_active
 order by v.kpi_id, v.period_start desc;

-- ------------------------------------------------------ meta_latest_values
-- Uma linha por META (não por indicador) — o "kpi_latest_values de antes",
-- só que um kpi_id pode aparecer mais de uma vez (uma por meta que ele tem).
create view public.meta_latest_values
with (security_invoker = true) as
select m.id as meta_id,
       m.kpi_id,
       m.company_id,
       k.name,
       k.unit,
       k.direction,
       k.product_id,
       k.product_edition_id,
       k.parent_kpi_id,
       v.value,
       v.period_start,
       v.period_end,
       m.target_value,
       m.due_date,
       m.owner_id,
       m.status,
       m.archived_at
  from public.metas m
  join public.kpis k on k.id = m.kpi_id
  left join public.kpi_latest_values v on v.kpi_id = m.kpi_id
 where k.is_active;

-- ---------------------------------------------------- company_snapshots()
-- goals_active/at_risk/achieved e kpis_on_target/off_target passam a
-- contar METAS (via meta_latest_values), não KPI com due_date — kpis_total
-- continua contando todo indicador ativo, meta ou não. Nomes de coluna
-- mantidos de propósito (painel da holding já lê por eles).
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
    coalesce(k0.total, 0),
    coalesce(g.on_target, 0),
    coalesce(g.off_target, 0),
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
    select count(*) filter (where mv.status in ('active', 'planned')) as active,
           count(*) filter (where mv.status = 'at_risk') as at_risk,
           count(*) filter (where mv.status = 'achieved') as achieved,
           count(*) filter (
             where mv.target_value is not null
               and ((mv.direction = 'up' and mv.value >= mv.target_value)
                 or (mv.direction = 'down' and mv.value <= mv.target_value))
           ) as on_target,
           count(*) filter (
             where mv.target_value is not null
               and ((mv.direction = 'up' and mv.value < mv.target_value)
                 or (mv.direction = 'down' and mv.value > mv.target_value))
           ) as off_target
      from public.meta_latest_values mv
     where mv.company_id = c.id and mv.archived_at is null
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
