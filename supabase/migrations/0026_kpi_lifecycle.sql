-- ============================================================================
-- Ciclo de vida do KPI: arquivamento (automático após o prazo + manual),
-- hierarquia produto pai/sub-produto (parent_kpi_id) e lançamento em cadência
-- mais fina que a frequência declarada (ex.: meta anual, lançamentos mensais
-- que somam pro total do ano) — três pedidos juntos porque todos mexem na
-- mesma tabela e no mesmo fluxo de "Lançar valor".
-- ============================================================================

-- ------------------------------------------------------------- arquivamento
-- archived_at nulo = ativo. Arquivar não apaga nada — só tira da tela
-- principal; o KPI e todo o histórico dele continuam intactos e acessíveis
-- na aba de arquivados.
alter table public.kpis add column if not exists archived_at timestamptz;
create index if not exists kpis_archived_idx on public.kpis (company_id, archived_at);

-- Só arquiva sozinho quem tem prazo (é meta) — um KPI recorrente sem prazo
-- (ex. faturamento mensal) não tem "depois do prazo" nenhum.
create or replace function app.archive_overdue_kpis()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  affected integer;
begin
  with done as (
    update public.kpis
       set archived_at = now()
     where due_date is not null
       and due_date < (now() at time zone 'America/Sao_Paulo')::date
       and archived_at is null
    returning 1
  )
  select count(*) into affected from done;
  return affected;
end $$;

revoke all on function app.archive_overdue_kpis() from public;
grant execute on function app.archive_overdue_kpis() to service_role;

select cron.unschedule('apice_archive_overdue_kpis')
 where exists (select 1 from cron.job where jobname = 'apice_archive_overdue_kpis');

-- 06:00 UTC = 03:00 em Brasília — roda de madrugada, pronto antes do
-- expediente começar.
select cron.schedule(
  'apice_archive_overdue_kpis',
  '0 6 * * *',
  $$ select app.archive_overdue_kpis(); $$
);

-- ------------------------------------------------- produto pai / sub-produto
-- "Entre Donos" (produto, sem edição) tem uma meta maior; cada turma
-- (sub-produto = uma edição) tem a própria meta, que soma pro pai. Só dois
-- níveis de propósito — mantém a conta simples: o pai nunca tem pai.
alter table public.kpis add column if not exists parent_kpi_id uuid references public.kpis (id) on delete set null;
create index if not exists kpis_parent_idx on public.kpis (parent_kpi_id) where parent_kpi_id is not null;

create or replace function app.assert_kpi_parent()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  parent record;
begin
  if new.parent_kpi_id is null then
    return new;
  end if;
  if new.parent_kpi_id = new.id then
    raise exception 'Um KPI não pode ser pai dele mesmo';
  end if;
  select company_id, parent_kpi_id into parent from public.kpis where id = new.parent_kpi_id;
  if not found then
    raise exception 'KPI pai % não encontrado', new.parent_kpi_id;
  end if;
  if parent.company_id is distinct from new.company_id then
    raise exception 'O KPI pai precisa ser da mesma empresa';
  end if;
  if parent.parent_kpi_id is not null then
    raise exception 'Um KPI pai não pode, ele mesmo, ter um pai — só dois níveis';
  end if;
  return new;
end $$;

drop trigger if exists kpis_parent_guard on public.kpis;
create trigger kpis_parent_guard before insert or update of parent_kpi_id on public.kpis
  for each row execute function app.assert_kpi_parent();

-- ------------------------------------------- lançamento em cadência mais fina
-- Um KPI pode ter meta anual mas ser mais fácil de acompanhar lançando mês a
-- mês (ex. faturamento). entry_frequency, quando preenchida, é mais fina que
-- frequency e é a cadência real do lançamento; kpi_value_entries guarda cada
-- lançamento fino, e um gatilho mantém em kpi_values (nunca tocado à mão
-- pela pessoa nesse caso) o total do período de frequency, sempre somado na
-- hora — assim todo o resto do sistema (kpi_latest_values, os dois painéis,
-- os gráficos) continua lendo kpi_values exatamente como já lia, sem saber
-- que por trás existe uma soma.
alter table public.kpis add column if not exists entry_frequency kpi_frequency;

create table if not exists public.kpi_value_entries (
  id           uuid primary key default gen_random_uuid(),
  kpi_id       uuid not null references public.kpis (id) on delete cascade,
  company_id   uuid not null references public.companies (id) on delete cascade,
  period_start date not null,
  period_end   date not null,
  value        numeric(18, 4) not null,
  note         text,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (kpi_id, period_start)
);
create index if not exists kpi_value_entries_lookup_idx
  on public.kpi_value_entries (company_id, kpi_id, period_start desc);

drop trigger if exists kpi_value_entries_touch on public.kpi_value_entries;
create trigger kpi_value_entries_touch before update on public.kpi_value_entries
  for each row execute function app.touch_updated_at();

-- Reaproveita a mesma guarda que kpi_values já usa (confere que o KPI é da
-- empresa informada).
drop trigger if exists kpi_value_entries_company_guard on public.kpi_value_entries;
create trigger kpi_value_entries_company_guard before insert or update on public.kpi_value_entries
  for each row execute function app.assert_kpi_company();

-- Início e fim do período "grosso" (frequency do KPI) que contém a data d —
-- mesmo cálculo, mesma âncora, que periodBounds() faz em core/lib/format.ts.
-- Precisa bater exatamente com o frontend: é o frontend que decide em qual
-- período um lançamento fino cai, e este cálculo é só o espelho em SQL pra
-- somar certo.
create or replace function app.coarse_period_bounds(freq kpi_frequency, d date)
returns table (period_start date, period_end date)
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  ref constant date := date '2024-01-01'; -- uma segunda-feira, mesma âncora do frontend
  monday date;
  weeks_since integer;
  fortnight_index integer;
begin
  case freq
    when 'yearly' then
      period_start := date_trunc('year', d)::date;
      period_end := (date_trunc('year', d) + interval '1 year' - interval '1 day')::date;
    when 'quarterly' then
      period_start := date_trunc('quarter', d)::date;
      period_end := (date_trunc('quarter', d) + interval '3 months' - interval '1 day')::date;
    when 'monthly' then
      period_start := date_trunc('month', d)::date;
      period_end := (date_trunc('month', d) + interval '1 month' - interval '1 day')::date;
    when 'biweekly' then
      monday := d - ((extract(isodow from d)::int) - 1);
      weeks_since := floor((monday - ref) / 7.0);
      fortnight_index := floor(weeks_since / 2.0);
      period_start := ref + (fortnight_index * 14);
      period_end := period_start + 13;
    when 'weekly' then
      monday := d - ((extract(isodow from d)::int) - 1);
      period_start := monday;
      period_end := monday + 6;
    else
      period_start := d;
      period_end := d;
  end case;
  return next;
end $$;

-- Depois de qualquer lançamento fino mudar, refaz a soma do período grosso
-- e grava (ou some, se não sobrou nenhum lançamento) em kpi_values.
create or replace function app.rollup_kpi_value_entry()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  target_kpi_id uuid := coalesce(new.kpi_id, old.kpi_id);
  target_company_id uuid := coalesce(new.company_id, old.company_id);
  ref_date date := coalesce(new.period_start, old.period_start);
  kpi_freq kpi_frequency;
  bounds record;
  entry_count integer;
  total numeric(18, 4);
begin
  select frequency into kpi_freq from public.kpis where id = target_kpi_id;
  select * into bounds from app.coarse_period_bounds(kpi_freq, ref_date);

  select count(*), coalesce(sum(value), 0) into entry_count, total
    from public.kpi_value_entries
   where kpi_id = target_kpi_id
     and period_start between bounds.period_start and bounds.period_end;

  if entry_count = 0 then
    delete from public.kpi_values
     where kpi_id = target_kpi_id and period_start = bounds.period_start;
  else
    insert into public.kpi_values (kpi_id, company_id, period_start, period_end, value, source)
    values (target_kpi_id, target_company_id, bounds.period_start, bounds.period_end, total, 'rollup')
    on conflict (kpi_id, period_start) do update
      set value = excluded.value, source = 'rollup', updated_at = now();
  end if;

  return coalesce(new, old);
end $$;

drop trigger if exists kpi_value_entries_rollup on public.kpi_value_entries;
create trigger kpi_value_entries_rollup
  after insert or update or delete on public.kpi_value_entries
  for each row execute function app.rollup_kpi_value_entry();

-- ---------------------------------------------------------------- RLS
alter table public.kpi_value_entries enable row level security;

drop policy if exists kpi_value_entries_select on public.kpi_value_entries;
create policy kpi_value_entries_select on public.kpi_value_entries for select to authenticated
  using (app.is_member(company_id));
drop policy if exists kpi_value_entries_write on public.kpi_value_entries;
create policy kpi_value_entries_write on public.kpi_value_entries for all to authenticated
  using (app.can_write(company_id)) with check (app.can_write(company_id));

-- kpi_latest_values ganha archived_at, pra quem consulta poder filtrar os
-- arquivados sem outra consulta (a view em si continua trazendo todo mundo —
-- quem decide o que mostrar é a tela).
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
       k.product_edition_id,
       k.parent_kpi_id,
       k.archived_at
  from public.kpi_values v
  join public.kpis k on k.id = v.kpi_id
 where k.is_active
 order by v.kpi_id, v.period_start desc;
