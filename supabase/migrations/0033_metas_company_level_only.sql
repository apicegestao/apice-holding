-- ============================================================================
-- Meta só em indicador de empresa inteira: produto e turma viram nós de
-- medição pura, sem meta própria. kpis.product_id/product_edition_id
-- continuam existindo do jeito que sempre estiveram — só quem pode ter uma
-- linha em metas apontando pra ele muda (kpis.product_id is null). Valor de
-- produto/turma segue sendo só a soma via parent_kpi_id
-- (buildChildrenByParent/effectiveKpiValue, cliente) — o rollup de VALOR
-- não muda nada aqui.
--
-- Achada 1 meta de produção já apontando pra kpi de produto ("Entre Donos
-- (09/26)", empresa MDD) — removida manualmente antes desta migração (o
-- indicador em si continua existindo, só perde alvo/prazo/status).
-- ============================================================================

delete from public.metas
where id in (
  select m.id from public.metas m
  join public.kpis k on k.id = m.kpi_id
  where k.product_id is not null
);

create or replace function app.assert_meta_kpi_company_level()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (
    select 1 from public.kpis k where k.id = new.kpi_id and k.product_id is not null
  ) then
    raise exception 'Meta só pode ser criada em indicador de empresa inteira (sem produto): %', new.kpi_id;
  end if;
  return new;
end $$;

drop trigger if exists metas_company_level_guard on public.metas;
create trigger metas_company_level_guard before insert or update on public.metas
  for each row execute function app.assert_meta_kpi_company_level();
