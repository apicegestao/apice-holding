-- ============================================================================
-- Insight diário automático: todo dia às 7h (horário de Brasília) a IA gera
-- um resumo com as prioridades do dia — um para a holding, um para cada
-- empresa ativa — chamando a mesma Edge Function ai-insights que o botão
-- "Gerar Insights" já usa, só que assinada com o segredo interno em vez de
-- login (não tem ninguém logado às 7h da manhã).
-- ============================================================================

create or replace function app.trigger_daily_insights()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  shared_secret text;
  company record;
begin
  select value into shared_secret from app.system_settings where key = 'sync_shared_secret';
  if shared_secret is null then
    return;
  end if;

  -- Resumo consolidado da holding.
  perform net.http_post(
    url := 'https://hhlxazpqonkfcgrcmzpp.supabase.co/functions/v1/ai-insights',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', shared_secret
    ),
    body := jsonb_build_object('scope', 'holding'),
    timeout_milliseconds := 55000
  );

  -- Um resumo por empresa ativa (a holding em si não entra nesta lista —
  -- ela já foi coberta acima).
  for company in
    select id from public.companies where is_active and not is_holding
  loop
    perform net.http_post(
      url := 'https://hhlxazpqonkfcgrcmzpp.supabase.co/functions/v1/ai-insights',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sync-secret', shared_secret
      ),
      body := jsonb_build_object('scope', 'company', 'company_id', company.id),
      timeout_milliseconds := 55000
    );
  end loop;
end $$;

revoke all on function app.trigger_daily_insights() from public;
grant execute on function app.trigger_daily_insights() to service_role;

select cron.unschedule('apice_daily_insights')
 where exists (select 1 from cron.job where jobname = 'apice_daily_insights');

-- 10:00 UTC = 07:00 em Brasília.
select cron.schedule(
  'apice_daily_insights',
  '0 10 * * *',
  $$ select app.trigger_daily_insights(); $$
);
