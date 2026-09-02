-- ============================================================================
-- Módulo Orçamentos: um orçamento por evento/projeto (a mesa dos donos monta
-- um pra cada evento que organiza), com linhas de receita e despesa — cada
-- linha nasce como cotação, vira aprovada e por fim paga/recebida, com valor
-- previsto e valor realizado lado a lado. A projeção de caixa (por mês) e os
-- totais são sempre calculados no próprio frontend a partir dessas linhas —
-- nunca guardados prontos — pra nunca ficarem desatualizados.
-- ============================================================================

create table if not exists public.budgets (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  title       text not null,
  description text,
  event_date  date,
  status      text not null default 'planejamento'
                check (status in ('planejamento', 'aprovado', 'em_andamento', 'encerrado')),
  owner_id    uuid references public.profiles (id) on delete set null,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists budgets_company_idx on public.budgets (company_id, event_date);

drop trigger if exists budgets_touch on public.budgets;
create trigger budgets_touch before update on public.budgets
  for each row execute function app.touch_updated_at();

-- Uma linha por item de receita ou despesa. status cobre o ciclo pedido:
-- cotação -> aprovado -> pago (liquidado — "pago" pra despesa, "recebido"
-- pra receita, o rótulo muda só na tela) -> ou cancelado no meio do caminho.
create table if not exists public.budget_items (
  id             uuid primary key default gen_random_uuid(),
  budget_id      uuid not null references public.budgets (id) on delete cascade,
  company_id     uuid not null references public.companies (id) on delete cascade,
  kind           text not null default 'despesa' check (kind in ('receita', 'despesa')),
  category       text not null default 'Geral',
  title          text not null,
  vendor         text,
  status         text not null default 'previsto'
                   check (status in ('previsto', 'cotado', 'aprovado', 'pago', 'cancelado')),
  planned_amount numeric(14, 2) not null default 0 check (planned_amount >= 0),
  actual_amount  numeric(14, 2) check (actual_amount is null or actual_amount >= 0),
  due_date       date,
  notes          text,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists budget_items_budget_idx on public.budget_items (budget_id);

drop trigger if exists budget_items_touch on public.budget_items;
create trigger budget_items_touch before update on public.budget_items
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------- RLS
-- Mesmo padrão de todo módulo por empresa: quem é membro vê, quem tem
-- permissão de escrita mexe.
alter table public.budgets      enable row level security;
alter table public.budget_items enable row level security;

drop policy if exists budgets_select on public.budgets;
create policy budgets_select on public.budgets for select to authenticated
  using (app.is_member(company_id));
drop policy if exists budgets_write on public.budgets;
create policy budgets_write on public.budgets for all to authenticated
  using (app.can_write(company_id)) with check (app.can_write(company_id));

drop policy if exists budget_items_select on public.budget_items;
create policy budget_items_select on public.budget_items for select to authenticated
  using (app.is_member(company_id));
drop policy if exists budget_items_write on public.budget_items;
create policy budget_items_write on public.budget_items for all to authenticated
  using (app.can_write(company_id)) with check (app.can_write(company_id));
