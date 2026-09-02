-- ============================================================================
-- Bug encontrado ao corrigir 0030: o gatilho de soma (0026_kpi_lifecycle.sql)
-- atualiza value/source/updated_at no conflito, mas nunca period_end. Isso é
-- inofensivo no uso normal (period_end de um mesmo period_start nunca muda
-- de uma soma pra outra), mas quando uma linha de kpi_values já existia
-- ANTES de o KPI passar a usar entry_frequency (ex.: o lançamento diário
-- avulso que a migração 0030 herdou), o primeiro upsert some o valor certo
-- mas deixa o period_end antigo (de um único dia) grudado pra sempre —
-- period_start certo, período errado.
-- ============================================================================

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
      set period_end = excluded.period_end, value = excluded.value, source = 'rollup', updated_at = now();
  end if;

  return coalesce(new, old);
end $$;

-- Reparo único: qualquer linha 'rollup' que já ficou com period_end errado
-- por causa do bug acima (na prática, hoje, só a herdada por 0030).
update public.kpi_values v
   set period_end = fixed.period_end
  from (
    select v2.id, b.period_end
      from public.kpi_values v2
      join public.kpis k on k.id = v2.kpi_id
      cross join lateral app.coarse_period_bounds(k.frequency, v2.period_start) b
     where v2.source = 'rollup'
  ) fixed
 where v.id = fixed.id
   and v.period_end <> fixed.period_end;
