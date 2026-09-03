-- O dia e o horário exatos que um lançamento representa, diferente do
-- período de agregação (period_start/period_end) — que pra frequência
-- mensal, por exemplo, sempre cai no dia 1 (ver periodBounds() em
-- core/lib/format.ts). Sem esta coluna, o formulário de lançamento não
-- tinha como guardar "isso foi lançado no dia 14 às 15h", só em qual
-- mês/semana/trimestre aquilo caiu — só dava pra escolher o mês (input
-- type="month"), sem calendário completo nem horário.
alter table public.kpi_values
  add column if not exists occurred_at timestamptz not null default now();
alter table public.kpi_value_entries
  add column if not exists occurred_at timestamptz not null default now();
