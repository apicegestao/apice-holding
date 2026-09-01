-- Correcao: pg_net expoe http_post no schema "net", nao em "extensions".
-- Ja vem corrigido em 0007 numa instalacao nova; este arquivo existe para o
-- historico bater com os bancos que aplicaram 0007 antes da correcao.
select cron.unschedule('apice_integrations_sync')
 where exists (select 1 from cron.job where jobname = 'apice_integrations_sync');

select cron.schedule(
  'apice_integrations_sync',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://hhlxazpqonkfcgrcmzpp.supabase.co/functions/v1/integrations-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select value from app.system_settings where key = 'sync_shared_secret')
    ),
    body := jsonb_build_object('trigger', 'cron'),
    timeout_milliseconds := 25000
  );
  $$
);
