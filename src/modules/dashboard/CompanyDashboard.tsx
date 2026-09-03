// Painel da empresa: o retrato de hoje em uma tela.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Sparkles,
  Square,
  StickyNote,
  Target,
  Wallet,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  Cell,
  Line,
  LabelList,
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
  labelPeriod,
  relativeDays,
} from '../../core/lib/format'
import { buildChildrenByParent, effectiveKpiValue } from '../../core/lib/kpiRollup'
import { useCompany } from '../../core/company/CompanyProvider'
import { useChartTheme } from '../../core/theme/ThemeProvider'
import { Badge, Card, CardCarousel, EmptyState, Loading, PageHeader, ProgressBar, useToast } from '../../core/ui'
import {
  GOAL_STATUS_LABEL,
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  type GoalStatus,
  type Insight,
  type Kpi,
  type KpiDirection,
  type KpiLatestValue,
  type KpiUnit,
  type Meta,
  type Product,
  type ProductEdition,
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

// Ponto colorido do gráfico "Metas: realizado x alvo" — verde na meta,
// vermelho fora dela, mesmo critério de cor do resto do sistema. O eixo X é
// categórico (uma meta por ponto, não uma linha do tempo), mas a linha
// ligando os pontos deixa mais fácil comparar visualmente do que barras
// separadas.
function attainmentDot(props: any) {
  const { cx, cy, payload, index } = props
  return (
    <circle
      key={`dot-${index}`}
      cx={cx}
      cy={cy}
      r={5}
      fill={payload.naMeta ? '#10B981' : '#F43F5E'}
      stroke="#fff"
      strokeWidth={1.5}
    />
  )
}

/** Um KPI (indicador) ativo, com o último valor lançado quando existir. Sem
 *  lançamento ainda é um indicador de verdade — ele não deve desaparecer do
 *  painel por isso. Só medição: meta é outra coisa, ver `MetaRow`. */
type KpiRow = {
  kpi_id: string
  name: string
  unit: KpiUnit
  direction: KpiDirection
  frequency: Kpi['frequency']
  value: number | null
  period_start: string | null
  product_id: string | null
  product_edition_id: string | null
  parent_kpi_id: string | null
}

/** Uma meta, já com o nome/unidade/direção do indicador que ela mede e o
 *  valor de verdade dele (`effectiveValue` — soma os filhos quando o
 *  indicador tem sub-produtos). Várias linhas podem repetir o mesmo
 *  kpi_id — um indicador pode ter mais de uma meta ao mesmo tempo. */
type MetaRow = {
  meta_id: string
  kpi_id: string
  name: string
  unit: KpiUnit
  direction: KpiDirection
  product_id: string | null
  product_edition_id: string | null
  target_value: number | null
  due_date: string | null
  owner_id: string | null
  status: GoalStatus
  value: number | null
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

/** Nome da meta + "valor de meta" + barrinha — uma frente pode ter várias
 *  metas ao mesmo tempo (dela mesma e de cada edição/turma, e cada
 *  indicador pode ter mais de uma meta também), então o cartão de produto
 *  lista mais de uma em vez de escolher só uma "de capa". `editionName`
 *  distingue metas de mesmo nome em turmas diferentes (ex. "Faturamento"
 *  da Turma 12 e da Turma 13). */
function ProductMetaLine({ meta, editionName }: { meta: MetaRow; editionName?: string }) {
  const ratio = meta.value !== null ? attainmentRatio(meta.value, meta.target_value, meta.direction) : null
  return (
    <div>
      <p className="truncate text-xs font-medium text-content-soft">
        {meta.name}
        {editionName && <span className="font-normal text-content-faint"> · {editionName}</span>}
      </p>
      <p className="mt-0.5 text-xs text-content-faint">
        {meta.value === null
          ? 'sem lançamento ainda'
          : meta.target_value !== null
            ? `${formatValue(meta.value, meta.unit)} de ${formatValue(meta.target_value, meta.unit)}`
            : formatValue(meta.value, meta.unit)}
      </p>
      {meta.value !== null && meta.target_value !== null && (
        <div className="mt-1">
          <ProgressBar ratio={ratio} />
        </div>
      )}
    </div>
  )
}

export default function CompanyDashboard() {
  const { company, isAdmin } = useCompany()
  const chart = useChartTheme()
  const { notify } = useToast()
  const [kpiDefs, setKpiDefs] = useState<Kpi[]>([])
  const [kpiValues, setKpiValues] = useState<KpiLatestValue[]>([])
  const [metas, setMetas] = useState<Meta[]>([])
  const [people, setPeople] = useState<Profile[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [insights, setInsights] = useState<Insight[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [editions, setEditions] = useState<ProductEdition[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [kpiDefResult, kpiValueResult, metaResult, memberResult, taskResult, insightResult, productResult, editionResult] =
      await Promise.all([
        supabase
          .from('kpis')
          .select('*')
          .eq('company_id', company.id)
          .eq('is_active', true)
          .is('archived_at', null)
          .order('display_order'),
        supabase.from('kpi_latest_values').select('*').eq('company_id', company.id).is('archived_at', null),
        supabase.from('metas').select('*').eq('company_id', company.id).is('archived_at', null),
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
        supabase.from('products').select('*').eq('company_id', company.id).eq('is_active', true).order('display_order'),
        supabase.from('product_editions').select('*').eq('company_id', company.id),
      ])

    const memberIds = (memberResult.data ?? []).map((row) => row.user_id)
    const { data: profileRows } = memberIds.length
      ? await supabase.from('profiles').select('*').in('id', memberIds)
      : { data: [] as Profile[] }

    setKpiDefs((kpiDefResult.data as Kpi[]) ?? [])
    setKpiValues((kpiValueResult.data as KpiLatestValue[]) ?? [])
    setMetas((metaResult.data as Meta[]) ?? [])
    setPeople((profileRows as Profile[]) ?? [])
    setTasks((taskResult.data as Task[]) ?? [])
    setInsights((insightResult.data as Insight[]) ?? [])
    setProducts((productResult.data as Product[]) ?? [])
    setEditions((editionResult.data as ProductEdition[]) ?? [])
    setLoading(false)
  }, [company.id, isAdmin])

  // Concluir sem sair do painel — abrir o quadro só pra marcar "feito" era
  // uma volta desnecessária pra ação mais comum do dia a dia.
  const markTaskDone = async (task: Task) => {
    const { error } = await supabase.from('tasks').update({ status: 'done' }).eq('id', task.id)
    if (error) {
      notify(error.message, 'error')
      return
    }
    await load()
  }

  useEffect(() => {
    void load()
  }, [load])

  // Todo indicador ativo entra aqui — com lançamento ou não. É essa lista
  // que fecha o buraco de "cadastrei o indicador e ele nunca apareceu no
  // painel". Só medição — meta é outra lista (metaRows, abaixo).
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
          value: latest ? Number(latest.value) : null,
          period_start: latest?.period_start ?? null,
          product_id: def.product_id,
          product_edition_id: def.product_edition_id,
          parent_kpi_id: def.parent_kpi_id,
        }
      }),
    [kpiDefs, kpiValues],
  )

  // Produto (ou meta da empresa) que soma o valor dos filhos — ex.: "Entre
  // Donos" soma as turmas. Um nó do meio nunca lança direto: o valor que
  // ele mostra e repassa pro próprio pai é sempre a soma dos filhos.
  const childrenByParent = useMemo(() => buildChildrenByParent(kpiRows), [kpiRows])
  const kpiRowById = useMemo(() => new Map(kpiRows.map((row) => [row.kpi_id, row])), [kpiRows])
  const effectiveValue = useCallback(
    (kpiId: string) => effectiveKpiValue(kpiId, childrenByParent, kpiRowById),
    [childrenByParent, kpiRowById],
  )

  // Cada meta ganha o nome/unidade/direção do indicador que ela mede e o
  // valor de verdade dele (soma incluída) — um indicador pode aparecer em
  // mais de uma linha aqui (uma por meta que ele tem).
  const metaRows = useMemo<MetaRow[]>(
    () =>
      metas
        .map((meta) => {
          const kpi = kpiRowById.get(meta.kpi_id)
          if (!kpi) return null
          return {
            meta_id: meta.id,
            kpi_id: meta.kpi_id,
            name: kpi.name,
            unit: kpi.unit,
            direction: kpi.direction,
            product_id: kpi.product_id,
            product_edition_id: kpi.product_edition_id,
            target_value: meta.target_value,
            due_date: meta.due_date,
            owner_id: meta.owner_id,
            status: meta.status,
            value: effectiveValue(meta.kpi_id),
          }
        })
        .filter((row): row is MetaRow => row !== null),
    [metas, kpiRowById, effectiveValue],
  )

  // Saúde de cada produto: mesma conta da saúde geral da empresa (média do
  // attainmentRatio das metas com alvo), restrita às metas daquela frente —
  // mais quantas tarefas dela estão abertas. `metas` aqui é TODA meta do
  // produto — a dele mesmo e a de cada edição —, não só uma "de capa"
  // escolhida a dedo: uma turma pode ter várias metas ao mesmo tempo
  // (vendas de ingresso, faturamento, cancelamentos…) e todas precisam
  // aparecer.
  const productStats = useMemo(() => {
    const map = new Map<
      string,
      { ratio: number | null; open: number; metas: { meta: MetaRow; editionName?: string }[] }
    >()
    for (const product of products) {
      const productMetas = metaRows.filter((row) => row.product_id === product.id)
      const withTarget = productMetas.filter((row) => row.target_value !== null && Number(row.target_value) !== 0)
      const ratios = withTarget
        .map((row) => attainmentRatio(row.value, row.target_value, row.direction))
        .filter((ratio): ratio is number => ratio !== null)
      const open = tasks.filter(
        (task) => task.product_id === product.id && ['todo', 'doing', 'blocked'].includes(task.status),
      )
      const metasList = productMetas.map((row) => ({
        meta: row,
        editionName: row.product_edition_id
          ? editions.find((edition) => edition.id === row.product_edition_id)?.name
          : undefined,
      }))
      map.set(product.id, {
        ratio: ratios.length ? ratios.reduce((sum, r) => sum + r, 0) / ratios.length : null,
        open: open.length,
        metas: metasList,
      })
    }
    return map
  }, [products, editions, metaRows, tasks])

  // Metas em aberto — pra bater o olho no cartão "Metas" sem entrar em KPIs.
  const openMetas = useMemo(
    () =>
      metaRows
        .filter((row) => row.due_date !== null && !['achieved', 'missed'].includes(row.status))
        .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))
        .slice(0, 6),
    [metaRows],
  )
  const ownerName = (id: string | null) =>
    id ? (people.find((person) => person.id === id)?.full_name ?? '—') : 'Sem responsável'

  const stats = useMemo(() => {
    const open = tasks.filter((task) => ['todo', 'doing', 'blocked'].includes(task.status))
    const today = new Date().toISOString().slice(0, 10)
    const overdue = open.filter((task) => task.due_date && task.due_date < today)
    const withValue = metaRows.filter((row) => row.value !== null && row.target_value !== null)
    const onTarget = withValue.filter(
      (row) => isOnTarget(row.value!, row.target_value, row.direction) === true,
    )
    const offTarget = withValue.filter(
      (row) => isOnTarget(row.value!, row.target_value, row.direction) === false,
    )
    return { open, overdue, onTarget, offTarget }
  }, [tasks, metaRows])

  const upcoming = useMemo(
    () =>
      stats.open
        .filter((task) => task.due_date)
        .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))
        .slice(0, 6),
    [stats.open],
  )

  // Saúde geral: a média do atingimento de toda meta com alvo definido — um
  // único número pra bater o olho e já saber como a empresa anda, antes de
  // entrar cartão por cartão. Só conta meta com alvo; sem alvo não tem o
  // que medir atingimento.
  const overallHealth = useMemo(() => {
    const ratios = metaRows
      .filter((row) => row.target_value !== null && Number(row.target_value) !== 0)
      .map((row) => attainmentRatio(row.value, row.target_value, row.direction))
      .filter((ratio): ratio is number => ratio !== null)
    return {
      ratio: ratios.length ? ratios.reduce((sum, r) => sum + r, 0) / ratios.length : null,
      medidos: ratios.length,
    }
  }, [metaRows])

  // Comparação entre metas desta empresa: % do alvo atingido. Unidades
  // diferentes (R$, %, dias) não podem virar barra na mesma escala — só o
  // atingimento é comparável entre metas distintas.
  //
  // Numa meta "up" (maior é melhor), atingimento = valor / alvo. Numa "down"
  // (menor é melhor, ex. churn), a mesma conta inverteria o sentido — por isso
  // usamos alvo / valor, que também sobe acima de 100% quando o resultado é
  // melhor que o alvo. Limitamos a 300% só para o gráfico não esticar demais
  // quando o valor está próximo de zero.
  const kpiAttainment = useMemo(() => {
    const seenNames = new Map<string, number>()
    return metaRows
      .filter((row) => row.value !== null && row.target_value !== null && row.target_value !== 0)
      .map((row) => {
        const ratio =
          row.direction === 'up'
            ? row.value! / row.target_value!
            : row.value! > 0
              ? row.target_value! / row.value!
              : 3
        // Duas metas do mesmo indicador (ex. meta mensal e anual) teriam o
        // mesmo rótulo no eixo — numera a partir da segunda pra distinguir.
        const seen = seenNames.get(row.name) ?? 0
        seenNames.set(row.name, seen + 1)
        return {
          nome: seen > 0 ? `${row.name} (${seen + 1})` : row.name,
          atingimento: Math.round(Math.min(ratio, 3) * 100),
          naMeta: isOnTarget(row.value!, row.target_value, row.direction) === true,
        }
      })
  }, [metaRows])

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
        actions={
          <>
            <Link to={`/empresa/${company.id}/notas`} className="btn-ghost py-1.5 text-xs">
              <StickyNote className="h-3.5 w-3.5" /> Notas
            </Link>
            <Link to={`/empresa/${company.id}/orcamentos`} className="btn-ghost py-1.5 text-xs">
              <Wallet className="h-3.5 w-3.5" /> Orçamentos
            </Link>
          </>
        }
      />

      {overallHealth.ratio !== null && (
        <div className="card p-4">
          <ProgressBar
            ratio={overallHealth.ratio}
            label="Saúde geral das metas"
            caption={`média de atingimento em ${overallHealth.medidos} meta(s) com alvo definido`}
          />
        </div>
      )}

      {/* Cartões de resumo — no celular viram carrossel (arrasta com o dedo
          ou espera passar sozinho) pra caber tudo no topo sem ocupar a tela
          toda; do tablet pra cima é grid de sempre. Mesmo padrão do painel
          da holding — os cartões são montados uma vez só e reaproveitados
          nos dois. */}
      {(() => {
        const cards = [
          <StatTile
            key="metas-na-meta"
            label="Metas na meta"
            value={`${stats.onTarget.length}/${stats.onTarget.length + stats.offTarget.length}`}
            hint={`${stats.onTarget.length + stats.offTarget.length} meta(s) com alvo`}
            tone={stats.offTarget.length === 0 ? 'green' : 'slate'}
            icon={CheckCircle2}
          />,
          <StatTile
            key="metas"
            label="Metas em aberto"
            value={openMetas.length}
            hint={`${openMetas.filter((meta) => meta.status === 'at_risk').length} em risco`}
            tone={openMetas.some((meta) => meta.status === 'at_risk') ? 'amber' : 'slate'}
            icon={Target}
          />,
          <StatTile
            key="tarefas"
            label="Tarefas abertas"
            value={stats.open.length}
            hint={`${tasks.filter((task) => task.status === 'done').length} concluídas`}
            icon={ClipboardList}
          />,
          <StatTile
            key="vencidas"
            label="Tarefas vencidas"
            value={stats.overdue.length}
            tone={stats.overdue.length > 0 ? 'red' : 'green'}
            hint={stats.overdue.length ? 'precisam de atenção' : 'nada atrasado'}
            icon={AlertTriangle}
          />,
        ]
        return (
          <>
            <div className="sm:hidden">
              <CardCarousel items={cards} />
            </div>
            <div className="hidden gap-4 sm:grid sm:grid-cols-2 lg:grid-cols-4">{cards}</div>
          </>
        )
      })()}

      {products.length > 0 && (
        <Card
          title="Produtos"
          description="A saúde de cada frente — clique pra abrir edições, KPIs e tarefas dela."
          actions={
            <Link to={`/empresa/${company.id}/produtos`} className="btn-ghost py-1.5 text-xs">
              Gerenciar
            </Link>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => {
              const stats = productStats.get(product.id)
              return (
                <Link
                  key={product.id}
                  to={`/empresa/${company.id}/produtos`}
                  className="block rounded-lg border border-line p-3 transition hover:border-line-strong hover:bg-hover"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: product.color ?? '#94A3B8' }}
                    />
                    <p className="min-w-0 truncate text-sm font-medium text-content">{product.name}</p>
                  </div>
                  <p className="mt-1 text-xs text-content-faint">{stats?.open ?? 0} tarefa(s) aberta(s)</p>
                  {stats && stats.metas.length > 0 ? (
                    <div className="mt-2 space-y-2">
                      {stats.metas.slice(0, 2).map(({ meta, editionName }) => (
                        <ProductMetaLine key={meta.meta_id} meta={meta} editionName={editionName} />
                      ))}
                      {stats.metas.length > 2 && (
                        <p className="text-[11px] text-content-faint">
                          + {stats.metas.length - 2} meta{stats.metas.length - 2 > 1 ? 's' : ''}
                        </p>
                      )}
                    </div>
                  ) : (
                    stats?.ratio !== null &&
                    stats?.ratio !== undefined && (
                      <div className="mt-2">
                        <ProgressBar ratio={stats.ratio} />
                      </div>
                    )
                  )}
                </Link>
              )
            })}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title="Indicadores"
          description="Último valor apurado de cada KPI. Clique num cartão para abrir o indicador."
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
              {kpiRows.slice(0, 8).map((kpi) => (
                <Link
                  key={kpi.kpi_id}
                  to={`/empresa/${company.id}/kpis?kpi=${kpi.kpi_id}`}
                  className="block rounded-lg border border-line p-3 transition hover:border-line-strong hover:bg-hover"
                >
                  <p className="truncate text-xs font-medium uppercase tracking-wide text-content-soft">
                    {kpi.name}
                  </p>
                  <div className="mt-1 flex items-end justify-between gap-2">
                    <span
                      className={`text-xl font-semibold ${kpi.value === null ? 'text-content-faint' : ''}`}
                    >
                      {kpi.value === null ? '—' : formatValue(kpi.value, kpi.unit)}
                    </span>
                    {kpi.value === null && <Badge tone="slate">sem lançamento</Badge>}
                  </div>
                  <p className="mt-0.5 text-[11px] text-content-faint">
                    {kpi.value === null ? 'aguardando o primeiro valor' : labelPeriod(kpi.period_start!, kpi.frequency)}
                  </p>
                </Link>
              ))}
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
                      <span className="flex min-w-0 items-start gap-2">
                        <button
                          type="button"
                          className="mt-0.5 shrink-0 text-content-faint hover:text-emerald-600 dark:hover:text-emerald-400"
                          onClick={() => void markTaskDone(task)}
                          aria-label="Marcar como concluída"
                          title="Marcar como concluída"
                        >
                          <Square className="h-4 w-4" />
                        </button>
                        <span className="min-w-0 text-sm">
                          <span className="block truncate">{task.title}</span>
                          <span className="text-xs text-content-faint">
                            {TASK_PRIORITY_LABEL[task.priority]}
                          </span>
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
            description="Alvo, prazo e andamento de cada meta desta empresa."
            actions={
              <Link to={`/empresa/${company.id}/kpis`} className="btn-ghost py-1.5 text-xs">
                Ver KPIs
              </Link>
            }
          >
            {openMetas.length === 0 ? (
              <p className="text-sm text-content-soft">Nenhuma meta em aberto.</p>
            ) : (
              <ul className="space-y-3">
                {openMetas.map((meta) => {
                  const ratio = attainmentRatio(meta.value, meta.target_value, meta.direction)
                  const caption =
                    meta.value !== null && meta.target_value !== null
                      ? `${formatValue(meta.value, meta.unit)} de ${formatValue(meta.target_value, meta.unit)}`
                      : undefined
                  return (
                    <li key={meta.meta_id}>
                      <Link
                        to={`/empresa/${company.id}/kpis?kpi=${meta.kpi_id}`}
                        className="block rounded-md -mx-1 px-1 py-0.5 transition hover:bg-hover"
                      >
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span className="min-w-0 truncate">{meta.name}</span>
                          <Badge tone={meta.status === 'at_risk' ? 'amber' : 'slate'}>
                            {GOAL_STATUS_LABEL[meta.status]}
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-xs text-content-faint">
                          {ownerName(meta.owner_id)} · prazo {formatDate(meta.due_date)} (
                          {relativeDays(meta.due_date)})
                        </p>
                        {ratio !== null && (
                          <div className="mt-1.5">
                            <ProgressBar ratio={ratio} caption={caption} />
                          </div>
                        )}
                      </Link>
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
          title="Metas: realizado x alvo"
          description="Quanto cada meta entregou frente ao próprio alvo. A linha marca os 100%."
        >
          {kpiAttainment.length === 0 ? (
            <EmptyState
              title="Nada para comparar ainda"
              description="Defina uma meta e lance ao menos um valor no indicador dela."
            />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={kpiAttainment} margin={{ top: 20, right: 8, bottom: 0, left: 0 }}>
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
                  />
                  <ReferenceLine y={100} stroke={chart.reference} strokeDasharray="4 4" ifOverflow="extendDomain" />
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
