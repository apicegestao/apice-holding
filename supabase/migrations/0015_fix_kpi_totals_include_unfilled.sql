-- ============================================================================
-- kpis_total contava a partir de kpi_latest_values, entao um KPI ativo sem
-- nenhum lancamento nunca entrava no total nem aparecia como "sem lancamento"
-- em lugar nenhum -- sumia dos dois paineis, web e mobile igualmente.
-- kpis_total passa a contar direto de public.kpis (todo KPI ativo). A soma de
-- on_target + off_target pode ficar menor que o total: a diferenca e quantos
-- KPIs ainda nao tem lancamento.
-- ============================================================================
create or replace function public.company_snapshots()
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
  last_activity   timestamptz
)
language sql stable set search_path = public, pg_temp as $$
  select
    c.id,
    c.name,
    c.color,
    c.slug,
    c.is_holding,
    coalesce(k.total, 0),
    coalesce(k.on_target, 0),
    coalesce(k.off_target, 0),
    coalesce(g.active, 0),
    coalesce(g.at_risk, 0),
    coalesce(g.achieved, 0),
    coalesce(t.open, 0),
    coalesce(t.overdue, 0),
    coalesce(t.done_30d, 0),
    coalesce(m.total, 0),
    greatest(c.updated_at, coalesce(t.last_touch, c.updated_at))
  from public.companies c
  left join lateral (
    select count(*) as total
      from public.kpis kk
     where kk.company_id = c.id and kk.is_active
  ) k0 on true
  left join lateral (
    select k0.total,
           count(*) filter (
             where l.target_value is not null
               and ((l.direction = 'up' and l.value >= l.target_value)
                 or (l.direction = 'down' and l.value <= l.target_value))
           ) as on_target,
           count(*) filter (
             where l.target_value is not null
               and ((l.direction = 'up' and l.value < l.target_value)
                 or (l.direction = 'down' and l.value > l.target_value))
           ) as off_target
      from public.kpi_latest_values l
     where l.company_id = c.id
  ) k on true
  left join lateral (
    select count(*) filter (where gg.status in ('active', 'planned')) as active,
           count(*) filter (where gg.status = 'at_risk') as at_risk,
           count(*) filter (where gg.status = 'achieved') as achieved
      from public.goals gg
     where gg.company_id = c.id
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
  where c.is_active
  order by c.is_holding desc, c.display_order, c.name;
$$;

grant execute on function public.company_snapshots() to authenticated;
