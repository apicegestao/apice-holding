// Painel consolidado da holding: todas as empresas lado a lado, o atingimento
// das metas e as tarefas do usuário reunidas num lugar só.
// A RLS continua valendo — só entra o que a pessoa já poderia ver.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  ClipboardList,
  Lock,
  Plus,
  Share2,
  Sparkles,
  Target,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { supabase } from '../../core/lib/supabase'
import { formatValue, isOnTarget, relativeDays } from '../../core/lib/format'
import { useAuth } from '../../core/auth/AuthProvider'
import { Badge, Card, EmptyState, Loading, PageHeader } from '../../core/ui'
import TaskFormModal from '../tasks/TaskFormModal'
import {
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  type CompanySnapshot,
  type Goal,
  type Insight,
  type KpiLatestValue,
  type Task,
  type TaskStatus,
} from '../../core/types'

const OPEN_STATUSES: TaskStatus[] = ['todo', 'doing', 'blocked']

export default function HoldingDashboard() {
  const { profile, memberships } = useAuth()
  const [snapshots, setSnapshots] = useState<CompanySnapshot[]>([])
  const [kpis, setKpis] = useState<KpiLatestValue[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [insights, setInsights] = useState<Insight[]>([])
  const [loading, setLoading] = useState(true)
  const [creatingTask, setCreatingTask] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [snapshotResult, kpiResult, goalResult, taskResult, insightResult] = await Promise.all([
      supabase.rpc('company_snapshots'),
      supabase.from('kpi_latest_values').select('*'),
      supabase.from('goals').select('*'),
      // A RLS já entrega só o que enxergo; aqui reduzo ao que é meu.
      supabase
        .from('tasks')
        .select('*')
        .or(`assignee_id.eq.${profile?.id},created_by.eq.${profile?.id}`)
        .order('due_date', { ascending: true, nullsFirst: false }),
      supabase
        .from('insights')
        .select('*')
        .eq('scope', 'holding')
        .eq('is_archived', false)
        .order('generated_at', { ascending: false })
        .limit(4),
    ])

    setSnapshots((snapshotResult.data as CompanySnapshot[]) ?? [])
    setKpis((kpiResult.data as KpiLatestValue[]) ?? [])
    setGoals((goalResult.data as Goal[]) ?? [])
    setTasks((taskResult.data as Task[]) ?? [])
    setInsights((insightResult.data as Insight[]) ?? [])
    setLoading(false)
  }, [profile?.id])

  useEffect(() => {
    void load()
  }, [load])

  const operating = useMemo(() => snapshots.filter((item) => !item.is_holding), [snapshots])

  const companyName = useCallback(
    (id: string) =>
      memberships.find((item) => item.company.id === id)?.company.name ?? 'Empresa',
    [memberships],
  )
  const companyColor = useCallback(
    (id: string) => memberships.find((item) => item.company.id === id)?.company.color ?? '#94A3B8',
    [memberships],
  )

  const totals = useMemo(
    () =>
      operating.reduce(
        (acc, item) => ({
          kpisOnTarget: acc.kpisOnTarget + Number(item.kpis_on_target),
          kpisOffTarget: acc.kpisOffTarget + Number(item.kpis_off_target),
          goalsAtRisk: acc.goalsAtRisk + Number(item.goals_at_risk),
          goalsActive: acc.goalsActive + Number(item.goals_active),
          tasksOverdue: acc.tasksOverdue + Number(item.tasks_overdue),
        }),
        { kpisOnTarget: 0, kpisOffTarget: 0, goalsAtRisk: 0, goalsActive: 0, tasksOverdue: 0 },
      ),
    [operating],
  )

  // ------------------------------------------------- metas x realizado
  // Metas de empresas diferentes usam unidades diferentes, então somar reais
  // com percentuais não diria nada. O que compara é o atingimento: quanto do
  // alvo já foi entregue, com a linha de 100% como referência.
  const attainment = useMemo(
    () =>
      operating
        .map((company) => {
          const list = goals.filter(
            (goal) =>
              goal.company_id === company.company_id &&
              goal.target_value !== null &&
              Number(goal.target_value) !== 0 &&
              !['missed'].includes(goal.status),
          )
          if (!list.length) return null

          const percentages = list.map((goal) =>
            Math.max(0, (Number(goal.current_value) / Number(goal.target_value)) * 100),
          )
          const media = percentages.reduce((sum, value) => sum + value, 0) / percentages.length

          return {
            empresa: company.company_name,
            cor: company.company_color,
            atingimento: Math.round(media),
            metas: list.length,
            noAlvo: percentages.filter((value) => value >= 100).length,
          }
        })
        .filter((row): row is NonNullable<typeof row> => row !== null),
    [operating, goals],
  )

  const myTasks = useMemo(
    () => tasks.filter((task) => OPEN_STATUSES.includes(task.status)),
    [tasks],
  )
  const today = new Date().toISOString().slice(0, 10)
  const myOverdue = myTasks.filter((task) => task.due_date && task.due_date < today)

  if (loading) return <Loading />

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Painel da holding"
        subtitle="Todas as empresas do grupo em um lugar só."
        actions={
          <button type="button" className="btn-primary" onClick={() => setCreatingTask(true)}>
            <Plus className="h-4 w-4" /> Nova tarefa
          </button>
        }
      />

      {operating.length === 0 ? (
        <EmptyState
          title="Nenhuma empresa cadastrada"
          description="Cadastre as empresas controladas para começar a consolidar os números."
          action={
            <Link to="/holding/empresas" className="btn-primary">
              <Building2 className="h-4 w-4" /> Cadastrar empresa
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Empresas</p>
              <p className="mt-2 text-2xl font-semibold">{operating.length}</p>
              <p className="text-xs text-slate-500">no grupo</p>
            </div>
            <div className="card p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                KPIs na meta
              </p>
              <p className="mt-2 text-2xl font-semibold text-emerald-600">
                {totals.kpisOnTarget}
                <span className="text-base font-normal text-slate-400">
                  /{totals.kpisOnTarget + totals.kpisOffTarget}
                </span>
              </p>
              <p className="text-xs text-slate-500">indicadores com meta definida</p>
            </div>
            <div className="card p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Metas em risco
              </p>
              <p
                className={`mt-2 text-2xl font-semibold ${
                  totals.goalsAtRisk ? 'text-amber-600' : 'text-ink-900'
                }`}
              >
                {totals.goalsAtRisk}
              </p>
              <p className="text-xs text-slate-500">de {totals.goalsActive} em andamento</p>
            </div>
            <div className="card p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Minhas tarefas vencidas
              </p>
              <p
                className={`mt-2 text-2xl font-semibold ${
                  myOverdue.length ? 'text-rose-600' : 'text-emerald-600'
                }`}
              >
                {myOverdue.length}
              </p>
              <p className="text-xs text-slate-500">de {myTasks.length} em aberto</p>
            </div>
          </div>

          {/* ------------------------------------------- metas x realizado */}
          <Card
            title="Metas x realizado"
            description="Quanto do alvo já foi entregue, na média das metas de cada empresa. A linha marca os 100%."
          >
            {attainment.length === 0 ? (
              <EmptyState
                title="Nenhuma meta com alvo definido"
                description="Cadastre metas com valor-alvo para acompanhar o atingimento por aqui."
              />
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={attainment}
                    margin={{ top: 20, right: 8, bottom: 0, left: 0 }}
                    barCategoryGap="35%"
                  >
                    <XAxis
                      dataKey="empresa"
                      tick={{ fontSize: 11, fill: '#64748B' }}
                      axisLine={{ stroke: '#E2E8F0' }}
                      tickLine={false}
                    />
                    <YAxis
                      unit="%"
                      tick={{ fontSize: 11, fill: '#94A3B8' }}
                      axisLine={false}
                      tickLine={false}
                      width={46}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(148,163,184,.12)' }}
                      contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#E2E8F0' }}
                      formatter={(value: number) => [`${value}% do alvo`, 'Realizado']}
                      labelFormatter={(label: string) => {
                        const row = attainment.find((item) => item.empresa === label)
                        return row ? `${label} — ${row.noAlvo}/${row.metas} meta(s) no alvo` : label
                      }}
                    />
                    <ReferenceLine
                      y={100}
                      stroke="#94A3B8"
                      strokeDasharray="4 4"
                      label={{ value: 'meta', position: 'right', fontSize: 10, fill: '#94A3B8' }}
                    />
                    <Bar dataKey="atingimento" radius={[4, 4, 0, 0]} maxBarSize={64}>
                      {attainment.map((row) => (
                        <Cell key={row.empresa} fill={row.cor} />
                      ))}
                      <LabelList
                        dataKey="atingimento"
                        position="top"
                        formatter={(value: number) => `${value}%`}
                        style={{ fontSize: 11, fill: '#475569' }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* ------------------------------------------ tarefas unificadas */}
          <Card
            title="Minhas tarefas"
            description="Tudo que é meu, em todas as empresas — inclusive o que é só meu."
            actions={
              <button
                type="button"
                className="text-xs text-brand-600 hover:underline"
                onClick={() => setCreatingTask(true)}
              >
                nova tarefa
              </button>
            }
          >
            {myTasks.length === 0 ? (
              <EmptyState
                title="Nada em aberto"
                description="Nenhuma tarefa sua pendente em nenhuma empresa do grupo."
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {myTasks.slice(0, 12).map((task) => {
                  const late = task.due_date && task.due_date < today
                  return (
                    <li key={task.id} className="flex flex-wrap items-center gap-2 py-2.5">
                      <span
                        className="h-6 w-1 shrink-0 rounded-full"
                        style={{ backgroundColor: companyColor(task.company_id) }}
                        title={companyName(task.company_id)}
                      />
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => setEditingTask(task)}
                      >
                        <span className="block truncate text-sm font-medium text-ink-900">
                          {task.title}
                        </span>
                        <span className="text-xs text-slate-500">
                          {companyName(task.company_id)} · {TASK_STATUS_LABEL[task.status]} ·{' '}
                          {TASK_PRIORITY_LABEL[task.priority]}
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {task.visibility === 'private' && (
                          <Badge tone="slate">
                            <Lock className="h-3 w-3" /> só minha
                          </Badge>
                        )}
                        {task.visibility === 'shared' && (
                          <Badge tone="violet">
                            <Share2 className="h-3 w-3" /> compartilhada
                          </Badge>
                        )}
                        {task.due_date && (
                          <Badge tone={late ? 'red' : 'slate'}>
                            <CalendarClock className="h-3 w-3" /> {relativeDays(task.due_date)}
                          </Badge>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          {/* -------------------------------------------- cartão por empresa */}
          <div className="grid gap-4 md:grid-cols-2">
            {operating.map((snapshot) => {
              const companyKpis = kpis.filter((kpi) => kpi.company_id === snapshot.company_id)
              return (
                <Card key={snapshot.company_id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="h-9 w-1.5 rounded-full"
                        style={{ backgroundColor: snapshot.company_color }}
                      />
                      <div>
                        <Link
                          to={`/empresa/${snapshot.company_id}`}
                          className="text-sm font-semibold text-ink-900 hover:text-brand-600"
                        >
                          {snapshot.company_name}
                        </Link>
                        <p className="text-xs text-slate-500">
                          {snapshot.members_total} pessoa(s) com acesso
                        </p>
                      </div>
                    </div>
                    {Number(snapshot.tasks_overdue) > 0 && (
                      <Badge tone="red">
                        <AlertTriangle className="h-3 w-3" /> {snapshot.tasks_overdue} vencida(s)
                      </Badge>
                    )}
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-lg bg-slate-50 py-2">
                      <p className="text-lg font-semibold">
                        {snapshot.kpis_on_target}
                        <span className="text-xs font-normal text-slate-400">
                          /{Number(snapshot.kpis_on_target) + Number(snapshot.kpis_off_target)}
                        </span>
                      </p>
                      <p className="text-[11px] text-slate-500">KPIs na meta</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 py-2">
                      <p className="text-lg font-semibold">{snapshot.goals_active}</p>
                      <p className="text-[11px] text-slate-500">metas ativas</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 py-2">
                      <p className="text-lg font-semibold">{snapshot.tasks_open}</p>
                      <p className="text-[11px] text-slate-500">tarefas abertas</p>
                    </div>
                  </div>

                  {companyKpis.length > 0 && (
                    <ul className="mt-4 space-y-1.5">
                      {companyKpis.slice(0, 4).map((kpi) => {
                        const status = isOnTarget(Number(kpi.value), kpi.target_value, kpi.direction)
                        return (
                          <li
                            key={kpi.kpi_id}
                            className="flex items-center justify-between gap-2 text-sm"
                          >
                            <span className="min-w-0 truncate text-slate-600">{kpi.name}</span>
                            <span
                              className={`shrink-0 font-medium ${
                                status === false ? 'text-rose-600' : 'text-ink-900'
                              }`}
                            >
                              {formatValue(Number(kpi.value), kpi.unit)}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  <div className="mt-4 flex gap-2">
                    <Link to={`/empresa/${snapshot.company_id}`} className="btn-ghost py-1.5 text-xs">
                      <Target className="h-3.5 w-3.5" /> Painel
                    </Link>
                    <Link
                      to={`/empresa/${snapshot.company_id}/tarefas`}
                      className="btn-ghost py-1.5 text-xs"
                    >
                      <ClipboardList className="h-3.5 w-3.5" /> Tarefas
                    </Link>
                  </div>
                </Card>
              )
            })}
          </div>

          {insights.length > 0 && (
            <Card
              title="Insights da holding"
              actions={
                <Link to="/holding/insights" className="text-xs text-brand-600 hover:underline">
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
        </>
      )}

      <TaskFormModal
        open={creatingTask || Boolean(editingTask)}
        task={editingTask}
        onClose={() => {
          setCreatingTask(false)
          setEditingTask(null)
        }}
        onSaved={load}
      />
    </div>
  )
}
