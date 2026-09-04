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
  EyeOff,
  Layers,
  Lock,
  Plus,
  Share2,
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
  formatCompact,
  formatDate,
  formatValue,
  isOnTarget,
  relativeDays,
} from '../../core/lib/format'
import { buildChildrenByParent, effectiveKpiValue, type RollupRow } from '../../core/lib/kpiRollup'
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
  type MetaLatestValue,
  type Product,
  type Task,
  type TaskStatus,
} from '../../core/types'

const OPEN_STATUSES: TaskStatus[] = ['todo', 'doing', 'blocked']

// Só os campos que a cadeia de soma precisa (id, empresa, pai) — o resto
// (nome, unidade...) já vem de kpi_latest_values/meta_latest_values.
type RollupDef = { kpi_id: string; company_id: string; parent_kpi_id: string | null }

// Ponto colorido do gráfico "Metas x realizado" — mesma cor da empresa que
// já aparece em todo canto do sistema (aba, tarja do card…), só que agora
// ligados por uma linha em vez de barras separadas. O raio cresce com a
// quantidade de metas usadas na média (payload.metas) — uma segunda
// informação (volume) no mesmo ponto, sem precisar de outro gráfico ao lado
// só para "quantas metas cada empresa tem".
function attainmentDot(props: any) {
  const { cx, cy, payload, index } = props
  const r = 4 + Math.min(payload.metas ?? 1, 8)
  return <circle key={`dot-${index}`} cx={cx} cy={cy} r={r} fill={payload.cor} stroke="#fff" strokeWidth={1.5} />
}

export default function HoldingDashboard() {
  const { profile, memberships } = useAuth()
  const { notify } = useToast()
  const chart = useChartTheme()
  const [snapshots, setSnapshots] = useState<CompanySnapshot[]>([])
  const [metas, setMetas] = useState<MetaLatestValue[]>([])
  const [kpiValues, setKpiValues] = useState<KpiLatestValue[]>([])
  // Definição de TODO indicador ativo (todo nível, toda empresa) — só pra
  // montar a cadeia de soma (parent_kpi_id). kpi_latest_values (acima) não
  // basta pra isso: só traz quem TEM lançamento direto, e um indicador que
  // só soma filhos (empresa/produto) nunca lança direto — ver kpiRollup.ts.
  const [kpiDefs, setKpiDefs] = useState<RollupDef[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [insights, setInsights] = useState<Insight[]>([])
  const [inactiveKpiCount, setInactiveKpiCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [creatingTask, setCreatingTask] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [
      snapshotResult,
      metaResult,
      kpiValueResult,
      kpiDefResult,
      productResult,
      taskResult,
      insightResult,
      inactiveKpiResult,
    ] = await Promise.all([
      supabase.rpc('company_snapshots'),
      supabase.from('meta_latest_values').select('*').is('archived_at', null),
      // Mesmo padrão acima (sem filtro de empresa, a RLS já entrega só o
      // que enxergo): é a fonte do ranking "Faturamento por produto" —
      // meta_latest_values só traz indicador COM alvo, e um indicador de
      // produto/turma que só soma filhos (ver kpiRollup.ts) costuma não
      // ter alvo próprio nenhum, então não apareceria ali.
      supabase.from('kpi_latest_values').select('*').is('archived_at', null),
      // Cadeia de soma completa (ver comentário do estado kpiDefs acima).
      supabase.from('kpis').select('id, company_id, parent_kpi_id').eq('is_active', true).is('archived_at', null),
      supabase.from('products').select('*').eq('is_active', true),
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
      // Só a contagem, em todo o grupo (a RLS já limita ao que enxergo) —
      // mesmo aviso discreto de CompanyDashboard.tsx.
      supabase.from('kpis').select('id').eq('is_active', false).is('archived_at', null),
    ])

    setSnapshots((snapshotResult.data as CompanySnapshot[]) ?? [])
    // Alvo agora existe em todo nível (empresa/produto/turma — ver tela de
    // Metas), mas os resumos deste painel continuam escopados a alvo de
    // empresa inteira, de propósito — mesma decisão já aplicada em
    // company_snapshots() (o RPC por trás dos totais deste painel).
    setMetas(((metaResult.data as MetaLatestValue[]) ?? []).filter((meta) => meta.product_id === null))
    setKpiValues((kpiValueResult.data as KpiLatestValue[]) ?? [])
    setKpiDefs(
      (kpiDefResult.data as { id: string; company_id: string; parent_kpi_id: string | null }[] ?? []).map(
        (row) => ({ kpi_id: row.id, company_id: row.company_id, parent_kpi_id: row.parent_kpi_id }),
      ),
    )
    setProducts((productResult.data as Product[]) ?? [])
    setTasks((taskResult.data as Task[]) ?? [])
    setInsights((insightResult.data as Insight[]) ?? [])
    setInactiveKpiCount((inactiveKpiResult.data ?? []).length)
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

  // Cadeia de soma (turma → produto → empresa): kpiDefs garante que TODO
  // indicador ativo entra no mapa pai→filhos, mesmo quem nunca lança
  // direto (um indicador de empresa/produto só soma filhos — kpiRollup.ts)
  // — kpi_latest_values sozinho não bastaria, ele só traz quem TEM
  // lançamento próprio. Bug real corrigido aqui: "Faturamento 2026" (e
  // qualquer outro indicador de empresa com produtos/turmas por baixo)
  // sempre aparecia com R$ 0,00 neste painel, porque meta_latest_values.value
  // só reflete lançamento DIRETO no próprio kpi_id — nunca soma os filhos.
  // Mesmo padrão que CompanyDashboard.tsx já usa pro painel de uma empresa
  // só; aqui é a mesma conta, só que com indicadores de todas as empresas
  // juntos (kpi_id é uuid único, não colide entre empresas).
  const rollupRows = useMemo<RollupRow[]>(() => {
    const valueByKpi = new Map(kpiValues.map((row) => [row.kpi_id, Number(row.value)]))
    return kpiDefs.map((def) => ({
      kpi_id: def.kpi_id,
      parent_kpi_id: def.parent_kpi_id,
      value: valueByKpi.get(def.kpi_id) ?? null,
    }))
  }, [kpiDefs, kpiValues])
  const childrenByParent = useMemo(() => buildChildrenByParent(rollupRows), [rollupRows])
  const rollupRowById = useMemo(() => new Map(rollupRows.map((row) => [row.kpi_id, row])), [rollupRows])
  const effectiveValue = useCallback(
    (kpiId: string) => effectiveKpiValue(kpiId, childrenByParent, rollupRowById),
    [childrenByParent, rollupRowById],
  )

  // Toda conta abaixo usa o valor DE VERDADE (soma incluída), nunca o
  // `value` cru de meta_latest_values.
  const metasEffective = useMemo(
    () => metas.map((meta) => ({ ...meta, value: effectiveValue(meta.kpi_id) })),
    [metas, effectiveValue],
  )

  // No-alvo/fora-do-alvo por empresa a partir do valor de verdade —
  // substitui kpis_on_target/kpis_off_target de company_snapshots(), que
  // têm o mesmo problema (contam direto meta_latest_values.value, sem
  // subir a cadeia de soma).
  const targetCountsByCompany = useMemo(() => {
    const map = new Map<string, { onTarget: number; offTarget: number }>()
    for (const meta of metasEffective) {
      if (meta.value === null || meta.target_value === null) continue
      const entry = map.get(meta.company_id) ?? { onTarget: 0, offTarget: 0 }
      if (isOnTarget(meta.value, meta.target_value, meta.direction)) entry.onTarget += 1
      else entry.offTarget += 1
      map.set(meta.company_id, entry)
    }
    return map
  }, [metasEffective])
  const targetCounts = useCallback(
    (companyId: string) => targetCountsByCompany.get(companyId) ?? { onTarget: 0, offTarget: 0 },
    [targetCountsByCompany],
  )

  const totals = useMemo(
    () =>
      operating.reduce(
        (acc, item) => {
          const counts = targetCounts(item.company_id)
          return {
            kpisOnTarget: acc.kpisOnTarget + counts.onTarget,
            kpisOffTarget: acc.kpisOffTarget + counts.offTarget,
            goalsAtRisk: acc.goalsAtRisk + Number(item.goals_at_risk),
            goalsActive: acc.goalsActive + Number(item.goals_active),
            tasksOverdue: acc.tasksOverdue + Number(item.tasks_overdue),
          }
        },
        { kpisOnTarget: 0, kpisOffTarget: 0, goalsAtRisk: 0, goalsActive: 0, tasksOverdue: 0 },
      ),
    [operating, targetCounts],
  )

  // ------------------------------------------------- metas x realizado
  // Metas de empresas diferentes usam unidades diferentes, então somar
  // reais com percentuais não diria nada — o que compara é o atingimento,
  // com a linha de 100% como referência. Direção "menor é melhor" inverte a
  // razão pro mesmo sentido de "acima é melhor".
  const attainment = useMemo(
    () =>
      operating
        .map((company) => {
          const list = metasEffective.filter(
            (meta) =>
              meta.company_id === company.company_id &&
              meta.due_date !== null &&
              meta.target_value !== null &&
              Number(meta.target_value) !== 0 &&
              meta.status !== 'missed' &&
              meta.value !== null,
          )
          if (!list.length) return null

          const percentages = list.map((meta) => {
            const ratio =
              meta.direction === 'up'
                ? meta.value! / Number(meta.target_value)
                : meta.value! > 0
                  ? Number(meta.target_value) / meta.value!
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
    [operating, metasEffective],
  )

  // ------------------------------------------------- metas no alvo por empresa
  // Antes era um gráfico de barras empilhadas só seu, comparando empresas —
  // mas isso já é basicamente a mesma pergunta do "Metas x realizado" acima
  // (quantas metas estão indo bem, por empresa). Em vez de repetir o
  // comparativo, cada cartão de empresa abaixo ganha sua própria barrinha
  // (no alvo / fora / sem lançamento), no lugar exato onde a pessoa já está
  // olhando os detalhes daquela empresa — mapa por company_id, montado uma
  // vez, pra não refazer a conta a cada cartão renderizado.
  const kpiHealthByCompany = useMemo(() => {
    const map = new Map<string, { naMeta: number; fora: number; semLancamento: number; total: number }>()
    for (const company of operating) {
      const total = Number(company.kpis_total)
      if (total === 0) continue
      const { onTarget: naMeta, offTarget: fora } = targetCounts(company.company_id)
      map.set(company.company_id, { naMeta, fora, semLancamento: Math.max(0, total - naMeta - fora), total })
    }
    return map
  }, [operating, targetCounts])

  // ------------------------------------------------- faturamento por produto
  // A pergunta que nenhum gráfico daqui respondia: dentro do grupo inteiro,
  // quais produtos/frentes trazem mais faturamento? Isso não existe em
  // lugar nenhum hoje — cada painel de empresa mostra os produtos DELA, mas
  // nunca um ranking comparando entre empresas.
  //
  // Só dá pra somar valores de indicadores com a MESMA unidade — por isso
  // moeda (currency) apenas, igual à razão de todo outro gráfico deste
  // painel comparar por atingimento (%) em vez de valor bruto.
  //
  // Um indicador com filhos nunca lança valor direto (ver kpiRollup.ts):
  // o "Faturamento" da empresa some seus produtos, e cada produto soma suas
  // turmas. Por isso a soma certa não é "todo indicador com product_id", e
  // sim só as FOLHAS (quem não é pai de mais ninguém neste mesmo conjunto)
  // — soma de folhas é sempre igual ao valor efetivo da raiz, sem precisar
  // saber qual é a raiz nem se ela chegou a lançar algo por conta própria.
  const productRevenue = useMemo(() => {
    const currencyRows = kpiValues.filter((row) => row.unit === 'currency')
    const childrenByParent = buildChildrenByParent(currencyRows)
    const leaves = currencyRows.filter((row) => !childrenByParent.has(row.kpi_id))

    const totalByProduct = new Map<string, number>()
    for (const row of leaves) {
      if (!row.product_id) continue
      totalByProduct.set(row.product_id, (totalByProduct.get(row.product_id) ?? 0) + Number(row.value))
    }

    return products
      .map((product) => {
        const valor = totalByProduct.get(product.id)
        if (!valor) return null
        return {
          id: product.id,
          produto: product.name,
          empresa: companyName(product.company_id),
          cor: companyColor(product.company_id),
          valor,
        }
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 8)
  }, [kpiValues, products, companyName, companyColor])

  // ------------------------------------------------- saúde geral por empresa
  // Uma única barra por empresa, pra bater o olho e já saber como ela anda —
  // média do atingimento de TODA meta com alvo (não só as com prazo, como o
  // gráfico "Metas x realizado" acima, que é sobre metas específicas, não
  // sobre a saúde geral do dia a dia).
  const companyHealth = useMemo(() => {
    const map = new Map<string, number | null>()
    for (const company of operating) {
      const ratios = metasEffective
        .filter(
          (meta) =>
            meta.company_id === company.company_id && meta.target_value !== null && Number(meta.target_value) !== 0,
        )
        .map((meta) => attainmentRatio(meta.value, meta.target_value, meta.direction))
        .filter((ratio): ratio is number => ratio !== null)
      map.set(company.company_id, ratios.length ? ratios.reduce((sum, r) => sum + r, 0) / ratios.length : null)
    }
    return map
  }, [operating, metasEffective])

  // Vencida pesa mais que em risco, que pesa mais que só fora da meta — é a
  // ordem em que um dono do grupo ia querer olhar as empresas primeiro.
  const urgencyScore = (s: CompanySnapshot) =>
    Number(s.tasks_overdue) * 3 + Number(s.goals_at_risk) * 2 + targetCounts(s.company_id).offTarget

  const companyStatus = (s: CompanySnapshot): 'red' | 'amber' | 'green' => {
    if (Number(s.tasks_overdue) > 0 || Number(s.goals_at_risk) > 0) return 'red'
    if (targetCounts(s.company_id).offTarget > 0) return 'amber'
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
  // média entre TODA meta com alvo de TODA empresa operacional.
  const groupHealth = useMemo(() => {
    const ratios = metasEffective
      .filter((meta) => meta.target_value !== null && Number(meta.target_value) !== 0)
      .map((meta) => attainmentRatio(meta.value, meta.target_value, meta.direction))
      .filter((ratio): ratio is number => ratio !== null)
    return {
      ratio: ratios.length ? ratios.reduce((sum, r) => sum + r, 0) / ratios.length : null,
      medidos: ratios.length,
    }
  }, [metasEffective])

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
            <Link to="/holding/notas" className="btn-ghost py-1.5 text-xs">
              <StickyNote className="h-3.5 w-3.5" /> Notas
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
                caption={`média de atingimento em ${groupHealth.medidos} alvo(s) definido(s), em todas as empresas`}
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
                  Metas no alvo
                </p>
                <p className="mt-2 text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
                  {totals.kpisOnTarget}
                  <span className="text-base font-normal text-content-faint">
                    /{totals.kpisOnTarget + totals.kpisOffTarget}
                  </span>
                </p>
                <p className="text-xs text-content-soft">alvos definidos</p>
              </div>,
              <div key="metas" className="card p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-content-soft">
                  Alvos em risco
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

          {/* Aviso discreto — mesmo padrão de CompanyDashboard.tsx: não traz
              os dados de volta, só avisa que existem (evita a sensação de
              "sumiu sem explicação" quando alguém desativa uma meta). Sem
              link pra uma meta específica (são várias empresas possíveis) —
              cada uma tem a própria tela de Metas onde reativar. */}
          {inactiveKpiCount > 0 && (
            <div className="card flex items-center gap-2 p-4 text-sm text-content-soft">
              <EyeOff className="h-4 w-4 shrink-0 text-content-faint" />
              {inactiveKpiCount} meta(s) desativada(s) no grupo — não entram nos números acima.
            </div>
          )}

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
            description="Quanto do alvo já foi entregue, na média das metas de cada empresa. O tamanho do ponto cresce com a quantidade de metas na conta — a linha marca os 100%."
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
                      label={{ value: 'alvo', position: 'right', fontSize: 10, fill: chart.tick }}
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

          {/* ------------------------------------------- faturamento por produto —
              o comparativo "no alvo / fora / sem lançamento" que morava aqui
              como gráfico próprio virou uma barrinha compacta dentro de cada
              cartão de empresa, logo abaixo (mesma informação, sem repetir a
              pergunta do gráfico "Metas x realizado" acima). No lugar entra
              uma pergunta nova: quais produtos, de qualquer empresa do
              grupo, mais faturam — do maior pro menor. */}
          <Card
            title="Faturamento por produto no grupo"
            description="Soma do faturamento de cada produto — turmas/edições incluídas — em todas as empresas. Cor da barra = empresa dona do produto. Do maior pro menor."
          >
            {productRevenue.length === 0 ? (
              <EmptyState
                title="Nenhum produto com faturamento lançado ainda"
                description="Lance o primeiro valor de faturamento de um produto para ver o ranking do grupo aqui."
              />
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={productRevenue}
                    layout="vertical"
                    margin={{ top: 8, right: 44, bottom: 0, left: 0 }}
                  >
                    <XAxis
                      type="number"
                      tick={{ fontSize: 11, fill: chart.tick }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(value: number) => formatCompact(value, 'currency')}
                    />
                    <YAxis
                      type="category"
                      dataKey="produto"
                      tick={{ fontSize: 11, fill: chart.tick }}
                      axisLine={{ stroke: chart.axis }}
                      tickLine={false}
                      width={100}
                      interval={0}
                      tickFormatter={(value: string) => (value.length > 14 ? `${value.slice(0, 13)}…` : value)}
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
                      formatter={(value: number, _name, item: any) => [
                        formatValue(value, 'currency'),
                        item.payload.empresa,
                      ]}
                    />
                    <Bar dataKey="valor" radius={[0, 4, 4, 0]} maxBarSize={26}>
                      {productRevenue.map((row) => (
                        <Cell key={row.id} fill={row.cor} />
                      ))}
                      <LabelList
                        dataKey="valor"
                        position="right"
                        formatter={(value: number) => formatCompact(value, 'currency')}
                        style={{ fontSize: 11, fill: chart.label }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* -------------------------------------------- cartão por empresa —
              a que precisa de mais atenção vem primeiro (mais vencida,
              metas em risco, meta fora do alvo), não em ordem alfabética */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {byUrgency.map((snapshot) => {
              const companyMetas = metasEffective.filter((meta) => meta.company_id === snapshot.company_id)
              const health = companyHealth.get(snapshot.company_id) ?? null
              const targetSplit = kpiHealthByCompany.get(snapshot.company_id) ?? null
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
                                  ? 'Alguma meta fora do alvo'
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

                  {/* Barrinha compacta no alvo/fora/sem lançamento — o que
                      antes só dava pra ver no gráfico "Metas no alvo por
                      empresa" lá em cima, agora mora junto do resto dos
                      números desta empresa. */}
                  {targetSplit !== null && (
                    <div className="mt-3">
                      <div className="flex h-1.5 overflow-hidden rounded-full bg-hover">
                        {targetSplit.naMeta > 0 && (
                          <div
                            className="bg-emerald-500"
                            style={{ width: `${(targetSplit.naMeta / targetSplit.total) * 100}%` }}
                          />
                        )}
                        {targetSplit.fora > 0 && (
                          <div
                            className="bg-rose-500"
                            style={{ width: `${(targetSplit.fora / targetSplit.total) * 100}%` }}
                          />
                        )}
                        {targetSplit.semLancamento > 0 && (
                          <div
                            className="bg-slate-300 dark:bg-slate-600"
                            style={{ width: `${(targetSplit.semLancamento / targetSplit.total) * 100}%` }}
                          />
                        )}
                      </div>
                      <p className="mt-1 text-[11px] text-content-faint">
                        {targetSplit.naMeta} no alvo · {targetSplit.fora} fora · {targetSplit.semLancamento} sem
                        lançamento
                      </p>
                    </div>
                  )}

                  <div className="mt-4 grid grid-cols-2 gap-3 text-center sm:grid-cols-3">
                    <div className="rounded-lg bg-hover py-2">
                      <p className="text-lg font-semibold">
                        {targetCounts(snapshot.company_id).onTarget}
                        <span className="text-xs font-normal text-content-faint">
                          /{targetCounts(snapshot.company_id).onTarget + targetCounts(snapshot.company_id).offTarget}
                        </span>
                      </p>
                      <p className="text-xs text-content-soft">Metas no alvo</p>
                    </div>
                    <div className="rounded-lg bg-hover py-2">
                      <p className="text-lg font-semibold">{snapshot.goals_active}</p>
                      <p className="text-xs text-content-soft">alvos ativos</p>
                    </div>
                    <div className="col-span-2 rounded-lg bg-hover py-2 sm:col-span-1">
                      <p className="text-lg font-semibold">{snapshot.tasks_open}</p>
                      <p className="text-xs text-content-soft">tarefas abertas</p>
                    </div>
                  </div>

                  {companyMetas.length > 0 && (
                    <ul className="mt-4 space-y-2">
                      {companyMetas.slice(0, 4).map((meta) => {
                        // meta.value pode ser null de verdade (nenhum
                        // lançamento em nenhum nível da cadeia ainda) —
                        // Number(null) virava 0 aqui, fazendo uma meta sem
                        // nenhum dado aparecer como "fora do alvo" (vermelho)
                        // e "R$ 0,00", em vez de neutra e sem valor exibido.
                        const status =
                          meta.value !== null ? isOnTarget(meta.value, meta.target_value, meta.direction) : null
                        const ratio =
                          meta.value !== null ? attainmentRatio(meta.value, meta.target_value, meta.direction) : null
                        const caption =
                          meta.target_value !== null
                            ? `${formatValue(meta.value, meta.unit)} de ${formatValue(meta.target_value, meta.unit)}`
                            : undefined
                        return (
                          <li key={meta.meta_id}>
                            <Link
                              to={`/empresa/${snapshot.company_id}/kpis/${meta.kpi_id}`}
                              className="block rounded-md -mx-1.5 px-1.5 py-1 transition hover:bg-hover"
                            >
                              <div className="flex items-center justify-between gap-2 text-sm">
                                <span className="min-w-0 truncate text-content-muted">
                                  {meta.name}
                                  {meta.due_date && (
                                    <span className="ml-1.5 text-[11px] text-content-faint">
                                      · prazo {formatDate(meta.due_date)}
                                    </span>
                                  )}
                                </span>
                                <span
                                  className={`shrink-0 font-medium ${
                                    status === false ? 'text-rose-600 dark:text-rose-400' : 'text-content'
                                  }`}
                                >
                                  {formatValue(meta.value, meta.unit)}
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
