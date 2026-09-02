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
  Layers,
  Lock,
  Network,
  Plus,
  Share2,
  Sparkles,
  Square,
  Target,
  Wallet,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  Legend,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { supabase } from '../../core/lib/supabase'
import {
  attainmentRatio,
  formatDate,
  formatValue,
  isOnTarget,
  relativeDays,
} from '../../core/lib/format'
import { useAuth } from '../../core/auth/AuthProvider'
import { useChartTheme } from '../../core/theme/ThemeProvider'
import {
  Badge,
  Card,
  CardCarousel,
  EmptyState,
  Loading,
  PageHeader,
  ProgressBar,
  useToast,
} from '../../core/ui'
import TaskFormModal from '../tasks/TaskFormModal'
import {
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  type CompanySnapshot,
  type Insight,
  type KpiLatestValue,
  type Task,
  type TaskStatus,
} from '../../core/types'

const OPEN_STATUSES: TaskStatus[] = ['todo', 'doing', 'blocked']

// Ponto colorido do gráfico "Metas x realizado" — mesma cor da empresa que
// já aparece em todo canto do sistema (aba, tarja do card…), só que agora
// ligados por uma linha em vez de barras separadas.
function attainmentDot(props: any) {
  const { cx, cy, payload, index } = props
  return <circle key={`dot-${index}`} cx={cx} cy={cy} r={5} fill={payload.cor} stroke="#fff" strokeWidth={1.5} />
}

export default function HoldingDashboard() {
  const { profile, memberships } = useAuth()
  const { notify } = useToast()
  const chart = useChartTheme()
  const [snapshots, setSnapshots] = useState<CompanySnapshot[]>([])
  const [kpis, setKpis] = useState<KpiLatestValue[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [insights, setInsights] = useState<Insight[]>([])
  const [loading, setLoading] = useState(true)
  const [creatingTask, setCreatingTask] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [snapshotResult, kpiResult, taskResult, insightResult] = await Promise.all([
      supabase.rpc('company_snapshots'),
      supabase.from('kpi_latest_values').select('*').is('archived_at', null),
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
    setTasks((taskResult.data as Task[]) ?? [])
    setInsights((insightResult.data as Insight[]) ?? [])
    setLoading(false)
  }, [profile?.id])

  useEffect(() => {
    void load()
  }, [load])

  // Concluir sem sair do painel — abrir a tarefa só pra marcar "feito" era
  // uma volta desnecessária pra ação mais comum do dia a dia.
  const markTaskDone = async (task: Task) => {
    const { error } = await supabase.from('tasks').update({ status: 'done' }).eq('id', task.id)
    if (error) {
      notify(error.message, 'error')
      return
    }
    await load()
  }

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
  // Um KPI com prazo é a meta. Metas de empresas diferentes usam unidades
  // diferentes, então somar reais com percentuais não diria nada — o que
  // compara é o atingimento, com a linha de 100% como referência. Direção
  // "menor é melhor" inverte a razão pro mesmo sentido de "acima é melhor".
  const attainment = useMemo(
    () =>
      operating
        .map((company) => {
          const list = kpis.filter(
            (kpi) =>
              kpi.company_id === company.company_id &&
              kpi.due_date !== null &&
              kpi.target_value !== null &&
              Number(kpi.target_value) !== 0 &&
              kpi.status !== 'missed',
          )
          if (!list.length) return null

          const percentages = list.map((kpi) => {
            const ratio =
              kpi.direction === 'up'
                ? Number(kpi.value) / Number(kpi.target_value)
                : Number(kpi.value) > 0
                  ? Number(kpi.target_value) / Number(kpi.value)
                  : 3
            return Math.max(0, Math.min(ratio, 3) * 100)
          })
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
    [operating, kpis],
  )

  // ------------------------------------------------- KPIs na meta por empresa
  // Comparação entre empresas, mas por SAÚDE do indicador (na meta / fora /
  // sem lançamento ainda), não pelo valor bruto — que nem faria sentido
  // somar entre empresas com KPIs de unidades diferentes.
  const kpiHealth = useMemo(
    () =>
      operating
        .map((company) => {
          const total = Number(company.kpis_total)
          if (total === 0) return null
          const naMeta = Number(company.kpis_on_target)
          const fora = Number(company.kpis_off_target)
          return {
            empresa: company.company_name,
            naMeta,
            fora,
            semLancamento: Math.max(0, total - naMeta - fora),
            total,
          }
        })
        .filter((row): row is NonNullable<typeof row> => row !== null),
    [operating],
  )

  // ------------------------------------------------- saúde geral por empresa
  // Uma única barra por empresa, pra bater o olho e já saber como ela anda —
  // média do atingimento de TODO KPI com meta (não só os com prazo, como o
  // gráfico "Metas x realizado" acima, que é sobre metas, não sobre saúde
  // geral do indicador do dia a dia).
  const companyHealth = useMemo(() => {
    const map = new Map<string, number | null>()
    for (const company of operating) {
      const ratios = kpis
        .filter(
          (kpi) =>
            kpi.company_id === company.company_id && kpi.target_value !== null && Number(kpi.target_value) !== 0,
        )
        .map((kpi) => attainmentRatio(Number(kpi.value), kpi.target_value, kpi.direction))
        .filter((ratio): ratio is number => ratio !== null)
      map.set(company.company_id, ratios.length ? ratios.reduce((sum, r) => sum + r, 0) / ratios.length : null)
    }
    return map
  }, [operating, kpis])

  // Vencida pesa mais que em risco, que pesa mais que só fora da meta — é a
  // ordem em que um dono do grupo ia querer olhar as empresas primeiro.
  const urgencyScore = (s: CompanySnapshot) =>
    Number(s.tasks_overdue) * 3 + Number(s.goals_at_risk) * 2 + Number(s.kpis_off_target)

  const companyStatus = (s: CompanySnapshot): 'red' | 'amber' | 'green' => {
    if (Number(s.tasks_overdue) > 0 || Number(s.goals_at_risk) > 0) return 'red'
    if (Number(s.kpis_off_target) > 0) return 'amber'
    return 'green'
  }

  const STATUS_DOT: Record<'red' | 'amber' | 'green', string> = {
    red: 'bg-rose-500',
    amber: 'bg-amber-500',
    green: 'bg-emerald-500',
  }

  // Quem precisa de atenção aparece primeiro — com várias empresas no grupo,
  // não dá pra depender de rolar a tela toda até achar o problema.
  const byUrgency = useMemo(
    () => [...operating].sort((a, b) => urgencyScore(b) - urgencyScore(a)),
    [operating],
  )

  // Saúde do grupo inteiro — a mesma conta da saúde por empresa, só que
  // média entre TODO KPI com meta de TODA empresa operacional.
  const groupHealth = useMemo(() => {
    const ratios = kpis
      .filter((kpi) => kpi.target_value !== null && Number(kpi.target_value) !== 0)
      .map((kpi) => attainmentRatio(Number(kpi.value), kpi.target_value, kpi.direction))
      .filter((ratio): ratio is number => ratio !== null)
    return {
      ratio: ratios.length ? ratios.reduce((sum, r) => sum + r, 0) / ratios.length : null,
      medidos: ratios.length,
    }
  }, [kpis])

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
        title="Painel da Holding"
        subtitle="Todas as empresas do grupo em um lugar só."
        actions={
          <>
            <Link to="/holding/mapa-mental" className="btn-ghost py-1.5 text-xs">
              <Network className="h-3.5 w-3.5" /> Mapa mental
            </Link>
            <Link to="/holding/orcamentos" className="btn-ghost py-1.5 text-xs">
              <Wallet className="h-3.5 w-3.5" /> Orçamentos
            </Link>
            <button type="button" className="btn-primary" onClick={() => setCreatingTask(true)}>
              <Plus className="h-4 w-4" /> Nova tarefa
            </button>
          </>
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
          {groupHealth.ratio !== null && (
            <div className="card p-4">
              <ProgressBar
                ratio={groupHealth.ratio}
                label="Saúde geral do grupo"
                caption={`média de atingimento em ${groupHealth.medidos} indicador(es) com meta definida, em todas as empresas`}
              />
            </div>
          )}

          {/* Cartões de resumo — no celular viram carrossel (arrasta com o
              dedo ou espera passar sozinho) pra caber tudo no topo sem
              ocupar a tela toda; do tablet pra cima é grid de sempre. Os
              cartões são montados uma vez só e reaproveitados nos dois. */}
          {(() => {
            const cards = [
              <div key="empresas" className="card p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-content-soft">Empresas</p>
                <p className="mt-2 text-2xl font-semibold">{operating.length}</p>
                <p className="text-xs text-content-soft">no grupo</p>
              </div>,
              <div key="kpis" className="card p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-content-soft">
                  KPIs na meta
                </p>
                <p className="mt-2 text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
                  {totals.kpisOnTarget}
                  <span className="text-base font-normal text-content-faint">
                    /{totals.kpisOnTarget + totals.kpisOffTarget}
                  </span>
                </p>
                <p className="text-xs text-content-soft">indicadores com meta definida</p>
              </div>,
              <div key="metas" className="card p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-content-soft">
                  Metas em risco
                </p>
                <p
                  className={`mt-2 text-2xl font-semibold ${
                    totals.goalsAtRisk ? 'text-amber-600 dark:text-amber-400' : 'text-content'
                  }`}
                >
                  {totals.goalsAtRisk}
                </p>
                <p className="text-xs text-content-soft">de {totals.goalsActive} em andamento</p>
              </div>,
              <div key="vencidas" className="card p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-content-soft">
                  Minhas tarefas vencidas
                </p>
                <p
                  className={`mt-2 text-2xl font-semibold ${
                    myOverdue.length ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {myOverdue.length}
                </p>
                <p className="text-xs text-content-soft">de {myTasks.length} em aberto</p>
              </div>,
              <div key="minhas" className="card p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-content-soft">
                  Minhas tarefas
                </p>
                <p className="mt-2 text-2xl font-semibold">{myTasks.length}</p>
                <p className="text-xs text-content-soft">em aberto, em todas as empresas</p>
              </div>,
            ]
            return (
              <>
                <div className="sm:hidden">
                  <CardCarousel items={cards} />
                </div>
                <div className="hidden gap-4 sm:grid sm:grid-cols-2 lg:grid-cols-5">{cards}</div>
              </>
            )
          })()}

          {/* ------------------------------------------ tarefas unificadas —
              logo depois dos cartões-resumo, é a segunda coisa da página */}
          <Card
            title="Minhas tarefas"
            description="Tudo que é meu, em todas as empresas — inclusive o que é só meu."
            actions={
              <button
                type="button"
                className="btn-primary p-1.5"
                onClick={() => setCreatingTask(true)}
                aria-label="Nova tarefa"
                title="Nova tarefa"
              >
                <Plus className="h-4 w-4" />
              </button>
            }
          >
            {myTasks.length === 0 ? (
              <EmptyState
                title="Nada em aberto"
                description="Nenhuma tarefa sua pendente em nenhuma empresa do grupo."
              />
            ) : (
              <ul className="divide-y divide-line">
                {myTasks.slice(0, 12).map((task) => {
                  const late = task.due_date && task.due_date < today
                  return (
                    <li key={task.id} className="flex flex-wrap items-center gap-2 py-2.5">
                      <button
                        type="button"
                        className="shrink-0 text-content-faint hover:text-emerald-600 dark:hover:text-emerald-400"
                        onClick={() => void markTaskDone(task)}
                        aria-label="Marcar como concluída"
                        title="Marcar como concluída"
                      >
                        <Square className="h-4 w-4" />
                      </button>
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
                        <span className="block truncate text-sm font-medium text-content">
                          {task.title}
                        </span>
                        <span className="text-xs text-content-soft">
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
                  <LineChart data={attainment} margin={{ top: 20, right: 8, bottom: 0, left: 0 }}>
                    <XAxis
                      dataKey="empresa"
                      tick={{ fontSize: 11, fill: chart.tick }}
                      axisLine={{ stroke: chart.axis }}
                      tickLine={false}
                    />
                    <YAxis
                      unit="%"
                      tick={{ fontSize: 11, fill: chart.tick }}
                      axisLine={false}
                      tickLine={false}
                      width={46}
                    />
                    <Tooltip
                      cursor={{ stroke: chart.axis, strokeDasharray: '4 4' }}
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
                      labelFormatter={(label: string) => {
                        const row = attainment.find((item) => item.empresa === label)
                        return row ? `${label} — ${row.noAlvo}/${row.metas} meta(s) no alvo` : label
                      }}
                    />
                    <ReferenceLine
                      y={100}
                      stroke={chart.reference}
                      strokeDasharray="4 4"
                      ifOverflow="extendDomain"
                      label={{ value: 'meta', position: 'right', fontSize: 10, fill: chart.tick }}
                    />
                    <Line dataKey="atingimento" stroke={chart.axis} strokeWidth={2} dot={attainmentDot}>
                      <LabelList
                        dataKey="atingimento"
                        position="top"
                        formatter={(value: number) => `${value}%`}
                        style={{ fontSize: 11, fill: chart.label }}
                      />
                    </Line>
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* ------------------------------------------- KPIs na meta por empresa */}
          <Card
            title="KPIs na meta por empresa"
            description="Quantos indicadores de cada empresa estão na meta, fora dela ou ainda sem lançamento."
          >
            {kpiHealth.length === 0 ? (
              <EmptyState
                title="Nenhum KPI cadastrado ainda"
                description="Cadastre indicadores nas empresas para comparar aqui."
              />
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={kpiHealth} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="35%">
                    <XAxis
                      dataKey="empresa"
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
                    <Legend
                      wrapperStyle={{ fontSize: 12, color: chart.label }}
                      formatter={(value: string) => (
                        <span style={{ color: chart.label }}>{value}</span>
                      )}
                    />
                    <Bar dataKey="naMeta" name="Na meta" stackId="kpis" fill="#10B981" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="fora" name="Fora da meta" stackId="kpis" fill="#F43F5E" />
                    <Bar
                      dataKey="semLancamento"
                      name="Sem lançamento"
                      stackId="kpis"
                      fill="#94A3B8"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* -------------------------------------------- cartão por empresa —
              a que precisa de mais atenção vem primeiro (mais vencida,
              metas em risco, KPI fora), não em ordem alfabética */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {byUrgency.map((snapshot) => {
              const companyKpis = kpis.filter((kpi) => kpi.company_id === snapshot.company_id)
              const health = companyHealth.get(snapshot.company_id) ?? null
              const status = companyStatus(snapshot)
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
                          className="flex items-center gap-1.5 text-sm font-semibold text-content hover:text-brand-text"
                        >
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status]}`}
                            title={
                              status === 'red'
                                ? 'Precisa de atenção agora'
                                : status === 'amber'
                                  ? 'Algum KPI fora da meta'
                                  : 'Tudo em dia'
                            }
                          />
                          {snapshot.company_name}
                        </Link>
                        <p className="text-xs text-content-soft">
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

                  {health !== null && (
                    <div className="mt-3">
                      <ProgressBar ratio={health} label="Saúde geral" />
                    </div>
                  )}

                  <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-lg bg-hover py-2">
                      <p className="text-lg font-semibold">
                        {snapshot.kpis_on_target}
                        <span className="text-xs font-normal text-content-faint">
                          /{Number(snapshot.kpis_on_target) + Number(snapshot.kpis_off_target)}
                        </span>
                      </p>
                      <p className="text-[11px] text-content-soft">KPIs na meta</p>
                    </div>
                    <div className="rounded-lg bg-hover py-2">
                      <p className="text-lg font-semibold">{snapshot.goals_active}</p>
                      <p className="text-[11px] text-content-soft">metas ativas</p>
                    </div>
                    <div className="rounded-lg bg-hover py-2">
                      <p className="text-lg font-semibold">{snapshot.tasks_open}</p>
                      <p className="text-[11px] text-content-soft">tarefas abertas</p>
                    </div>
                  </div>

                  {companyKpis.length > 0 && (
                    <ul className="mt-4 space-y-2">
                      {companyKpis.slice(0, 4).map((kpi) => {
                        const status = isOnTarget(Number(kpi.value), kpi.target_value, kpi.direction)
                        const ratio = attainmentRatio(Number(kpi.value), kpi.target_value, kpi.direction)
                        const caption =
                          kpi.target_value !== null
                            ? `${formatValue(Number(kpi.value), kpi.unit)} de ${formatValue(kpi.target_value, kpi.unit)}`
                            : undefined
                        return (
                          <li key={kpi.kpi_id}>
                            <Link
                              to={`/empresa/${snapshot.company_id}/kpis?kpi=${kpi.kpi_id}`}
                              className="block rounded-md -mx-1.5 px-1.5 py-1 transition hover:bg-hover"
                            >
                              <div className="flex items-center justify-between gap-2 text-sm">
                                <span className="min-w-0 truncate text-content-muted">
                                  {kpi.name}
                                  {kpi.due_date && (
                                    <span className="ml-1.5 text-[11px] text-content-faint">
                                      · prazo {formatDate(kpi.due_date)}
                                    </span>
                                  )}
                                </span>
                                <span
                                  className={`shrink-0 font-medium ${
                                    status === false ? 'text-rose-600 dark:text-rose-400' : 'text-content'
                                  }`}
                                >
                                  {formatValue(Number(kpi.value), kpi.unit)}
                                </span>
                              </div>
                              {ratio !== null && (
                                <div className="mt-1">
                                  <ProgressBar ratio={ratio} caption={caption} />
                                </div>
                              )}
                            </Link>
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link to={`/empresa/${snapshot.company_id}`} className="btn-ghost py-1.5 text-xs">
                      <Target className="h-3.5 w-3.5" /> Painel
                    </Link>
                    <Link
                      to={`/empresa/${snapshot.company_id}/tarefas`}
                      className="btn-ghost py-1.5 text-xs"
                    >
                      <ClipboardList className="h-3.5 w-3.5" /> Tarefas
                    </Link>
                    {Number(snapshot.products_active) > 0 && (
                      <Link
                        to={`/empresa/${snapshot.company_id}/produtos`}
                        className="btn-ghost py-1.5 text-xs"
                      >
                        <Layers className="h-3.5 w-3.5" /> {snapshot.products_active} produto(s)
                      </Link>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>

          {insights.length > 0 && (
            <Card
              title="Insights da Holding"
              actions={
                <Link to="/holding/insights" className="btn-ghost py-1.5 text-xs">
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
