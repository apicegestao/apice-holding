// Painel da empresa: o retrato de hoje em uma tela.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  EyeOff,
  Sparkles,
  StickyNote,
  Target,
  Wallet,
} from 'lucide-react'
import {
  Legend,
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
  formatCompact,
  formatDate,
  formatValue,
  initials,
  isOnTarget,
  relativeDays,
} from '../../core/lib/format'
import { buildChildrenByParent, effectiveKpiValue } from '../../core/lib/kpiRollup'
import { useCompany } from '../../core/company/CompanyProvider'
import { useChartTheme } from '../../core/theme/ThemeProvider'
import { Badge, Card, CardCarousel, EmptyState, Loading, PageHeader, ProgressBar } from '../../core/ui'
import {
  GOAL_STATUS_LABEL,
  type GoalStatus,
  type Insight,
  type Kpi,
  type KpiDirection,
  type KpiLatestValue,
  type KpiUnit,
  type KpiValue,
  type Meta,
  type Product,
  type Profile,
  type Task,
} from '../../core/types'

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

// Exportado — reaproveitado também no painel de produto/turma
// (ProductDashboard.tsx), que mostra o mesmo tipo de cartão de resumo
// escopado a uma frente/turma em vez da empresa inteira.
export function StatTile({
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

/** Nome do indicador + valor atual — produto e turma são medição pura (a
 *  meta de verdade vive só no indicador de empresa inteira), então aqui não
 *  tem alvo, nem ratio, nem barra: só o valor, já com a soma dos filhos
 *  incluída quando o indicador tiver sub-produtos. Prop `row` aceita só
 *  `name`/`unit` (não o `KpiRow` inteiro) — assim dá pra reaproveitar em
 *  ProductDashboard.tsx sem precisar montar um `KpiRow` completo lá. */
export function IndicatorLine({ row, value }: { row: Pick<KpiRow, 'name' | 'unit'>; value: number | null }) {
  return (
    <div>
      <p className="truncate text-xs font-medium text-content-soft">{row.name}</p>
      <p className="mt-0.5 text-xs text-content-faint">
        {value === null ? 'sem lançamento ainda' : formatValue(value, row.unit)}
      </p>
    </div>
  )
}

export default function CompanyDashboard() {
  const { company, isAdmin } = useCompany()
  const chart = useChartTheme()
  const [kpiDefs, setKpiDefs] = useState<Kpi[]>([])
  const [kpiValues, setKpiValues] = useState<KpiLatestValue[]>([])
  const [metas, setMetas] = useState<Meta[]>([])
  const [people, setPeople] = useState<Profile[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [insights, setInsights] = useState<Insight[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [kpiHistory, setKpiHistory] = useState<KpiValue[]>([])
  const [inactiveKpiCount, setInactiveKpiCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [
      kpiDefResult,
      kpiValueResult,
      metaResult,
      memberResult,
      taskResult,
      insightResult,
      productResult,
      inactiveKpiResult,
      kpiHistoryResult,
    ] = await Promise.all([
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
      // Só a contagem — pra avisar que existem metas desativadas sem trazer
      // os dados delas (o painel não mostra nada além do número, "ver
      // todas" leva pra tela de Metas). Arquivada é outra coisa (some da
      // própria lista de Metas) e não entra aqui.
      supabase.from('kpis').select('id').eq('company_id', company.id).eq('is_active', false).is('archived_at', null),
      // Histórico completo (todo período, não só o mais recente) — só pro
      // gráfico "Comparação entre produtos" abaixo, que soma por MÊS em vez
      // de pegar só o valor atual (ver productHistory). Mesmo custo que
      // KpisPage.tsx já paga pra montar o histórico de um indicador.
      supabase.from('kpi_values').select('*').eq('company_id', company.id),
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
    setInactiveKpiCount((inactiveKpiResult.data ?? []).length)
    setKpiHistory((kpiHistoryResult.data as KpiValue[]) ?? [])
    setLoading(false)
  }, [company.id, isAdmin])

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
  // mais de uma linha aqui (uma por meta que ele tem). Alvo agora existe em
  // todo nível (empresa/produto/turma — ver tela de Metas), mas este
  // resumo do painel continua escopado a alvo de empresa inteira, de
  // propósito: pooling de alvo de turma com alvo de empresa no mesmo
  // número misturaria grãos bem diferentes (mesma decisão já aplicada em
  // company_snapshots() pro painel da holding).
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
        .filter((row): row is MetaRow => row !== null && row.product_id === null),
    [metas, kpiRowById, effectiveValue],
  )

  // Este cartão compacto do painel mostra só o valor de cada produto (sem
  // edição — as turmas aparecem um nível abaixo, dentro da tela de
  // Metas/Produtos), mais quantas tarefas dele estão abertas — o detalhe
  // completo, incluindo alvo de produto/turma, mora na tela de Metas.
  const productStats = useMemo(() => {
    const map = new Map<string, { open: number; indicators: KpiRow[] }>()
    for (const product of products) {
      const indicators = kpiRows.filter(
        (row) => row.product_id === product.id && row.product_edition_id === null,
      )
      const open = tasks.filter(
        (task) => task.product_id === product.id && ['todo', 'doing', 'blocked'].includes(task.status),
      )
      map.set(product.id, { open: open.length, indicators })
    }
    return map
  }, [products, kpiRows, tasks])

  // Metas em aberto — pra bater o olho no cartão "Alvos" sem entrar em KPIs.
  const openMetas = useMemo(
    () =>
      metaRows
        .filter((row) => row.due_date !== null && !['achieved', 'missed'].includes(row.status))
        .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))
        .slice(0, 6),
    [metaRows],
  )
  const semResponsavelCount = useMemo(
    () => openMetas.filter((meta) => !meta.owner_id).length,
    [openMetas],
  )
  const ownerName = (id: string | null) =>
    id ? (people.find((person) => person.id === id)?.full_name ?? '—') : 'Sem responsável'

  // Atalho pra performance de cada responsável — pedido do usuário ("clico
  // em Felipe e tenho um painel com tudo que é dele"). Só quem já tem algo
  // pra mostrar (meta em risco ou tarefa aberta/vencida) entra na lista —
  // quem precisa de atenção primeiro, no topo (mesmo critério de urgência
  // já usado pra ordenar empresa no painel da holding).
  const teamRanking = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return people
      .map((person) => {
        const atRisk = metaRows.filter((row) => row.owner_id === person.id && row.status === 'at_risk').length
        const openTasks = tasks.filter(
          (task) => task.assignee_id === person.id && ['todo', 'doing', 'blocked'].includes(task.status),
        )
        const overdue = openTasks.filter((task) => task.due_date && task.due_date < today).length
        return { person, atRisk, overdue, open: openTasks.length }
      })
      .filter((row) => row.atRisk > 0 || row.overdue > 0 || row.open > 0)
      .sort((a, b) => b.overdue * 3 + b.atRisk * 2 - (a.overdue * 3 + a.atRisk * 2))
      .slice(0, 6)
  }, [people, metaRows, tasks])

  // ------------------------------------------------- comparação de produtos
  // Sugestão do usuário no lugar do card "Metas" (removido, redundante):
  // faturamento de cada produto principal, mês a mês. Um produto nunca lança
  // valor direto quando tem turma por baixo (kpiRollup.ts) — por isso a soma
  // certa não é "todo indicador do produto", e sim só as FOLHAS da árvore
  // (mesmo truque que productRevenue já usa no painel da Holding). Só moeda,
  // mesma razão de lá: unidades diferentes não comparam na mesma escala.
  const productHistory = useMemo(() => {
    const currencyIds = new Set(kpiDefs.filter((k) => k.unit === 'currency').map((k) => k.id))
    const childrenOf = new Map<string, string[]>()
    for (const k of kpiDefs) {
      if (!k.parent_kpi_id) continue
      const list = childrenOf.get(k.parent_kpi_id) ?? []
      list.push(k.id)
      childrenOf.set(k.parent_kpi_id, list)
    }
    // Toda folha em moeda descendente de um kpi (ele mesmo, se já for folha).
    const leavesOf = (id: string, seen = new Set<string>()): string[] => {
      if (seen.has(id)) return []
      seen.add(id)
      const children = childrenOf.get(id) ?? []
      if (!children.length) return currencyIds.has(id) ? [id] : []
      return children.flatMap((childId) => leavesOf(childId, seen))
    }

    const leafToProduct = new Map<string, Product>()
    for (const product of products) {
      const roots = kpiDefs.filter((k) => k.product_id === product.id && k.product_edition_id === null)
      for (const leafId of new Set(roots.flatMap((k) => leavesOf(k.id)))) leafToProduct.set(leafId, product)
    }
    const productsWithData = products.filter((product) =>
      [...leafToProduct.values()].some((p) => p.id === product.id),
    )
    if (productsWithData.length === 0) return { points: [] as Record<string, string | number>[], products: [] as Product[] }

    // Soma por mês (period_start truncado a "AAAA-MM") — normaliza pequenas
    // diferenças de dia entre indicadores mensais de produtos diferentes.
    const byMonth = new Map<string, Map<string, number>>()
    for (const value of kpiHistory) {
      const product = leafToProduct.get(value.kpi_id)
      if (!product) continue
      const monthKey = value.period_start.slice(0, 7)
      const monthMap = byMonth.get(monthKey) ?? new Map<string, number>()
      monthMap.set(product.id, (monthMap.get(product.id) ?? 0) + Number(value.value))
      byMonth.set(monthKey, monthMap)
    }

    const months = [...byMonth.keys()].sort().slice(-12)
    const points = months.map((monthKey) => {
      const row: Record<string, string | number> = {
        period: new Date(`${monthKey}-01T12:00:00`).toLocaleDateString('pt-BR', {
          month: 'short',
          year: '2-digit',
        }),
      }
      const monthMap = byMonth.get(monthKey)!
      for (const product of productsWithData) row[product.name] = monthMap.get(product.id) ?? 0
      return row
    })

    return { points, products: productsWithData }
  }, [products, kpiDefs, kpiHistory])

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

  // Saúde geral: a média do atingimento de todo alvo definido — um único
  // número pra bater o olho e já saber como a empresa anda, antes de
  // entrar cartão por cartão. Só conta alvo definido; sem alvo não tem o
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

  // Comparação entre alvos desta empresa: % do alvo atingido. Unidades
  // diferentes (R$, %, dias) não podem virar barra na mesma escala — só o
  // atingimento é comparável entre alvos distintos. `attainmentRatio` já
  // cuida da inversão de sentido em alvo "down" (menor é melhor, ex.
  // churn) e já tem teto embutido (300%) — aqui só reaplicamos o mesmo
  // teto no eixo do gráfico, por clareza visual (não porque a função
  // precise, ela já limita sozinha).
  const kpiAttainment = useMemo(() => {
    const seenNames = new Map<string, number>()
    return metaRows
      .filter((row) => row.value !== null && row.target_value !== null && row.target_value !== 0)
      .map((row) => {
        const ratio = attainmentRatio(row.value, row.target_value, row.direction)!
        // Dois alvos da mesma meta (ex. alvo mensal e anual) teriam o
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
            label="Saúde geral dos alvos"
            caption={`média de atingimento em ${overallHealth.medidos} alvo(s) definido(s)`}
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
            label="Metas no alvo"
            value={`${stats.onTarget.length}/${stats.onTarget.length + stats.offTarget.length}`}
            hint={`${stats.onTarget.length + stats.offTarget.length} alvo(s) definido(s)`}
            tone={stats.offTarget.length === 0 ? 'green' : 'slate'}
            icon={CheckCircle2}
          />,
          <StatTile
            key="metas"
            label="Alvos em aberto"
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

      {/* Aviso discreto — não traz os dados delas de volta pro painel (só
          citação), mas evita a sensação de "sumiu sem explicação" quando
          alguém desativa uma meta na tela de Metas. */}
      {inactiveKpiCount > 0 && (
        <Link
          to={`/empresa/${company.id}/kpis`}
          className="card flex items-center justify-between gap-3 p-4 text-sm text-content-soft transition hover:border-content-faint hover:bg-hover"
        >
          <span className="flex items-center gap-2">
            <EyeOff className="h-4 w-4 shrink-0 text-content-faint" />
            {inactiveKpiCount} meta(s) desativada(s) — não entram nos números acima.
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-content-faint" />
        </Link>
      )}

      {products.length > 0 && (
        <Card
          title="Produtos"
          description="O valor atual de cada frente — clique pra abrir edições, metas e tarefas dela."
          actions={
            <Link to={`/empresa/${company.id}/produtos`} className="btn-ghost py-1.5 text-xs">
              Gerenciar
            </Link>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => {
              const stats = productStats.get(product.id)
              const indicators = stats?.indicators ?? []
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
                  {indicators.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {indicators.slice(0, 2).map((row) => (
                        <IndicatorLine key={row.kpi_id} row={row} value={effectiveValue(row.kpi_id)} />
                      ))}
                      {indicators.length > 2 && (
                        <p className="text-[11px] text-content-faint">
                          + {indicators.length - 2} meta{indicators.length - 2 > 1 ? 's' : ''}
                        </p>
                      )}
                    </div>
                  )}
                </Link>
              )
            })}
          </div>
        </Card>
      )}

      {/* Pedido do usuário: atalho rápido pra performance de cada
          responsável. Só aparece quem já tem algo pra mostrar — vazio não
          é erro, é "ninguém precisa de atenção agora". */}
      {teamRanking.length > 0 && (
        <Card
          title="Equipe"
          description="Quem tem meta em risco ou tarefa aberta agora — clique pra ver tudo dessa pessoa."
        >
          <ul className="divide-y divide-line">
            {teamRanking.map(({ person, atRisk, overdue, open }) => (
              <li key={person.id}>
                <Link
                  to={`/empresa/${company.id}/equipe/${person.id}`}
                  className="-mx-1 flex items-center gap-3 rounded-md px-1 py-2.5 transition hover:bg-hover"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-hover text-xs font-semibold text-content-muted">
                    {initials(person.full_name || person.email)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-content">{person.full_name}</span>
                    <span className="text-xs text-content-soft">{open} tarefa(s) aberta(s)</span>
                  </span>
                  <span className="flex shrink-0 gap-1.5">
                    {overdue > 0 && <Badge tone="red">{overdue} vencida(s)</Badge>}
                    {atRisk > 0 && <Badge tone="amber">{atRisk} em risco</Badge>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* items-start: por padrão o grid esticaria o cartão do gráfico pra
          bater a altura do cartão "Alvos" ao lado (grid estica os filhos
          pro mesmo tamanho da linha por padrão) — aqui cada um fica do
          tamanho do próprio conteúdo, sem esticar. */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title="Comparação entre produtos"
          description="Faturamento de cada produto por mês, soma das turmas incluída. Só produtos com receita lançada, mesma escala (moeda)."
          actions={
            <Link to={`/empresa/${company.id}/produtos`} className="btn-ghost py-1.5 text-xs">
              Ver Produtos
            </Link>
          }
        >
          {productHistory.products.length === 0 ? (
            <EmptyState
              title="Ainda não há faturamento por produto lançado"
              description="Lance o primeiro valor de faturamento de um produto para comparar aqui."
            />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={productHistory.points} margin={{ top: 20, right: 8, bottom: 0, left: 0 }}>
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 11, fill: chart.tick }}
                    axisLine={{ stroke: chart.axis }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: chart.tick }}
                    axisLine={false}
                    tickLine={false}
                    width={54}
                    tickFormatter={(value: number) => formatCompact(value, 'currency')}
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
                    formatter={(value: number, name: string) => [formatValue(value, 'currency'), name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {productHistory.products.map((product) => (
                    <Line
                      key={product.id}
                      type="monotone"
                      dataKey={product.name}
                      name={product.name}
                      stroke={product.color ?? '#94A3B8'}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card
            title="Alvos"
            description="Alvo, prazo e andamento de cada meta desta empresa."
            actions={
              <>
                {semResponsavelCount > 0 && <Badge tone="amber">{semResponsavelCount} sem responsável</Badge>}
                <Link to={`/empresa/${company.id}/kpis`} className="btn-ghost py-1.5 text-xs">
                  Ver Metas
                </Link>
              </>
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
                        to={`/empresa/${company.id}/kpis/${meta.kpi_id}`}
                        className="block rounded-md -mx-1 px-1 py-0.5 transition hover:bg-hover"
                      >
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span className="min-w-0 truncate">{meta.name}</span>
                          <Badge tone={meta.status === 'at_risk' ? 'amber' : 'slate'}>
                            {GOAL_STATUS_LABEL[meta.status]}
                          </Badge>
                        </div>
                        {ratio !== null && (
                          <div className="mt-1.5">
                            <ProgressBar ratio={ratio} caption={caption} />
                          </div>
                        )}
                      </Link>
                      {/* Fora do Link acima (não dá pra aninhar <a> dentro de
                          <a>) — o nome do responsável é o atalho pra
                          performance dele, clicável à parte. */}
                      <p className="mt-0.5 px-1 text-xs text-content-faint">
                        {meta.owner_id ? (
                          <Link
                            to={`/empresa/${company.id}/equipe/${meta.owner_id}`}
                            className="hover:text-brand-text hover:underline"
                          >
                            {ownerName(meta.owner_id)}
                          </Link>
                        ) : (
                          'Sem responsável'
                        )}{' '}
                        · prazo {formatDate(meta.due_date)} ({relativeDays(meta.due_date)})
                      </p>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/* ------------------------------------------------- gráfico comparativo */}
      <Card
        title="Metas: realizado x alvo"
        description="Quanto cada meta entregou frente ao próprio alvo. A linha marca os 100%."
      >
        {kpiAttainment.length === 0 ? (
          <EmptyState
            title="Nada para comparar ainda"
            description="Defina um alvo e lance ao menos um valor na meta dela."
          />
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={kpiAttainment} margin={{ top: 20, right: 24, bottom: 0, left: 16 }}>
                <XAxis
                  dataKey="nome"
                  tick={{ fontSize: 11, fill: chart.tick }}
                  axisLine={{ stroke: chart.axis }}
                  tickLine={false}
                  interval={0}
                  angle={kpiAttainment.length > 3 ? -20 : 0}
                  textAnchor={kpiAttainment.length > 3 ? 'end' : 'middle'}
                  height={kpiAttainment.length > 3 ? 46 : 24}
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
