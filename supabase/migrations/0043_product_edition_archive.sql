-- Pedido do usuário: opção de arquivar uma turma/edição (sub-produto).
-- Mesmo padrão de sempre (kpis.archived_at, metas.archived_at,
-- 0026_kpi_lifecycle.sql): null = ativa; arquivar não apaga nada, só tira
-- da tela principal — reversível a qualquer momento.
alter table public.product_editions add column if not exists archived_at timestamptz;
create index if not exists product_editions_archived_idx on public.product_editions (company_id, archived_at);
