-- ============================================================================
-- Financeiro — livro de lançamentos: Fase 3 do plano de virar um sistema de
-- gestão completo por empresa. `budgets`/`budget_items` já cobrem orçamento
-- de evento/projeto (previsto x realizado, um orçamento por vez) — o que
-- faltava era o dia a dia: receita/despesa avulsa da empresa, sem precisar
-- amarrar tudo a um orçamento. `financial_entries` é esse livro-caixa.
--
-- Vínculo com área/produto/turma/orçamento é opcional (nullable), mesmo
-- padrão de sempre — um lançamento pode ser só "da empresa" sem nenhum
-- deles, ou pode reconciliar com uma linha específica de um orçamento
-- (`budget_item_id`), pra comparar o previsto/cotado dela com o que
-- realmente entrou/saiu no caixa.
-- ============================================================================

create table if not exists public.financial_entries (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  department_id      uuid references public.departments (id) on delete set null,
  product_id         uuid references public.products (id) on delete set null,
  product_edition_id uuid references public.product_editions (id) on delete set null,
  budget_item_id     uuid references public.budget_items (id) on delete set null,
  kind               text not null check (kind in ('receita', 'despesa')),
  category           text not null default 'Geral',
  description        text not null,
  amount             numeric(14, 2) not null check (amount > 0),
  occurred_at        date not null default current_date,
  notes              text,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists financial_entries_company_idx
  on public.financial_entries (company_id, occurred_at desc);
create index if not exists financial_entries_department_idx
  on public.financial_entries (department_id) where department_id is not null;
create index if not exists financial_entries_product_idx
  on public.financial_entries (product_id) where product_id is not null;
create index if not exists financial_entries_edition_idx
  on public.financial_entries (product_edition_id) where product_edition_id is not null;
create index if not exists financial_entries_budget_item_idx
  on public.financial_entries (budget_item_id) where budget_item_id is not null;

drop trigger if exists financial_entries_touch on public.financial_entries;
create trigger financial_entries_touch before update on public.financial_entries
  for each row execute function app.touch_updated_at();

-- Confere, na gravação, que cada vínculo opcional é da mesma empresa do
-- lançamento — mesmo padrão de app.assert_kpi_product()/
-- app.assert_task_department() etc. Turma precisa ser do produto
-- informado (não só da empresa); item de orçamento precisa ser da mesma
-- empresa (a tabela budget_items já carrega company_id direto).
create or replace function app.assert_financial_entry_links()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.department_id is not null and not exists (
    select 1 from public.departments d
     where d.id = new.department_id and d.company_id = new.company_id
  ) then
    raise exception 'Área % não pertence à empresa do lançamento', new.department_id;
  end if;
  if new.product_id is not null and not exists (
    select 1 from public.products p
     where p.id = new.product_id and p.company_id = new.company_id
  ) then
    raise exception 'Produto % não pertence à empresa do lançamento', new.product_id;
  end if;
  if new.product_edition_id is not null and not exists (
    select 1 from public.product_editions e
     where e.id = new.product_edition_id and e.product_id = new.product_id
  ) then
    raise exception 'Edição % não pertence ao produto do lançamento', new.product_edition_id;
  end if;
  if new.budget_item_id is not null and not exists (
    select 1 from public.budget_items bi
     where bi.id = new.budget_item_id and bi.company_id = new.company_id
  ) then
    raise exception 'Item de orçamento % não pertence à empresa do lançamento', new.budget_item_id;
  end if;
  return new;
end $$;

drop trigger if exists financial_entries_links_guard on public.financial_entries;
create trigger financial_entries_links_guard before insert or update on public.financial_entries
  for each row execute function app.assert_financial_entry_links();

-- ---------------------------------------------------------------- RLS
alter table public.financial_entries enable row level security;

drop policy if exists financial_entries_select on public.financial_entries;
create policy financial_entries_select on public.financial_entries for select to authenticated
  using (app.is_member(company_id));
drop policy if exists financial_entries_write on public.financial_entries;
create policy financial_entries_write on public.financial_entries for all to authenticated
  using (app.can_write(company_id)) with check (app.can_write(company_id));
