-- ============================================================================
-- Visibilidade das tarefas
--   private  → só o criador e o responsável
--   company  → todos os membros da empresa dona (comportamento anterior)
--   shared   → quem estiver em task_shares (empresas e/ou pessoas)
-- ============================================================================

do $$ begin
  create type task_visibility as enum ('private', 'company', 'shared');
exception when duplicate_object then null; end $$;

alter table public.tasks
  add column if not exists visibility task_visibility not null default 'private';

create table if not exists public.task_shares (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  -- cada linha aponta para uma empresa OU uma pessoa, nunca as duas
  constraint task_shares_one_target check (num_nonnulls(company_id, user_id) = 1)
);
create unique index if not exists task_shares_company_uniq
  on public.task_shares (task_id, company_id) where company_id is not null;
create unique index if not exists task_shares_user_uniq
  on public.task_shares (task_id, user_id) where user_id is not null;
create index if not exists task_shares_task_idx on public.task_shares (task_id);

-- SECURITY DEFINER: a policy de tasks consulta task_shares e vice-versa;
-- sem isso as duas RLS se chamariam em círculo.
create or replace function app.task_shared_with_me(p_task uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
      from public.task_shares s
     where s.task_id = p_task
       and (
         s.user_id = auth.uid()
         or (s.company_id is not null and app.is_member(s.company_id))
       )
  );
$$;

create or replace function app.owns_task(p_task uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.tasks t where t.id = p_task and t.created_by = auth.uid()
  );
$$;

revoke all on function app.task_shared_with_me(uuid), app.owns_task(uuid) from public;
grant execute on function app.task_shared_with_me(uuid), app.owns_task(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------- RLS tasks
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (
    created_by = auth.uid()
    or assignee_id = auth.uid()
    or (visibility = 'company' and app.is_member(company_id))
    or (visibility = 'shared' and app.task_shared_with_me(id))
  );

-- Qualquer membro cria a própria tarefa privada; tarefa da empresa exige
-- permissão de escrita.
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (
    created_by = auth.uid()
    and app.is_member(company_id)
    and (visibility = 'private' or app.can_write(company_id))
  );

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (
    created_by = auth.uid()
    or (assignee_id = auth.uid() and app.is_member(company_id))
    or (visibility <> 'private' and app.can_write(company_id))
  )
  with check (
    created_by = auth.uid()
    or (assignee_id = auth.uid() and app.is_member(company_id))
    or (visibility <> 'private' and app.can_write(company_id))
  );

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
  using (
    created_by = auth.uid()
    or (visibility <> 'private' and app.can_write(company_id))
  );

-- --------------------------------------------------------- RLS task_shares
alter table public.task_shares enable row level security;

drop policy if exists task_shares_select on public.task_shares;
create policy task_shares_select on public.task_shares for select to authenticated
  using (
    app.owns_task(task_id)
    or user_id = auth.uid()
    or (company_id is not null and app.is_member(company_id))
  );

-- Só o dono da tarefa compartilha, e só para empresas em que ele entra ou
-- pessoas com quem ele já divide alguma empresa.
drop policy if exists task_shares_insert on public.task_shares;
create policy task_shares_insert on public.task_shares for insert to authenticated
  with check (
    app.owns_task(task_id)
    and created_by = auth.uid()
    and (
      (company_id is not null and app.is_member(company_id))
      or (user_id is not null and (app.shares_company(user_id) or app.is_super_admin()))
    )
  );

drop policy if exists task_shares_delete on public.task_shares;
create policy task_shares_delete on public.task_shares for delete to authenticated
  using (app.owns_task(task_id) or app.is_super_admin());

-- ------------------------------------------------- comentários seguem a tarefa
drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select on public.task_comments for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));

drop policy if exists task_comments_insert on public.task_comments;
create policy task_comments_insert on public.task_comments for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (select 1 from public.tasks t where t.id = task_id)
  );

-- ------------------------------------------------------------ consultas
-- Tarefas que aparecem no quadro de uma empresa: as dela mais as que foram
-- compartilhadas com ela. SECURITY INVOKER, então a RLS continua valendo.
create or replace function public.tasks_for_company(p_company uuid)
returns setof public.tasks language sql stable set search_path = public, pg_temp as $$
  select t.*
    from public.tasks t
   where t.company_id = p_company
      or exists (
        select 1 from public.task_shares s
         where s.task_id = t.id and s.company_id = p_company
      );
$$;

grant execute on function public.tasks_for_company(uuid) to authenticated;
