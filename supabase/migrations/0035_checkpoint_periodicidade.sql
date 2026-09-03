-- ============================================================================
-- Repartir um alvo por qualquer período (não só semana): dia, semana,
-- quinzena, mês, bimestre, trimestre, semestre, ano. kpi_checkpoints ganha
-- uma coluna própria pra periodicidade escolhida — independente de
-- kpis.frequency/entry_frequency, porque repartir o CRONOGRAMA de um alvo é
-- uma decisão diferente de com que cadência o indicador é medido (dá pra
-- medir uma meta mensalmente e ainda assim repartir o alvo anual dela por
-- trimestre, por exemplo).
--
-- Também muda a SEMÂNTICA da parcela, no cliente (o banco não interpreta
-- target_value, só guarda): até aqui cada checkpoint guardava uma fatia
-- ACUMULADA do alvo final (semana 1 pedia 1/N do total, a última pedia o
-- total inteiro) — só dava pra comparar contra o valor corrente/acumulado
-- do indicador. A partir de agora cada parcela é uma COTA do próprio
-- período (alvo de R$100.000 em 4 meses = 4 parcelas de R$25.000 cada,
-- como o usuário pediu), comparável contra o que foi lançado NAQUELE
-- período específico — dá pra acompanhar "fechei esse mês?" em vez de só
-- "estou no total certo até aqui?".
-- ============================================================================

do $$ begin
  create type checkpoint_frequency as enum
    ('daily', 'weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'semiannual', 'yearly');
exception when duplicate_object then null; end $$;

alter table public.kpi_checkpoints
  add column if not exists frequency checkpoint_frequency not null default 'weekly';

comment on column public.kpi_checkpoints.frequency is
  'Periodicidade escolhida ao repartir o alvo (dia/semana/quinzena/mês/bimestre/trimestre/semestre/ano) — rótulo e geração ficam no cliente, o banco só guarda.';
