-- Corrige os dois achados reais do advisor de performance do Supabase
-- (mcp__Supabase__get_advisors, categoria "performance"), sem mudar
-- NENHUM comportamento de acesso — só a forma como o Postgres avalia
-- as políticas de RLS.
--
-- 1) auth_rls_initplan (16 políticas): toda política que chama
--    `auth.uid()` direto no próprio qual/with_check é reavaliada LINHA A
--    LINHA em vez de uma vez só por statement. Envolver a chamada como
--    `(select auth.uid())` faz o Postgres computar isso uma vez só (via
--    InitPlan) e reusar pra todas as linhas — mesmo resultado, muito
--    menos trabalho em tabela grande. As funções helper de app.* (is_member,
--    can_write, is_company_admin, etc.) não entram nessa lista — o advisor
--    só enxerga chamadas diretas de auth.uid() dentro do corpo da própria
--    política, não o que acontece dentro de uma função chamada por ela.
--
-- 2) multiple_permissive_policies (16 tabelas): todo par "<tabela>_select"
--    (FOR SELECT) + "<tabela>_write" (FOR ALL) faz o Postgres avaliar as
--    DUAS políticas permissivas em todo SELECT (precisa fazer OR entre
--    elas), mesmo can_write()/is_company_admin() sempre implicando
--    is_member() — conferido direto nas funções:
--      is_member(c)        = company_role(c) is not null
--      can_write(c)        = company_role(c) in ('admin','collaborator')
--      is_company_admin(c) = company_role(c) = 'admin'
--    ou seja, o "OR" da política _write nunca liberava nada que a
--    _select já não liberasse — pura reavaliação à toa. Cada "_write"
--    vira três políticas (_insert/_update/_delete, mesmo qual/with_check
--    de sempre) sem mais cobrir SELECT — quem manda em SELECT passa a ser
--    só a política _select, como já era na prática.
--
-- Verificado antes de aplicar: nenhuma tabela usa MERGE (PostgREST não
-- emite esse comando) e TRUNCATE não é coberto por RLS de qualquer jeito
-- — então trocar FOR ALL por FOR INSERT/UPDATE/DELETE não deixa nenhum
-- comando sem política.

-- ============================================================
-- 1) auth_rls_initplan — envolve auth.uid() em (select auth.uid())
-- ============================================================

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or app.is_super_admin() or app.shares_company(id));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists audit_logs_insert on public.audit_logs;
create policy audit_logs_insert on public.audit_logs for insert to authenticated
  with check (actor_id = (select auth.uid()) and (company_id is null or app.is_member(company_id)));

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists task_comments_delete on public.task_comments;
create policy task_comments_delete on public.task_comments for delete to authenticated
  using (author_id = (select auth.uid()) or app.is_company_admin(company_id));

drop policy if exists task_comments_insert on public.task_comments;
create policy task_comments_insert on public.task_comments for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (select 1 from public.tasks t where t.id = task_comments.task_id)
  );

drop policy if exists task_comments_update on public.task_comments;
create policy task_comments_update on public.task_comments for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (
    created_by = (select auth.uid())
    or assignee_id = (select auth.uid())
    or (visibility = 'company'::task_visibility and app.is_member(company_id))
    or (visibility = 'shared'::task_visibility and app.task_shared_with_me(id))
  );

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and app.is_member(company_id)
    and (visibility = 'private'::task_visibility or app.can_write(company_id))
  );

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (
    created_by = (select auth.uid())
    or (assignee_id = (select auth.uid()) and app.is_member(company_id))
    or (visibility <> 'private'::task_visibility and app.can_write(company_id))
  )
  with check (
    created_by = (select auth.uid())
    or (assignee_id = (select auth.uid()) and app.is_member(company_id))
    or (visibility <> 'private'::task_visibility and app.can_write(company_id))
  );

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
  using (
    created_by = (select auth.uid())
    or (visibility <> 'private'::task_visibility and app.can_write(company_id))
  );

drop policy if exists task_shares_select on public.task_shares;
create policy task_shares_select on public.task_shares for select to authenticated
  using (
    app.owns_task(task_id)
    or user_id = (select auth.uid())
    or (company_id is not null and app.is_member(company_id))
  );

drop policy if exists task_shares_insert on public.task_shares;
create policy task_shares_insert on public.task_shares for insert to authenticated
  with check (
    app.owns_task(task_id)
    and created_by = (select auth.uid())
    and (
      (company_id is not null and app.is_member(company_id))
      or (user_id is not null and (app.shares_company(user_id) or app.is_super_admin()))
    )
  );

-- notes_select entra na seção 2 abaixo, junto com notes_write (a mesma
-- tabela aparece nas duas listas do advisor).

-- ============================================================
-- 2) multiple_permissive_policies — "_write" (FOR ALL) vira
--    _insert/_update/_delete, deixando "_select" como única dona do SELECT
-- ============================================================

drop policy if exists budget_items_write on public.budget_items;
create policy budget_items_insert on public.budget_items for insert to authenticated with check (app.can_write(company_id));
create policy budget_items_update on public.budget_items for update to authenticated using (app.can_write(company_id)) with check (app.can_write(company_id));
create policy budget_items_delete on public.budget_items for delete to authenticated using (app.can_write(company_id));

drop policy if exists budgets_write on public.budgets;
create policy budgets_insert on public.budgets for insert to authenticated with check (app.can_write(company_id));
create policy budgets_update on public.budgets for update to authenticated using (app.can_write(company_id)) with check (app.can_write(company_id));
create policy budgets_delete on public.budgets for delete to authenticated using (app.can_write(company_id));

drop policy if exists contact_stages_write on public.contact_stages;
create policy contact_stages_insert on public.contact_stages for insert to authenticated with check (app.can_write(company_id));
create policy contact_stages_update on public.contact_stages for update to authenticated using (app.can_write(company_id)) with check (app.can_write(company_id));
create policy contact_stages_delete on public.contact_stages for delete to authenticated using (app.can_write(company_id));

drop policy if exists contacts_write on public.contacts;
create policy contacts_insert on public.contacts for insert to authenticated with check (app.can_write(company_id));
create policy contacts_update on public.contacts for update to authenticated using (app.can_write(company_id)) with check (app.can_write(company_id));
create policy contacts_delete on public.contacts for delete to authenticated using (app.can_write(company_id));

drop policy if exists departments_write on public.departments;
create policy departments_insert on public.departments for insert to authenticated with check (app.can_write(company_id));
create policy departments_update on public.departments for update to authenticated using (app.can_write(company_id)) with check (app.can_write(company_id));
create policy departments_delete on public.departments for delete to authenticated using (app.can_write(company_id));

drop policy if exists financial_entries_write on public.financial_entries;
create policy financial_entries_insert on public.financial_entries for insert to authenticated with check (app.can_write(company_id));
create policy financial_entries_update on public.financial_entries for update to authenticated using (app.can_write(company_id)) with check (app.can_write(company_id));
create policy financial_entries_delete on public.financial_entries for delete to authenticated using (app.can_write(company_id));

drop policy if exists kpi_checkpoints_write on public.kpi_checkpoints;
create policy kpi_checkpoints_insert on public.kpi_checkpoints for insert to authenticated with check (app.can_write(company_id));
create policy kpi_checkpoints_update on public.kpi_checkpoints for update to authenticated using (app.can_write(company_id)) with check (app.can_write(company_id));
create policy kpi_checkpoints_delete on public.kpi_checkpoints for delete to authenticated using (app.can_write(company_id));

drop policy if exists kpi_value_entries_write on public.kpi_value_entries;
create policy kpi_value_entries_insert on public.kpi_value_entries for insert to authenticated with check (app.can_write(company_id));
create policy kpi_value_entries_update on public.kpi_value_entries for update to authenticated using (app.can_write(company_id)) with check (app.can_write(company_id));
create policy kpi_value_entries_delete on public.kpi_value_entries for delete to authenticated using (app.can_write(company_id));

drop policy if exists kpi_values_write on public.kpi_values;
create policy kpi_values_insert on public.kpi_values for insert to authenticated with check (app.can_write(company_id));
create policy kpi_values_update on public.kpi_values for update to authenticated using (app.can_write(company_id)) with check (app.can_write(company_id));
create policy kpi_values_delete on public.kpi_values for delete to authenticated using (app.can_write(company_id));

drop policy if exists kpis_write on public.kpis;
create policy kpis_insert on public.kpis for insert to authenticated with check (app.can_write(company_id));
create policy kpis_update on public.kpis for update to authenticated using (app.can_write(company_id)) with check (app.can_write(company_id));
create policy kpis_delete on public.kpis for delete to authenticated using (app.can_write(company_id));

drop policy if exists metas_write on public.metas;
create policy metas_insert on public.metas for insert to authenticated with check (app.can_write(company_id));
create policy metas_update on public.metas for update to authenticated using (app.can_write(company_id)) with check (app.can_write(company_id));
create policy metas_delete on public.metas for delete to authenticated using (app.can_write(company_id));

drop policy if exists product_editions_write on public.product_editions;
create policy product_editions_insert on public.product_editions for insert to authenticated with check (app.can_write(company_id));
create policy product_editions_update on public.product_editions for update to authenticated using (app.can_write(company_id)) with check (app.can_write(company_id));
create policy product_editions_delete on public.product_editions for delete to authenticated using (app.can_write(company_id));

drop policy if exists products_write on public.products;
create policy products_insert on public.products for insert to authenticated with check (app.can_write(company_id));
create policy products_update on public.products for update to authenticated using (app.can_write(company_id)) with check (app.can_write(company_id));
create policy products_delete on public.products for delete to authenticated using (app.can_write(company_id));

-- Estas duas usam is_company_admin (mais restrito que can_write) — mesmo
-- padrão, qual/with_check idênticos ao que "_write" já tinha.
drop policy if exists integration_mappings_write on public.integration_mappings;
create policy integration_mappings_insert on public.integration_mappings for insert to authenticated with check (app.is_company_admin(company_id));
create policy integration_mappings_update on public.integration_mappings for update to authenticated using (app.is_company_admin(company_id)) with check (app.is_company_admin(company_id));
create policy integration_mappings_delete on public.integration_mappings for delete to authenticated using (app.is_company_admin(company_id));

drop policy if exists integrations_write on public.integrations;
create policy integrations_insert on public.integrations for insert to authenticated with check (app.is_company_admin(company_id));
create policy integrations_update on public.integrations for update to authenticated using (app.is_company_admin(company_id)) with check (app.is_company_admin(company_id));
create policy integrations_delete on public.integrations for delete to authenticated using (app.is_company_admin(company_id));

-- notes: entra nas duas listas do advisor (initplan + multiple permissive)
-- — resolve as duas de uma vez: _select some do overlap com _write, e
-- todo auth.uid() direto vira (select auth.uid()).
drop policy if exists notes_select on public.notes;
create policy notes_select on public.notes for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists notes_write on public.notes;
create policy notes_insert on public.notes for insert to authenticated
  with check (user_id = (select auth.uid()) and app.is_member(company_id));
create policy notes_update on public.notes for update to authenticated
  using (user_id = (select auth.uid()) and app.is_member(company_id))
  with check (user_id = (select auth.uid()) and app.is_member(company_id));
create policy notes_delete on public.notes for delete to authenticated
  using (user_id = (select auth.uid()) and app.is_member(company_id));
