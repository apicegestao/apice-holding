-- ============================================================================
-- Alvo passa a existir em todo nível de indicador (empresa, produto e
-- turma) — não só em indicador de empresa inteira como a rodada anterior
-- (0033) exigia. O usuário quer um cartão único por indicador (Faturamento,
-- Ticket Médio...) que cresce em cascata: empresa → produtos que contribuem
-- → turmas de cada produto — e cada nível pode ter seu próprio alvo (valor,
-- prazo, responsável, andamento).
--
-- A única coisa que impedia isso era o gatilho abaixo, instalado em 0033.
-- Removendo-o, nada mais no banco precisa mudar: `metas_company_guard`,
-- `metas_touch`, `metas_notify_ownership`, `kpi_checkpoints_company_guard`
-- e as views `meta_latest_values`/`kpi_latest_values` já são agnósticas de
-- nível (conferido lendo 0032_metas.sql por completo).
-- ============================================================================

drop trigger if exists metas_company_level_guard on public.metas;
drop function if exists app.assert_meta_kpi_company_level();

-- ----------------------------------------------------------------------------
-- company_snapshots(): os cartões-resumo do topo do painel (empresa e
-- holding) devem continuar contando só alvo de empresa inteira — um alvo de
-- turma pequena não pode se misturar com um alvo de empresa no mesmo
-- número. Mesma assinatura e mesmo corpo de 0032_metas.sql, só a subquery
-- lateral que soma goals_active/at_risk/achieved/kpis_on_target/off_target
-- ganha "and mv.product_id is null". kpis_total continua contando todo
-- indicador ativo de qualquer nível, sem mudança — é a contagem de
-- indicadores cadastrados, não de alvos.
-- ----------------------------------------------------------------------------
drop function if exists public.company_snapshots();
create function public.company_snapshots()
returns table (
  company_id      uuid,
  company_name    text,
  company_color   text,
  company_slug    text,
  is_holding      boolean,
  kpis_total      bigint,
  kpis_on_target  bigint,
  kpis_off_target bigint,
  goals_active    bigint,
  goals_at_risk   bigint,
  goals_achieved  bigint,
  tasks_open      bigint,
  tasks_overdue   bigint,
  tasks_done_30d  bigint,
  members_total   bigint,
  products_active bigint,
  last_activity   timestamptz
)
language sql stable set search_path = public, pg_temp as $$
  select
    c.id,
    c.name,
    c.color,
    c.slug,
    c.is_holding,
    coalesce(k0.total, 0),
    coalesce(g.on_target, 0),
    coalesce(g.off_target, 0),
    coalesce(g.active, 0),
    coalesce(g.at_risk, 0),
    coalesce(g.achieved, 0),
    coalesce(t.open, 0),
    coalesce(t.overdue, 0),
    coalesce(t.done_30d, 0),
    coalesce(m.total, 0),
    coalesce(pr.total, 0),
    greatest(c.updated_at, coalesce(t.last_touch, c.updated_at))
  from public.companies c
  left join lateral (
    select count(*) as total
      from public.kpis kk
     where kk.company_id = c.id and kk.is_active
  ) k0 on true
  left join lateral (
    select count(*) filter (where mv.status in ('active', 'planned')) as active,
           count(*) filter (where mv.status = 'at_risk') as at_risk,
           count(*) filter (where mv.status = 'achieved') as achieved,
           count(*) filter (
             where mv.target_value is not null
               and ((mv.direction = 'up' and mv.value >= mv.target_value)
                 or (mv.direction = 'down' and mv.value <= mv.target_value))
           ) as on_target,
           count(*) filter (
             where mv.target_value is not null
               and ((mv.direction = 'up' and mv.value < mv.target_value)
                 or (mv.direction = 'down' and mv.value > mv.target_value))
           ) as off_target
      from public.meta_latest_values mv
     where mv.company_id = c.id and mv.archived_at is null
       and mv.product_id is null
  ) g on true
  left join lateral (
    select count(*) filter (where tt.status in ('todo', 'doing', 'blocked')) as open,
           count(*) filter (
             where tt.status in ('todo', 'doing', 'blocked')
               and tt.due_date is not null
               and tt.due_date < current_date
           ) as overdue,
           count(*) filter (
             where tt.status = 'done' and tt.completed_at > now() - interval '30 days'
           ) as done_30d,
           max(tt.updated_at) as last_touch
      from public.tasks tt
     where tt.company_id = c.id
  ) t on true
  left join lateral (
    select count(*) as total from public.company_members mm where mm.company_id = c.id
  ) m on true
  left join lateral (
    select count(*) as total from public.products pp
     where pp.company_id = c.id and pp.is_active
  ) pr on true
  where c.is_active
  order by c.is_holding desc, c.display_order, c.name;
$$;

grant execute on function public.company_snapshots() to authenticated;
