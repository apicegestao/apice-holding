-- ============================================================================
-- Bug relatado: lançar valores em dias diferentes não soma o total do KPI
-- ("6 vendas em 02/09 e 1 em 01/09, o sistema permanece com 6").
--
-- Causa: o KPI tinha frequency = 'daily' e nenhuma entry_frequency. 'daily' é
-- a cadência mais fina que existe — o período de um KPI diário É um único
-- dia (period_start = period_end), então cada lançamento vira uma leitura
-- isolada daquele dia. kpi_latest_values sempre mostra a leitura do período
-- MAIS RECENTE (distinct on kpi_id order by period_start desc) — nunca soma
-- períodos diferentes. Isso está certo pra métrica de "estado atual" (ex.
-- estoque hoje), mas quebra qualquer meta cumulativa lançada dia a dia (ex.
-- vendas até uma data teto), que é exatamente o que 'daily' como frequência
-- PRINCIPAL convida a fazer por engano.
--
-- Correção: todo KPI com frequency = 'daily' vira frequency = 'monthly' +
-- entry_frequency = 'daily' — a combinação que já soma automaticamente hoje
-- (gatilho app.rollup_kpi_value_entry(), de 0026_kpi_lifecycle.sql). Os
-- lançamentos diários existentes (cada um já no formato period_start =
-- period_end = um dia, idêntico ao de kpi_value_entries) migram pra lá; o
-- próprio gatilho recalcula o total certo do mês assim que eles entram.
-- ============================================================================

do $$
declare
  target uuid;
begin
  for target in select id from public.kpis where frequency = 'daily' loop
    -- Muda a cadência ANTES de mover os lançamentos: o gatilho de soma lê
    -- kpis.frequency na hora do insert pra decidir o período grosso — só dá
    -- pra somar certo (mês inteiro) se já estiver 'monthly' quando os
    -- lançamentos entrarem em kpi_value_entries, não depois.
    update public.kpis
       set frequency = 'monthly', entry_frequency = 'daily'
     where id = target;

    insert into public.kpi_value_entries
      (kpi_id, company_id, period_start, period_end, value, note, created_by, created_at, updated_at)
    select kpi_id, company_id, period_start, period_end, value, note, created_by, created_at, updated_at
      from public.kpi_values
     where kpi_id = target
    on conflict (kpi_id, period_start) do nothing;

    -- Os lançamentos diários antigos (source = 'manual') não têm mais
    -- serventia — o gatilho acima já gravou (ou atualizou) a soma certa do
    -- mês como uma linha 'rollup'; qualquer linha 'manual' que sobrou é
    -- órfã e, se não for removida, "vence" a certa em kpi_latest_values só
    -- por ter period_start mais recente.
    delete from public.kpi_values where kpi_id = target and source = 'manual';
  end loop;
end $$;

-- Trava a regra no banco: frequency (a cadência PRINCIPAL do KPI) nunca pode
-- ser 'daily' — só faz sentido em entry_frequency, onde soma de verdade.
-- Nenhuma tela nova, script ou chamada direta à API consegue recriar o bug.
alter table public.kpis
  add constraint kpis_frequency_not_daily check (frequency <> 'daily');
