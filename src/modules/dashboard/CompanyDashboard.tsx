// Painel da empresa: o retrato de hoje em uma tela.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, ClipboardList, Sparkles, Target } from 'lucide-react'
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
import { formatValue, isOnTarget, labelPeriod, relativeDays } from '../../core/lib/format'
import { useCompany } from '../../core/company/CompanyProvider'
import { useChartTheme } from '../../core/theme/ThemeProvider'
import { Badge, Card, EmptyState, Loading, PageHeader } from '../../core/ui'
import {
  GOAL_STATUS_LABEL,
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  type GoalStatus,
  type Insight,
  type Kpi,
  type KpiLatestValue,
  type Profile,
  type Task,
  type TaskStatus,
} from '../../core/types'

// Ordem fixa das colunas do gráfico de tarefas — mesma ordem do quadro kanban.
const TASK_STATUS_ORDER: TaskStatus[] = ['todo', 'doing', 'blocked', 'done', 'canceled']
const TASK_STATUS_COLOR: Record<TaskStatus, string> = {
  todo: '#94A3B8',
  doing: '#0EA5E9',
  blocked: '#F59E0B',
  done: '#10B981',
  canceled: '#CBD5E1',
}

/** Um KPI ativo, com o último valor lançado quando existir. Sem lançamento
 *  ainda é um KPI de verdade — ele não deve desaparecer do painel por isso.
 *  Quando tem due_date, é também a meta: mesma linha, sem cadastro duplicado. */
type KpiRow = {
  kpi_id: string
  name: string
  unit: Kpi['unit']
  direction: Kpi['direction']
  frequency: Kpi['frequency']
  target_value: number | null
  value: number | null
  period_start: string | null
  due_date: string | null
  owner_id: string | null
  status: GoalStatus
}

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
    slate: 'text-content',
    green: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
    red: 'text-rose-600 dark:text-rose-400',
  }
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-content-soft">{label}</span>
        <Icon className="h-4 w-4 text-content-faint" />
      </div>
      <p className={`mt-2 text-2xl font-semibold ${tones[tone]}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-content-soft">{hint}</p>}
    </div>
  )
}

export default function CompanyDashboard() {
  const { company, isAdmin } = useCompany()
  const chart = useChartTheme()
  const [kpiDefs, setKpiDefs] = useState<Kpi[]>([])
  const [kpiValues, setKpiValues] = useState<KpiLatestValue[]>([])
  const [people, setPeople] = useState<Profile[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [insights, setInsights] = useState<Insight[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [kpiDefResult, kpiValueResult, memberResult, taskResult, insightResult] = await Promise.all([
      supabase
        .from('kpis')
        .select('*')
        .eq('company_id', company.id)
        .eq('is_active', true)
        .order('display_order'),
      supabase.from('kpi_latest_values').select('*').eq('company_id', company.id),
      supabase.from('company_members').select('user_id').eq('company_id', company.id),
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

    const memberIds = (memberResult.data ?? []).map((row) => row.user_id)
    const { data: profileRows } = memberIds.length
      ? await supabase.from('profiles').select('*').in('id', memberIds)
      : { data: [] as Profile[] }

    setKpiDefs((kpiDefResult.data as Kpi[]) ?? [])
    setKpiValues((kpiValueResult.data as KpiLatestValue[]) ?? [])
    setPeople((profileRows as Profile[]) ?? [])
    setTasks((taskResult.data as Task[]) ?? [])
    setInsights((insightResult.data as Insight[]) ?? [])
    setLoading(false)
  }, [company.id, isAdmin])

  useEffect(() => {
    void load()
  }, [load])

  // Todo KPI ativo entra aqui — com lançamento ou não. É essa lista que fecha
  // o buraco de "cadastrei o indicador e ele nunca apareceu no painel".
  const kpiRows = useMemo<KpiRow[]>(
    () =>
      kpiDefs.map((def) => {
        const latest = kpiValues.find((v) => v.kpi_id === def.id)
        return {
          kpi_id: def.id,
          name: def.name,
          unit: def.unit,
          direction: def.direction,
          frequency: def.frequency,
          target_value: latest?.target_value ?? def.target_value,
          value: latest ? Number(latest.value) : null,
          period_start: latest?.period_start ?? null,
          due_date: def.due_date,
          owner_id: def.owner_id,
          status: def.status,
        }
      }),
    [kpiDefs, kpiValues],
  )

  // Um KPI com prazo é também uma meta — mesma linha, sem cadastro à parte.
  const metas = useMemo(
    () =>
      kpiRows
        .filter((row) => row.due_date !== null && !['achieved', 'missed'].includes(row.status))
        .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))
        .slice(0, 6),
    [kpiRows],
  )
  const ownerName = (id: string | null) =>
    id ? (people.find((person) => person.id === id)?.full_name ?? '—') : 'Sem responsável'

  const stats = useMemo(() => {
    const open = tasks.filter((task) => ['todo', 'doing', 'blocked'].includes(task.status))
    const today = new Date().toISOString().slice(0, 10)
    const overdue = open.filter((task) => task.due_date && task.due_date < today)
    const withValue = kpiRows.filter((row) => row.value !== null)
    const onTarget = withValue.filter(
      (row) => isOnTarget(row.value!, row.target_value, row.direction) === true,
    )
    const offTarget = withValue.filter(
      (row) => isOnTarget(row.value!, row.target_value, row.direction) === false,
    )
    const noValue = kpiRows.length - withValue.length
    return { open, overdue, onTarget, offTarget, noValue }
  }, [tasks, kpiRows])

  const upcoming = useMemo(
    () =>
      stats.open
        .filter((task) => task.due_date)
        .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))
        .slice(0, 6),
    [stats.open],
  )

  // Comparação entre indicadores desta empresa: % do alvo atingido. Unidades
  // diferentes (R$, %, dias) não podem virar barra na mesma escala — só o
  // atingimento é comparável entre KPIs distintos.
  //
  // Num KPI "up" (maior é melhor), atingimento = valor / meta. Num KPI "down"
  // (menor é melhor, ex. churn), a mesma conta inverteria o sentido — por isso
  // usamos meta / valor, que também sobe acima de 100% quando o resultado é
  // melhor que a meta. Limitamos a 300% só para o gráfico não esticar demais
  // quando o valor está próximo de zero.
  const kpiAttainment = useMemo(
    () =>
      kpiRows
        .filter((row) => row.value !== null && row.target_value !== null && row.target_value !== 0)
        .map((row) => {
          const ratio =
            row.direction === 'up'
              ? row.value! / row.target_value!
              : row.value! > 0
                ? row.target_value! / row.value!
                : 3
          return {
            nome: row.name,
            atingimento: Math.round(Math.min(ratio, 3) * 100),
            naMeta: isOnTarget(row.value!, row.target_value, row.direction) === true,
          }
        }),
    [kpiRows],
  )

  const tasksByStatus = useMemo(
    () =>
      TASK_STATUS_ORDER.map((status) => ({
        status,
        rotulo: TASK_STATUS_LABEL[status],
        quantidade: tasks.filter((task) => task.status === status).length,
      })),
    [tasks],
  )
  const hasTasks = tasks.length > 0

  if (loading) return <Loading />

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={company.name}
        subtitle={company.description || company.sector || 'Painel da empresa'}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="KPIs na meta"
          value={`${stats.onTarget.length}/${stats.onTarget.length + stats.offTarget.length}`}
          hint={
            stats.noValue > 0
              ? `${kpiRows.length} indicadores · ${stats.noValue} sem lançamento`
              : `${kpiRows.length} indicadores`
          }
          tone={stats.offTarget.length === 0 ? 'green' : 'slate'}
          icon={CheckCircle2}
        />
        <StatTile
          label="Metas em aberto"
          value={metas.length}
          hint={`${metas.filter((meta) => meta.status === 'at_risk').length} em risco`}
          tone={metas.some((meta) => meta.status === 'at_risk') ? 'amber' : 'slate'}
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title="Indicadores"
          description="Último valor apurado de cada KPI."
          actions={
            <Link to={`/empresa/${company.id}/kpis`} className="btn-ghost py-1.5 text-xs">
              Ver Todos
            </Link>
          }
        >
          {kpiRows.length === 0 ? (
            <EmptyState
              title="Nenhum KPI cadastrado"
              description="Cadastre indicadores e registre o primeiro valor."
              action={
                <Link to={`/empresa/${company.id}/kpis`} className="btn-primary">
                  Ir para KPIs
                </Link>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {kpiRows.slice(0, 8).map((kpi) => {
                const status =
                  kpi.value === null ? null : isOnTarget(kpi.value, kpi.target_value, kpi.direction)
                return (
                  <div key={kpi.kpi_id} className="rounded-lg border border-line p-3">
                    <p className="truncate text-xs font-medium uppercase tracking-wide text-content-soft">
                      {kpi.name}
                    </p>
                    <div className="mt-1 flex items-end justify-between gap-2">
                      <span
                        className={`text-xl font-semibold ${kpi.value === null ? 'text-content-faint' : ''}`}
                      >
                        {kpi.value === null ? '—' : formatValue(kpi.value, kpi.unit)}
                      </span>
                      {status !== null && (
                        <Badge tone={status ? 'green' : 'red'}>{status ? 'na meta' : 'fora'}</Badge>
                      )}
                      {kpi.value === null && <Badge tone="slate">sem lançamento</Badge>}
                    </div>
                    <p className="mt-0.5 text-[11px] text-content-faint">
                      {kpi.value === null
                        ? 'aguardando o primeiro valor'
                        : labelPeriod(kpi.period_start!, kpi.frequency)}
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
              <Link to={`/empresa/${company.id}/tarefas`} className="btn-ghost py-1.5 text-xs">
                Ver Tarefas
              </Link>
            }
          >
            {upcoming.length === 0 ? (
              <p className="text-sm text-content-soft">Nenhuma tarefa com prazo definido.</p>
            ) : (
              <ul className="space-y-2.5">
                {upcoming.map((task) => {
                  const late = task.due_date! < new Date().toISOString().slice(0, 10)
                  return (
                    <li key={task.id} className="flex items-start justify-between gap-2">
                      <span className="min-w-0 text-sm">
                        <span className="block truncate">{task.title}</span>
                        <span className="text-xs text-content-faint">
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
            description="KPIs com prazo — a meta é o próprio indicador."
            actions={
              <Link to={`/empresa/${company.id}/kpis`} className="btn-ghost py-1.5 text-xs">
                Ver KPIs
              </Link>
            }
          >
            {metas.length === 0 ? (
              <p className="text-sm text-content-soft">Nenhuma meta em aberto.</p>
            ) : (
              <ul className="space-y-3">
                {metas.map((meta) => {
                  const progress =
                    meta.target_value && meta.value !== null && Number(meta.target_value) !== 0
                      ? Math.min(100, Math.round((meta.value / Number(meta.target_value)) * 100))
                      : null
                  return (
                    <li key={meta.kpi_id}>
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate">{meta.name}</span>
                        <Badge tone={meta.status === 'at_risk' ? 'amber' : 'slate'}>
                          {GOAL_STATUS_LABEL[meta.status]}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-content-faint">
                        {ownerName(meta.owner_id)} · prazo {relativeDays(meta.due_date)}
                      </p>
                      {progress !== null && (
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-hover">
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

      {/* ------------------------------------------------- gráficos comparativos */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card
          title="KPIs: realizado x meta"
          description="Quanto cada indicador entregou frente ao próprio alvo. A linha marca os 100%."
        >
          {kpiAttainment.length === 0 ? (
            <EmptyState
              title="Nada para comparar ainda"
              description="Defina uma meta e lance ao menos um valor em algum KPI."
            />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={kpiAttainment} margin={{ top: 20, right: 8, bottom: 0, left: 0 }}>
                  <XAxis
                    dataKey="nome"
                    tick={{ fontSize: 11, fill: chart.tick }}
                    axisLine={{ stroke: chart.axis }}
                    tickLine={false}
                    interval={0}
                    angle={kpiAttainment.length > 4 ? -20 : 0}
                    textAnchor={kpiAttainment.length > 4 ? 'end' : 'middle'}
                    height={kpiAttainment.length > 4 ? 46 : 24}
                  />
                  <YAxis unit="%" tick={{ fontSize: 11, fill: chart.tick }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip
                    cursor={{ fill: 'rgb(148 163 184 / .14)' }}
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      background: chart.tooltipBg,
                      borderColor: chart.tooltipBorder,
                      color: chart.tooltipText,
                    }}
                    itemStyle={{ color: chart.tooltipText }}
                    labelStyle={{ color: chart.tooltipText }}
                    formatter={(value: number) => [`${value}% do alvo`, 'Realizado']}
                  />
                  <ReferenceLine y={100} stroke={chart.reference} strokeDasharray="4 4" />
                  <Bar dataKey="atingimento" radius={[4, 4, 0, 0]} maxBarSize={56}>
                    {kpiAttainment.map((row) => (
                      <Cell key={row.nome} fill={row.naMeta ? '#10B981' : '#F43F5E'} />
                    ))}
                    <LabelList
                      dataKey="atingimento"
                      position="top"
                      formatter={(value: number) => `${value}%`}
                      style={{ fontSize: 11, fill: chart.label }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card title="Tarefas por situação" description="Distribuição do quadro desta empresa.">
          {!hasTasks ? (
            <EmptyState title="Nenhuma tarefa ainda" description="Crie a primeira tarefa da empresa." />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tasksByStatus} margin={{ top: 20, right: 8, bottom: 0, left: 0 }}>
                  <XAxis
                    dataKey="rotulo"
                    tick={{ fontSize: 11, fill: chart.tick }}
                    axisLine={{ stroke: chart.axis }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: chart.tick }}
                    axisLine={false}
                    tickLine={false}
                    width={32}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgb(148 163 184 / .14)' }}
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      background: chart.tooltipBg,
                      borderColor: chart.tooltipBorder,
                      color: chart.tooltipText,
                    }}
                    itemStyle={{ color: chart.tooltipText }}
                    labelStyle={{ color: chart.tooltipText }}
                  />
                  <Bar dataKey="quantidade" radius={[4, 4, 0, 0]} maxBarSize={56}>
                    {tasksByStatus.map((row) => (
                      <Cell key={row.status} fill={TASK_STATUS_COLOR[row.status]} />
                    ))}
                    <LabelList dataKey="quantidade" position="top" style={{ fontSize: 11, fill: chart.label }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {isAdmin && insights.length > 0 && (
        <Card
          title="Insights recentes da IA"
          actions={
            <Link to={`/empresa/${company.id}/insights`} className="btn-ghost py-1.5 text-xs">
              Ver Todos
            </Link>
          }
        >
          <ul className="space-y-3">
            {insights.map((insight) => (
              <li key={insight.id} className="flex gap-3">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                <div>
                  <p className="text-sm font-medium">{insight.title}</p>
                  <p className="text-sm text-content-muted">{insight.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
