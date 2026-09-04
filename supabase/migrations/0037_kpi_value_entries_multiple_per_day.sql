-- Permite mais de um lançamento fino no mesmo período (ex.: várias vendas
-- no mesmo dia) — até aqui, unique(kpi_id, period_start) garantia no máximo
-- um valor por dia, e "lançar de novo" no mesmo dia sempre virava edição do
-- único lançamento existente em vez de somar mais um. O gatilho de soma
-- (app.rollup_kpi_value_entry, 0026_kpi_lifecycle.sql) já soma TODOS os
-- lançamentos dentro do período grosso via agregação — nunca dependeu da
-- unicidade por dia, então tirar essa trava não muda o cálculo do total,
-- só libera múltiplas linhas no mesmo dia.
alter table public.kpi_value_entries
  drop constraint if exists kpi_value_entries_kpi_id_period_start_key;

-- kpi_values (a linha "grossa"/rollup por período) continua única por
-- período — ela representa o TOTAL do período, não lançamentos individuais,
-- e seguir sendo uma linha só por período é o que o resto do sistema
-- (painéis, gráficos, meta_latest_values) espera.

-- A unique dropada acima era, de quebra, o único índice com kpi_id como
-- coluna líder — sem ela, apagar um KPI (cascade em kpi_value_entries) e
-- qualquer busca direta por kpi_id fazem varredura de tabela inteira.
-- kpi_value_entries_lookup_idx (company_id, kpi_id, ...) não cobre isso,
-- kpi_id não é a primeira coluna dele.
create index if not exists kpi_value_entries_kpi_id_idx on public.kpi_value_entries (kpi_id);
