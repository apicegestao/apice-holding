// Painel da empresa: o retrato de hoje em uma tela.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, ClipboardList, Sparkles, Target } from 'lucide-react'
import { supabase } from '../../core/lib/supabase'
import { formatValue, isOnTarget, labelPeriod, relativeDays } from '../../core/lib/format'
import { useCompany } from '../../core/company/CompanyProvider'
import { Badge, Card, EmptyState, Loading, PageHeader } from '../../core/ui'
import {
  GOAL_STATUS_LABEL,
  TASK_PRIORITY_LABEL,
  type Goal,
  type Insight,
  type KpiLatestValue,
  type Task,
} from '../../core/types'

function StatTile({
  label,
  value,
  hint,
  tone = 'slate',
  icon: Icon,
}: {
  label: string
  value: string | number
  hint?: string
  tone?: 'slate' | 'green' | 'amber' | 'red'
  icon: typeof Target
}) {
  const tones: Record<string, string> = {
    slate: 'text-ink-900',
    green: 'text-emerald-600',
    amber: 'text-amber-600',
    red: 'text-rose-600',
  }
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
        <Icon className="h-4 w-4 text-slate-300" />
      </div>
      <p className={`mt-2 text-2xl font-semibold ${tones[tone]}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

export default function CompanyDashboard() {
  const { company, isAdmin } = useCompany()
  const [kpis, setKpis] = useState<KpiLatestValue[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [insights, setInsights] = useState<Insight[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [kpiResult, goalResult, taskResult, insightResult] = await Promise.all([
      supabase.from('kpi_latest_values').select('*').eq('company_id', company.id),
      supabase
        .from('goals')
        .select('*')
        .eq('company_id', company.id)
        .in('status', ['planned', 'active', 'at_risk'])
        .order('due_date', { ascending: true })
        .limit(6),
      supabase.from('tasks').select('*').eq('company_id', company.id),
      isAdmin
        ? supabase
            .from('insights')
            .select('*')
            .eq('company_id', company.id)
            .eq('is_archived', false)
            .order('generated_at', { ascending: false })
            .limit(3)
        : Promise.resolve({ data: [] as Insight[] }),
    ])

    setKpis((kpiResult.data as KpiLatestValue[]) ?? [])
    setGoals((goalResult.data as Goal[]) ?? [])
    setTasks((taskResult.data as Task[]) ?? [])
    setInsights((insightResult.data as Insight[]) ?? [])
    setLoading(false)
  }, [company.id, isAdmin])

  useEffect(() => {
    void load()
  }, [load])

  const stats = useMemo(() => {
    const open = tasks.filter((task) => ['todo', 'doing', 'blocked'].includes(task.status))
    const today = new Date().toISOString().slice(0, 10)
    const overdue = open.filter((task) => task.due_date && task.due_date < today)
    const onTarget = kpis.filter(
      (kpi) => isOnTarget(Number(kpi.value), kpi.target_value, kpi.direction) === true,
    )
    const offTarget = kpis.filter(
      (kpi) => isOnTarget(Number(kpi.value), kpi.target_value, kpi.direction) === false,
    )
    return { open, overdue, onTarget, offTarget }
  }, [tasks, kpis])

  const upcoming = useMemo(
    () =>
      stats.open
        .filter((task) => task.due_date)
        .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))
        .slice(0, 6),
    [stats.open],
  )

  if (loading) return <Loading />

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={company.name}
        subtitle={company.description || company.sector || 'Painel da empresa'}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="KPIs na meta"
          value={`${stats.onTarget.length}/${stats.onTarget.length + stats.offTarget.length}`}
          hint={`${kpis.length} indicadores com lançamento`}
          tone={stats.offTarget.length === 0 ? 'green' : 'slate'}
          icon={CheckCircle2}
        />
        <StatTile
          label="Metas em aberto"
          value={goals.length}
          hint={`${goals.filter((goal) => goal.status === 'at_risk').length} em risco`}
          tone={goals.some((goal) => goal.status === 'at_risk') ? 'amber' : 'slate'}
          icon={Target}
        />
        <StatTile
          label="Tarefas abertas"
          value={stats.open.length}
          hint={`${tasks.filter((task) => task.status === 'done').length} concluídas`}
          icon={ClipboardList}
        />
        <StatTile
          label="Tarefas vencidas"
          value={stats.overdue.length}
          tone={stats.overdue.length > 0 ? 'red' : 'green'}
          hint={stats.overdue.length ? 'precisam de atenção' : 'nada atrasado'}
          icon={AlertTriangle}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title="Indicadores"
          description="Último valor apurado de cada KPI."
          actions={
            <Link to={`/empresa/${company.id}/kpis`} className="text-xs text-brand-600 hover:underline">
              ver todos
            </Link>
          }
        >
          {kpis.length === 0 ? (
            <EmptyState
              title="Nenhum KPI lançado"
              description="Cadastre indicadores e registre o primeiro valor."
              action={
                <Link to={`/empresa/${company.id}/kpis`} className="btn-primary">
                  Ir para KPIs
                </Link>
              }
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {kpis.slice(0, 8).map((kpi) => {
                const status = isOnTarget(Number(kpi.value), kpi.target_value, kpi.direction)
                return (
                  <div key={kpi.kpi_id} className="rounded-lg border border-slate-200 p-3">
                    <p className="truncate text-xs font-medium uppercase tracking-wide text-slate-500">
                      {kpi.name}
                    </p>
                    <div className="mt-1 flex items-end justify-between gap-2">
                      <span className="text-xl font-semibold">
                        {formatValue(Number(kpi.value), kpi.unit)}
                      </span>
                      {status !== null && (
                        <Badge tone={status ? 'green' : 'red'}>
                          {status ? 'na meta' : 'fora'}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {labelPeriod(kpi.period_start, kpi.frequency)}
                      {kpi.target_value !== null && (
                        <> · meta {formatValue(kpi.target_value, kpi.unit)}</>
                      )}
                    </p>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card
            title="Próximos prazos"
            actions={
              <Link
                to={`/empresa/${company.id}/tarefas`}
                className="text-xs text-brand-600 hover:underline"
              >
                ver tarefas
              </Link>
            }
          >
            {upcoming.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhuma tarefa com prazo definido.</p>
            ) : (
              <ul className="space-y-2.5">
                {upcoming.map((task) => {
                  const late = task.due_date! < new Date().toISOString().slice(0, 10)
                  return (
                    <li key={task.id} className="flex items-start justify-between gap-2">
                      <span className="min-w-0 text-sm">
                        <span className="block truncate">{task.title}</span>
                        <span className="text-xs text-slate-400">
                          {TASK_PRIORITY_LABEL[task.priority]}
                        </span>
                      </span>
                      <Badge tone={late ? 'red' : 'slate'}>{relativeDays(task.due_date)}</Badge>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          <Card
            title="Metas"
            actions={
              <Link
                to={`/empresa/${company.id}/metas`}
                className="text-xs text-brand-600 hover:underline"
              >
                ver metas
              </Link>
            }
          >
            {goals.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhuma meta em aberto.</p>
            ) : (
              <ul className="space-y-3">
                {goals.map((goal) => {
                  const progress =
                    goal.target_value && Number(goal.target_value) !== 0
                      ? Math.min(100, Math.round((Number(goal.current_value) / Number(goal.target_value)) * 100))
                      : null
                  return (
                    <li key={goal.id}>
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate">{goal.title}</span>
                        <Badge tone={goal.status === 'at_risk' ? 'amber' : 'slate'}>
                          {GOAL_STATUS_LABEL[goal.status]}
                        </Badge>
                      </div>
                      {progress !== null && (
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-brand-500"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {isAdmin && insights.length > 0 && (
        <Card
          title="Insights recentes da IA"
          actions={
            <Link
              to={`/empresa/${company.id}/insights`}
              className="text-xs text-brand-600 hover:underline"
            >
              ver todos
            </Link>
          }
        >
          <ul className="space-y-3">
            {insights.map((insight) => (
              <li key={insight.id} className="flex gap-3">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                <div>
                  <p className="text-sm font-medium">{insight.title}</p>
                  <p className="text-sm text-slate-600">{insight.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
