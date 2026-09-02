-- ============================================================================
-- Lembretes padrão de tarefa. Antes, "lembrete" era um campo de data e hora
-- livre (fácil de esquecer de preencher, chato de digitar). Agora todo
-- prazo já vem com dois lembretes automáticos:
--   - N dias antes do prazo (N escolhido num menu suspenso, 1 a 15)
--   - no próprio dia do prazo
-- ambos no horário escolhido. remind_at continua existindo — é calculado
-- pelo banco, não digitado — e o job que já processava lembretes (a cada 5
-- minutos, migração 0007) continua sendo o mesmo, só ganhou uma segunda
-- checagem.
-- ============================================================================

alter table public.tasks
  add column if not exists remind_days_before smallint check (remind_days_before between 1 and 15),
  add column if not exists remind_time time not null default '09:00',
  add column if not exists due_reminder_sent_at timestamptz;

-- Recalcula remind_at sempre que prazo, dias-antes ou horário mudam, e
-- reabre a janela de envio (senão um prazo adiado nunca lembraria de novo).
create or replace function app.sync_task_reminder()
returns trigger language plpgsql as $$
begin
  if new.due_date is not null and new.remind_days_before is not null then
    new.remind_at := (new.due_date - (new.remind_days_before || ' days')::interval) + new.remind_time;
  else
    new.remind_at := null;
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  if new.due_date is distinct from old.due_date
     or new.remind_days_before is distinct from old.remind_days_before
     or new.remind_time is distinct from old.remind_time then
    new.reminder_sent_at := null;
  end if;

  if new.due_date is distinct from old.due_date
     or new.remind_time is distinct from old.remind_time then
    new.due_reminder_sent_at := null;
  end if;

  return new;
end $$;

drop trigger if exists tasks_sync_reminder on public.tasks;
create trigger tasks_sync_reminder before insert or update on public.tasks
  for each row execute function app.sync_task_reminder();

-- ---------------------------------------------------------------- lembretes
-- Duas passadas: o lembrete antecipado (já existia, só reaproveitado) e o do
-- dia do prazo (novo). Cada um com seu próprio "já enviado" — um não pisa
-- no controle do outro.
create or replace function app.process_task_reminders()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  affected integer := 0;
  touched integer;
begin
  with due as (
    select t.id, t.company_id, t.title, t.due_date,
           coalesce(t.assignee_id, t.created_by) as target_user
      from public.tasks t
     where t.remind_at is not null
       and t.remind_at <= now()
       and t.reminder_sent_at is null
       and t.status not in ('done', 'canceled')
       and coalesce(t.assignee_id, t.created_by) is not null
     limit 500
  ),
  sent as (
    insert into public.notifications (user_id, company_id, kind, title, body, link)
    select due.target_user, due.company_id, 'reminder',
           'Lembrete: ' || due.title,
           case when due.due_date is null then 'Sem prazo definido'
                else 'Prazo: ' || to_char(due.due_date, 'DD/MM/YYYY') end,
           '/empresa/' || due.company_id || '/tarefas'
      from due
    returning 1
  )
  update public.tasks t set reminder_sent_at = now() from due where t.id = due.id;
  get diagnostics touched = row_count;
  affected := affected + touched;

  with due_today as (
    select t.id, t.company_id, t.title,
           coalesce(t.assignee_id, t.created_by) as target_user
      from public.tasks t
     where t.due_date is not null
       and (t.due_date + t.remind_time) <= now()
       and t.due_reminder_sent_at is null
       and t.status not in ('done', 'canceled')
       and coalesce(t.assignee_id, t.created_by) is not null
     limit 500
  ),
  sent_today as (
    insert into public.notifications (user_id, company_id, kind, title, body, link)
    select due_today.target_user, due_today.company_id, 'reminder',
           'Prazo é hoje: ' || due_today.title,
           'Esta tarefa vence hoje.',
           '/empresa/' || due_today.company_id || '/tarefas'
      from due_today
    returning 1
  )
  update public.tasks t set due_reminder_sent_at = now() from due_today where t.id = due_today.id;
  get diagnostics touched = row_count;
  affected := affected + touched;

  return affected;
end $$;

revoke all on function app.process_task_reminders() from public;
grant execute on function app.process_task_reminders() to service_role;
