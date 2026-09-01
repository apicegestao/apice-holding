-- ============================================================================
-- Agendamentos: lembretes de tarefa e sincronizacao automatica de integracoes
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Configuracoes internas do sistema. Sem grants para anon/authenticated:
-- apenas o service_role (Edge Functions) enxerga esta tabela.
create table if not exists app.system_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
revoke all on table app.system_settings from public, anon, authenticated;
grant select, insert, update, delete on table app.system_settings to service_role;

insert into app.system_settings (key, value)
values ('sync_shared_secret', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

-- Lembretes de tarefa: roda no proprio banco, a cada 5 minutos.
select cron.unschedule('apice_task_reminders')
 where exists (select 1 from cron.job where jobname = 'apice_task_reminders');

select cron.schedule(
  'apice_task_reminders',
  '*/5 * * * *',
  $$ select app.process_task_reminders(); $$
);

-- Sincronizacao automatica das integracoes: chama a Edge Function assinando
-- com o segredo interno (a funcao valida o header antes de fazer qualquer coisa).
-- pg_net expoe http_post no schema "net".
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
