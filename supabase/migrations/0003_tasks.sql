-- ============================================================================
-- Módulo Tarefas (quem, o quê, prazo e lembrete)
-- ============================================================================

do $$ begin
  create type task_status as enum ('todo', 'doing', 'blocked', 'done', 'canceled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_priority as enum ('low', 'medium', 'high', 'urgent');
exception when duplicate_object then null; end $$;

create table if not exists public.tasks (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  title            text not null,
  description      text,
  assignee_id      uuid references public.profiles (id) on delete set null,
  created_by       uuid references public.profiles (id) on delete set null,
  due_date         date,
  remind_at        timestamptz,
  reminder_sent_at timestamptz,
  priority         task_priority not null default 'medium',
  status           task_status not null default 'todo',
  tags             text[] not null default '{}',
  mind_map_node_id uuid,
  goal_id          uuid references public.goals (id) on delete set null,
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists tasks_company_idx on public.tasks (company_id, status, due_date);
create index if not exists tasks_assignee_idx on public.tasks (assignee_id, status);
create index if not exists tasks_reminder_idx
  on public.tasks (remind_at) where reminder_sent_at is null and status not in ('done', 'canceled');

drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks
  for each row execute function app.touch_updated_at();

-- Carimba/limpa completed_at conforme o status muda.
create or replace function app.sync_task_completion()
returns trigger language plpgsql as $$
declare
  previous_status task_status := case when tg_op = 'UPDATE' then old.status else null end;
begin
  if new.status = 'done' and previous_status is distinct from 'done'::task_status then
    new.completed_at = now();
  elsif new.status <> 'done' then
    new.completed_at = null;
  end if;
  return new;
end $$;

drop trigger if exists tasks_completion on public.tasks;
create trigger tasks_completion before insert or update on public.tasks
  for each row execute function app.sync_task_completion();

create table if not exists public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  author_id  uuid references public.profiles (id) on delete set null,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists task_comments_task_idx on public.task_comments (task_id, created_at);

-- Notifica o responsável quando a tarefa é atribuída a ele.
create or replace function app.notify_task_assignment()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  previous_assignee uuid := case when tg_op = 'UPDATE' then old.assignee_id else null end;
begin
  if new.assignee_id is not null
     and new.assignee_id is distinct from previous_assignee
     and new.assignee_id is distinct from auth.uid() then
    insert into public.notifications (user_id, company_id, kind, title, body, link)
    values (new.assignee_id, new.company_id, 'task',
            'Nova tarefa atribuída a você', new.title,
            '/empresa/' || new.company_id || '/tarefas');
  end if;
  return new;
end $$;

drop trigger if exists tasks_notify_assignment on public.tasks;
create trigger tasks_notify_assignment after insert or update of assignee_id on public.tasks
  for each row execute function app.notify_task_assignment();

-- ---------------------------------------------------------------- RLS
alter table public.tasks         enable row level security;
alter table public.task_comments enable row level security;

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (app.is_member(company_id));

-- Colaboradores e admins criam/editam. O "usuário" (viewer) só pode mexer
-- na tarefa da qual ele é o responsável — para poder concluí-la.
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (app.can_write(company_id));

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (app.can_write(company_id) or (app.is_member(company_id) and assignee_id = auth.uid()))
  with check (app.can_write(company_id) or (app.is_member(company_id) and assignee_id = auth.uid()));

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
  using (app.can_write(company_id));

drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select on public.task_comments for select to authenticated
  using (app.is_member(company_id));

drop policy if exists task_comments_insert on public.task_comments;
create policy task_comments_insert on public.task_comments for insert to authenticated
  with check (app.is_member(company_id) and author_id = auth.uid());

drop policy if exists task_comments_delete on public.task_comments;
create policy task_comments_delete on public.task_comments for delete to authenticated
  using (author_id = auth.uid() or app.is_company_admin(company_id));
