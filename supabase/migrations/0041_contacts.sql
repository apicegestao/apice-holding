-- ============================================================================
-- CRM genérico de contatos — Fase 3 (segunda metade) do plano de virar um
-- sistema de gestão completo por empresa. Diferente de tudo que já existe
-- (indicador, tarefa, orçamento, financeiro — todos amarrados a uma métrica
-- ou um valor), contato é um registro livre: pessoa ou organização que a
-- empresa se relaciona (lead, cliente, fornecedor, parceiro...), com campos
-- customizáveis (jsonb) porque cada empresa/área acompanha coisas diferentes
-- de um contato — não dá pra prever um esquema fixo que sirva pra todas.
--
-- `contact_stages` é o pipeline (Kanban) — cada empresa define as próprias
-- etapas, mesmo padrão de `departments`/`products` (nada fixo pro grupo
-- inteiro). `contacts.stage_id` é obrigatório (todo contato está em algum
-- lugar do funil) — por isso `on delete restrict`, não `set null`: apagar
-- uma etapa que ainda tem contato é bloqueado (a pessoa move ou exclui os
-- contatos primeiro), pra nunca perder de vista onde um contato estava.
-- ============================================================================

create table if not exists public.contact_stages (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  name          text not null,
  color         text,
  display_order integer not null default 0,
  is_active     boolean not null default true,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, name)
);
create index if not exists contact_stages_company_idx on public.contact_stages (company_id) where is_active;

drop trigger if exists contact_stages_touch on public.contact_stages;
create trigger contact_stages_touch before update on public.contact_stages
  for each row execute function app.touch_updated_at();

create table if not exists public.contacts (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  stage_id      uuid not null references public.contact_stages (id) on delete restrict,
  name          text not null,
  organization  text,
  email         text,
  phone         text,
  owner_id      uuid references public.profiles (id) on delete set null,
  custom_fields jsonb not null default '{}'::jsonb,
  notes         text,
  display_order integer not null default 0,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists contacts_company_idx on public.contacts (company_id);
create index if not exists contacts_stage_idx on public.contacts (stage_id);

drop trigger if exists contacts_touch on public.contacts;
create trigger contacts_touch before update on public.contacts
  for each row execute function app.touch_updated_at();

-- Confere, na gravação, que a etapa é da mesma empresa do contato — mesmo
-- padrão de app.assert_kpi_department()/app.assert_kpi_product().
create or replace function app.assert_contact_stage()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (
    select 1 from public.contact_stages s
     where s.id = new.stage_id and s.company_id = new.company_id
  ) then
    raise exception 'Etapa % não pertence à empresa do contato', new.stage_id;
  end if;
  return new;
end $$;

drop trigger if exists contacts_stage_guard on public.contacts;
create trigger contacts_stage_guard before insert or update on public.contacts
  for each row execute function app.assert_contact_stage();

-- ---------------------------------------------------------------- RLS
alter table public.contact_stages enable row level security;
drop policy if exists contact_stages_select on public.contact_stages;
create policy contact_stages_select on public.contact_stages for select to authenticated
  using (app.is_member(company_id));
drop policy if exists contact_stages_write on public.contact_stages;
create policy contact_stages_write on public.contact_stages for all to authenticated
  using (app.can_write(company_id)) with check (app.can_write(company_id));

alter table public.contacts enable row level security;
drop policy if exists contacts_select on public.contacts;
create policy contacts_select on public.contacts for select to authenticated
  using (app.is_member(company_id));
drop policy if exists contacts_write on public.contacts;
create policy contacts_write on public.contacts for all to authenticated
  using (app.can_write(company_id)) with check (app.can_write(company_id));

-- ------------------------------------------------- pipeline padrão por empresa
-- Diferente de `departments` (seedado a partir de `kpis.category` já em
-- uso), contato é conceito novo — não tem dado real pra herdar. Cada
-- empresa já existente ganha um funil comercial genérico de largada (a
-- pessoa renomeia/adiciona/remove etapa livremente depois); sem isso o
-- Kanban nasceria vazio e travado (não dá pra criar contato sem etapa).
insert into public.contact_stages (company_id, name, display_order)
select c.id, stage.name, stage.ord
  from public.companies c
  cross join (values
    ('Novo lead', 0),
    ('Em contato', 1),
    ('Proposta enviada', 2),
    ('Fechado — ganho', 3),
    ('Fechado — perdido', 4)
  ) as stage(name, ord)
on conflict (company_id, name) do nothing;
