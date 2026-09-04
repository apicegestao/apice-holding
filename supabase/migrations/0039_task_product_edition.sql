-- Refina a granularidade de tarefa: até aqui `tasks.product_id` só ia até o
-- nível do produto — não dava pra vincular uma tarefa a UMA turma
-- específica (ex. "Confirmar local do evento" da Imersão Setembro 2026,
-- não de Entre Donos inteiro). O painel de produto/turma (ProductDashboard)
-- só mostrava tarefas no nível de produto por causa exatamente dessa
-- limitação — este é o fix de verdade dela, não um contorno na tela.
alter table public.tasks
  add column if not exists product_edition_id uuid references public.product_editions (id) on delete set null;
create index if not exists tasks_product_edition_idx
  on public.tasks (product_edition_id) where product_edition_id is not null;

-- De quebra: `tasks.product_id` nunca ganhou o guard de "produto é da mesma
-- empresa da tarefa" que kpis/budgets já têm desde 0024_products.sql
-- (app.assert_kpi_product()/app.assert_budget_product()) — lacuna real,
-- não intencional. Como estamos mexendo em tasks agora mesmo, fecha os
-- dois de uma vez: confere produto da mesma empresa E, se houver edição,
-- que ela é desse mesmo produto.
create or replace function app.assert_task_product()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.product_id is not null and not exists (
    select 1 from public.products p
     where p.id = new.product_id and p.company_id = new.company_id
  ) then
    raise exception 'Produto % não pertence à empresa da tarefa', new.product_id;
  end if;
  if new.product_edition_id is not null and not exists (
    select 1 from public.product_editions e
     where e.id = new.product_edition_id and e.product_id = new.product_id
  ) then
    raise exception 'Edição % não pertence ao produto da tarefa', new.product_edition_id;
  end if;
  return new;
end $$;

drop trigger if exists tasks_product_guard on public.tasks;
create trigger tasks_product_guard before insert or update on public.tasks
  for each row execute function app.assert_task_product();
