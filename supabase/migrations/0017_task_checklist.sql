-- ============================================================================
-- Subtarefas: uma lista de itens dentro da tarefa ("ligar pro fornecedor",
-- "revisar com o financeiro"...), cada um com sua própria caixinha. As notas
-- já tinham tabela pronta desde o módulo de tarefas (public.task_comments,
-- criada em 0003) mas nunca ganharam tela — só a checklist é banco novo.
-- ============================================================================

create table if not exists public.task_checklist_items (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  title      text not null,
  done       boolean not null default false,
  position   integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists task_checklist_items_task_idx
  on public.task_checklist_items (task_id, position);

drop trigger if exists task_checklist_items_touch on public.task_checklist_items;
create trigger task_checklist_items_touch before update on public.task_checklist_items
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------- RLS
-- Mesma regra dos comentários (0012): quem já enxerga a tarefa por
-- app.is_member/visibilidade/compartilhamento enxerga e mexe na checklist
-- dela também — é a checagem em tasks_select, via subconsulta, que decide.
alter table public.task_checklist_items enable row level security;

drop policy if exists task_checklist_items_select on public.task_checklist_items;
create policy task_checklist_items_select on public.task_checklist_items for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));

drop policy if exists task_checklist_items_insert on public.task_checklist_items;
create policy task_checklist_items_insert on public.task_checklist_items for insert to authenticated
  with check (exists (select 1 from public.tasks t where t.id = task_id));

drop policy if exists task_checklist_items_update on public.task_checklist_items;
create policy task_checklist_items_update on public.task_checklist_items for update to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id))
  with check (exists (select 1 from public.tasks t where t.id = task_id));

drop policy if exists task_checklist_items_delete on public.task_checklist_items;
create policy task_checklist_items_delete on public.task_checklist_items for delete to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));
