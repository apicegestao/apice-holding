-- ============================================================================
-- Lembrete diário: todo dia às 7:30 (horário de Brasília), quem tem tarefa
-- com prazo hoje recebe uma notificação resumindo quantas são e quais —
-- além do aviso "prazo é hoje" que cada tarefa já dispara no seu próprio
-- horário de lembrete (migração 0019). Este é um resumo do dia, sempre no
-- mesmo horário, para quem abre o sistema de manhã já ver o que tem pra hoje.
--
-- O banco roda em UTC (confirmado: now() em UTC) e Brasília é UTC-3 o ano
-- inteiro desde 2019 (sem horário de verão) — por isso o agendamento abaixo
-- usa 10:30 UTC para cair às 7:30 em Brasília.
-- ============================================================================

create or replace function app.send_daily_task_digest()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  affected integer := 0;
begin
  -- Uma notificação por pessoa e por empresa (o link leva direto pro quadro
  -- daquela empresa). Quem não tem nada pra hoje não recebe nada — resumo
  -- vazio não ajuda ninguém.
  with today_tasks as (
    select t.company_id,
           coalesce(t.assignee_id, t.created_by) as target_user,
           t.title
      from public.tasks t
     where t.due_date = (now() at time zone 'America/Sao_Paulo')::date
       and t.status not in ('done', 'canceled')
       and coalesce(t.assignee_id, t.created_by) is not null
  ),
  grouped as (
    select company_id, target_user,
           count(*) as total,
           array_agg(title order by title) as titles
      from today_tasks
     group by company_id, target_user
  ),
  -- Já mandou o resumo pra essa pessoa/empresa hoje (fuso de Brasília)? Não
  -- manda de novo — protege contra o job rodar mais de uma vez no mesmo dia.
  already_sent as (
    select distinct user_id, company_id
      from public.notifications
     where kind = 'daily_digest'
       and (created_at at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date
  ),
  sent as (
    insert into public.notifications (user_id, company_id, kind, title, body, link)
    select g.target_user, g.company_id, 'daily_digest',
           case when g.total = 1 then 'Você tem 1 tarefa para hoje'
                else 'Você tem ' || g.total || ' tarefas para hoje' end,
           case when g.total <= 4 then array_to_string(g.titles, ' · ')
                else array_to_string(g.titles[1:4], ' · ') || ' e mais ' || (g.total - 4) end,
           '/empresa/' || g.company_id || '/tarefas'
      from grouped g
      left join already_sent a on a.user_id = g.target_user and a.company_id = g.company_id
     where a.user_id is null
    returning 1
  )
  select count(*) into affected from sent;

  return affected;
end $$;

revoke all on function app.send_daily_task_digest() from public;
grant execute on function app.send_daily_task_digest() to service_role;

select cron.unschedule('apice_daily_task_digest')
 where exists (select 1 from cron.job where jobname = 'apice_daily_task_digest');

-- 10:30 UTC = 7:30 em Brasília (UTC-3, sem horário de verão).
select cron.schedule(
  'apice_daily_task_digest',
  '30 10 * * *',
  $$ select app.send_daily_task_digest(); $$
);
