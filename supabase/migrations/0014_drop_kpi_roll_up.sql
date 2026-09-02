-- ============================================================================
-- Nada de uma empresa fica escondido da holding: a escolha de "mostrar no
-- consolidado" some, e todo KPI ativo passa a aparecer no painel do grupo.
-- A RLS continua sendo o unico filtro — quem nao e membro segue sem ver nada.
-- ============================================================================

drop view if exists public.kpi_latest_values;

alter table public.kpis drop column if exists roll_up;

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
       k.category
  from public.kpi_values v
  join public.kpis k on k.id = v.kpi_id
 where k.is_active
 order by v.kpi_id, v.period_start desc;
