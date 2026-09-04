// Painel de produto/turma: o mesmo tipo de retrato que o painel da empresa
// dá pra empresa inteira (indicadores, alvos com status, tarefas,
// orçamento), só que escopado a UMA frente de produto ou a UMA turma dela.
//
// Antes deste painel, a única visão "de uma turma/produto só" era a lista
// de leitura dentro de Produtos (ProductsPage.tsx) — nome + valor de cada
// indicador, sem alvo, sem status, sem tarefas, sem orçamento. Pra ver o
// resto (alvo, prazo, progresso) era preciso abrir cada indicador
// separado dentro de Metas. Pedido explícito do usuário: acompanhar
// faturamento, vendas, ticket médio (etc.) de uma turma/produto juntos,
// numa tela só — este componente reaproveita os mesmos widgets do painel
// da empresa (StatTile/IndicatorLine/ProgressBar), só trocando o escopo
// dos dados.
//
// `tasks` já teve granularidade só de produto (`product_id`), sem
// `product_edition_id` — a seção de tarefas só existia no painel do
// produto. `0039_task_product_edition.sql` fechou essa lacuna: agora uma
// tarefa pode apontar direto pra uma turma, então o painel da turma
// mostra as tarefas DELA (não as do produto inteiro), do mesmo jeito que
// já acontece com indicador, alvo e orçamento.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CalendarRange, ChevronRight, ClipboardList, LayoutDashboard, Square, Target, Wallet } from 'lucide-react'
import { supabase } from '../../core/lib/supabase'
import { attainmentRatio, formatDate, formatValue, isOnTarget, relativeDays } from '../../core/lib/format'
import { buildChildrenByParent, effectiveKpiValue, type RollupRow } from '../../core/lib/kpiRollup'
import { useCompany } from '../../core/company/CompanyProvider'
import { Badge, Card, EmptyState, Loading, PageHeader, ProgressBar, useToast } from '../../core/ui'
import { StatTile, IndicatorLine } from './CompanyDashboard'
import {
  GOAL_STATUS_LABEL,
  PRODUCT_EDITION_STATUS_LABEL,
  TASK_PRIORITY_LABEL,
  type Budget,
  type BudgetItem,
  type GoalStatus,
  type Kpi,
  type KpiDirection,
  type KpiLatestValue,
  type KpiUnit,
  type Meta,
  type Product,
  type ProductEdition,
  type Profile,
  type Task,
} from '../../core/types'

type KpiRow = RollupRow & {
  name: string
  unit: KpiUnit
  direction: KpiDirection
  product_id: string | null
  product_edition_id: string | null
}

/** Mesmo formato de `MetaRow` do painel da empresa (CompanyDashboard.tsx) —
 *  duplicado aqui de propósito: são páginas diferentes, cada uma monta a
 *  própria lista a partir do escopo que lhe interessa. */
type MetaRow = {
  meta_id: string
  kpi_id: string
  name: string
  unit: KpiUnit
  direction: KpiDirection
  target_value: number | null
  due_date: string | null
  owner_id: string | null
  status: GoalStatus
  value: number | null
}

type BudgetItemTotals = Pick<BudgetItem, 'budget_id' | 'kind' | 'planned_amount' | 'actual_amount' | 'status'>

// Turma com início num mês ainda não chegado fica fora da lista abaixo —
// pedido explícito do usuário: uma turma programada pra daqui a alguns
// meses, sem indicador/tarefa/orçamento rodando ainda, só confunde quem
// olha o painel achando que já devia ter dado alguma coisa. Ela aparece
// sozinha assim que o mês do início chegar (comparação por ano+mês, não
// por dia exato — uma turma de 1/9 e uma de 30/9 "chegam" as duas em
// setembro) e nunca mais some depois disso (mesmo passado o fim dela —
// isso já é histórico, não "ainda não começou"). Sem data de início
// definida, não dá pra saber "quando chega" — mostra sempre.
function editionIsUpcoming(edition: ProductEdition): boolean {
  if (!edition.start_date) return false
  const [year, month] = edition.start_date.split('-').map(Number)
  const today = new Date()
  const startOfEditionMonth = new Date(year, month - 1, 1)
  const startOfCurrentMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  return startOfEditionMonth > startOfCurrentMonth
}

export default function ProductDashboard() {
  const { company } = useCompany()
  const { productId, editionId } = useParams<{ productId: string; editionId?: string }>()
  const { notify } = useToast()

  const [product, setProduct] = useState<Product | null>(null)
  const [edition, setEdition] = useState<ProductEdition | null>(null)
  const [editions, setEditions] = useState<ProductEdition[]>([])
  const [kpiDefs, setKpiDefs] = useState<Kpi[]>([])
  const [kpiValues, setKpiValues] = useState<KpiLatestValue[]>([])
  const [metas, setMetas] = useState<Meta[]>([])
  const [people, setPeople] = useState<Profile[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [budgetItems, setBudgetItems] = useState<BudgetItemTotals[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [
      productResult,
      editionResult,
      editionsResult,
      kpiDefResult,
      kpiValueResult,
      metaResult,
      memberResult,
      taskResult,
      budgetResult,
    ] = await Promise.all([
      supabase.from('products').select('*').eq('id', productId).eq('company_id', company.id).maybeSingle(),
      editionId
        ? supabase.from('product_editions').select('*').eq('id', editionId).eq('company_id', company.id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from('product_editions')
        .select('*')
        .eq('product_id', productId)
        .eq('company_id', company.id)
        .order('start_date', { ascending: false, nullsFirst: false }),
      supabase.from('kpis').select('*').eq('company_id', company.id).eq('is_active', true).is('archived_at', null),
      supabase.from('kpi_latest_values').select('*').eq('company_id', company.id).is('archived_at', null),
      supabase.from('metas').select('*').eq('company_id', company.id).is('archived_at', null),
      supabase.from('company_members').select('user_id').eq('company_id', company.id),
      // Granularidade de produto só — ver comentário no topo do arquivo.
      supabase.from('tasks').select('*').eq('company_id', company.id).eq('product_id', productId),
      supabase.from('budgets').select('*').eq('company_id', company.id).eq('product_id', productId),
    ])

    const memberIds = (memberResult.data ?? []).map((row) => row.user_id)
    const { data: profileRows } = memberIds.length
      ? await supabase.from('profiles').select('*').in('id', memberIds)
      : { data: [] as Profile[] }

    const budgetIds = ((budgetResult.data as Budget[]) ?? []).map((b) => b.id)
    const { data: itemRows } = budgetIds.length
      ? await supabase
          .from('budget_items')
          .select('budget_id, kind, planned_amount, actual_amount, status')
          .in('budget_id', budgetIds)
      : { data: [] as BudgetItemTotals[] }

    const productRow = (productResult.data as Product) ?? null
    const editionRow = (editionResult.data as ProductEdition) ?? null

    setProduct(productRow)
    setEdition(editionRow)
    setEditions((editionsResult.data as ProductEdition[]) ?? [])
    setKpiDefs((kpiDefResult.data as Kpi[]) ?? [])
    setKpiValues((kpiValueResult.data as KpiLatestValue[]) ?? [])
    setMetas((metaResult.data as Meta[]) ?? [])
    setPeople((profileRows as Profile[]) ?? [])
    setTasks((taskResult.data as Task[]) ?? [])
    setBudgets((budgetResult.data as Budget[]) ?? [])
    setBudgetItems((itemRows as BudgetItemTotals[]) ?? [])
    // "Não encontrado" cobre tanto id inexistente quanto edição de outro
    // produto (URL adulterada/desatualizada) — nos dois casos não tem o
    // que mostrar.
    setNotFound(!productRow || Boolean(editionId) && (!editionRow || editionRow.product_id !== productId))
    setLoading(false)
  }, [company.id, productId, editionId])

  useEffect(() => {
    void load()
  }, [load])

  const markTaskDone = async (task: Task) => {
    const { error } = await supabase.from('tasks').update({ status: 'done' }).eq('id', task.id)
    if (error) {
      notify(error.message, 'error')
      return
    }
    await load()
  }

  // Mesma cadeia de soma (turma → produto → empresa) de sempre — ver
  // `kpiRollup.ts`. Roda sobre TODOS os indicadores da empresa (não só os
  // deste produto) porque o valor de um nó do meio depende dos filhos dele,
  // que podem estar fora do escopo desta tela.
  const kpiRows = useMemo<KpiRow[]>(
    () =>
      kpiDefs.map((def) => {
        const latest = kpiValues.find((v) => v.kpi_id === def.id)
        return {
          kpi_id: def.id,
          name: def.name,
          unit: def.unit,
          direction: def.direction,
          value: latest ? Number(latest.value) : null,
          product_id: def.product_id,
          product_edition_id: def.product_edition_id,
          parent_kpi_id: def.parent_kpi_id,
        }
      }),
    [kpiDefs, kpiValues],
  )
  const childrenByParent = useMemo(() => buildChildrenByParent(kpiRows), [kpiRows])
  const kpiRowById = useMemo(() => new Map(kpiRows.map((row) => [row.kpi_id, row])), [kpiRows])
  const effectiveValue = useCallback(
    (kpiId: string) => effectiveKpiValue(kpiId, childrenByParent, kpiRowById),
    [childrenByParent, kpiRowById],
  )

  // Escopo desta tela: com edição na URL, é a turma; sem edição, é o
  // indicador PRÓPRIO do produto (as turmas aparecem à parte, na seção
  // "Turmas" — não duplicadas aqui).
  const inScope = useCallback(
    (row: Pick<KpiRow, 'product_id' | 'product_edition_id'>) =>
      edition ? row.product_edition_id === edition.id : row.product_id === productId && row.product_edition_id === null,
    [edition, productId],
  )

  const scopedKpiRows = useMemo(() => kpiRows.filter(inScope), [kpiRows, inScope])

  // "Turmas" (abaixo) só lista quem já chegou — ver editionIsUpcoming.
  const visibleEditions = useMemo(() => editions.filter((item) => !editionIsUpcoming(item)), [editions])
  const upcomingEditionsCount = editions.length - visibleEditions.length

  const metaRows = useMemo<MetaRow[]>(
    () =>
      metas
        .map((meta) => {
          const kpi = kpiRowById.get(meta.kpi_id)
          if (!kpi || !inScope(kpi)) return null
          return {
            meta_id: meta.id,
            kpi_id: meta.kpi_id,
            name: kpi.name,
            unit: kpi.unit,
            direction: kpi.direction,
            target_value: meta.target_value,
            due_date: meta.due_date,
            owner_id: meta.owner_id,
            status: meta.status,
            value: effectiveValue(meta.kpi_id),
          }
        })
        .filter((row): row is MetaRow => row !== null),
    [metas, kpiRowById, inScope, effectiveValue],
  )

  const ownerName = (id: string | null) =>
    id ? (people.find((person) => person.id === id)?.full_name ?? '—') : 'Sem responsável'

  const openMetas = useMemo(
    () => [...metaRows].sort((a, b) => (a.due_date ?? '9999') < (b.due_date ?? '9999') ? -1 : 1),
    [metaRows],
  )

  const stats = useMemo(() => {
    const withValue = metaRows.filter((row) => row.value !== null && row.target_value !== null)
    const onTarget = withValue.filter((row) => isOnTarget(row.value!, row.target_value, row.direction) === true)
    const offTarget = withValue.filter((row) => isOnTarget(row.value!, row.target_value, row.direction) === false)
    return { onTarget, offTarget }
  }, [metaRows])

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

  // Tarefas: no painel do produto, só as do PRÓPRIO produto (sem edição) —
  // as de cada turma aparecem no painel dela, mesmo critério já usado pra
  // orçamento (`budgetsInScope` abaixo) e indicador (`inScope`).
  const tasksInScope = useMemo(
    () =>
      tasks.filter((task) =>
        edition ? task.product_edition_id === edition.id : task.product_edition_id === null,
      ),
    [tasks, edition],
  )
  const openTasks = useMemo(
    () => tasksInScope.filter((task) => ['todo', 'doing', 'blocked'].includes(task.status)),
    [tasksInScope],
  )
  const upcomingTasks = useMemo(
    () =>
      openTasks
        .filter((task) => task.due_date)
        .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))
        .slice(0, 6),
    [openTasks],
  )

  // Orçamento: no painel do produto, só os orçamentos do PRÓPRIO produto
  // (sem edição) — os de cada turma aparecem no painel dela, pra não somar
  // execução de turma dentro do cartão do produto. No painel da turma, só
  // os dela.
  const budgetsInScope = useMemo(
    () => budgets.filter((budget) => (edition ? budget.product_edition_id === edition.id : budget.product_edition_id === null)),
    [budgets, edition],
  )
  const executionByBudget = useMemo(() => {
    const map = new Map<string, { planned: number; actual: number }>()
    for (const item of budgetItems) {
      if (item.kind !== 'despesa' || item.status === 'cancelado') continue
      const entry = map.get(item.budget_id) ?? { planned: 0, actual: 0 }
      entry.planned += Number(item.planned_amount)
      if (item.actual_amount !== null) entry.actual += Number(item.actual_amount)
      map.set(item.budget_id, entry)
    }
    return map
  }, [budgetItems])

  if (loading) return <Loading />

  if (notFound || !product) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title={editionId ? 'Turma não encontrada' : 'Produto não encontrado'}
          description="Pode ter sido excluído, ou o link está desatualizado."
          action={
            <Link to={`/empresa/${company.id}/produtos`} className="btn-primary">
              Ir para Produtos
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm">
        <Link to={`/empresa/${company.id}/produtos`} className="font-medium text-content-soft hover:text-brand-text">
          Produtos
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-content-faint" />
        {edition ? (
          <Link
            to={`/empresa/${company.id}/produtos/${product.id}`}
            className="font-medium text-content-soft hover:text-brand-text"
          >
            {product.name}
          </Link>
        ) : (
          <span className="font-bold text-content">{product.name}</span>
        )}
        {edition && (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-content-faint" />
            <span className="font-bold text-content">{edition.name}</span>
          </>
        )}
      </nav>

      <PageHeader
        title={edition ? edition.name : product.name}
        subtitle={
          edition
            ? `Turma de ${product.name}${edition.start_date ? ` · ${formatDate(edition.start_date)} a ${formatDate(edition.end_date)}` : ''}`
            : product.description || 'Indicadores, alvos, tarefas e orçamento desta frente, juntos.'
        }
        actions={
          <Link to={`/empresa/${company.id}/orcamentos`} className="btn-ghost py-1.5 text-xs">
            <Wallet className="h-3.5 w-3.5" /> Orçamentos
          </Link>
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label="Metas no alvo"
          value={`${stats.onTarget.length}/${stats.onTarget.length + stats.offTarget.length}`}
          hint={`${stats.onTarget.length + stats.offTarget.length} alvo(s) definido(s)`}
          tone={stats.offTarget.length === 0 && stats.onTarget.length > 0 ? 'green' : 'slate'}
          icon={Target}
        />
        <StatTile label="Indicadores" value={scopedKpiRows.length} icon={LayoutDashboard} />
        <StatTile label="Tarefas abertas" value={openTasks.length} icon={ClipboardList} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Indicadores" description="Último valor apurado de cada um.">
          {scopedKpiRows.length === 0 ? (
            <EmptyState
              title="Nenhum indicador vinculado ainda"
              description="Vincule um indicador existente ou crie um novo pela tela de Produtos."
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {scopedKpiRows.map((kpi) => (
                <Link
                  key={kpi.kpi_id}
                  to={`/empresa/${company.id}/kpis/${kpi.kpi_id}`}
                  className="block rounded-lg border border-line p-3 transition hover:border-line-strong hover:bg-hover"
                >
                  <IndicatorLine row={kpi} value={effectiveValue(kpi.kpi_id)} />
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card title="Alvos" description="Alvo, prazo e andamento de cada meta deste escopo.">
          {openMetas.length === 0 ? (
            <p className="text-sm text-content-soft">Nenhum alvo definido aqui ainda.</p>
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
                      <p className="mt-0.5 text-xs text-content-faint">
                        {ownerName(meta.owner_id)}
                        {meta.due_date && ` · prazo ${formatDate(meta.due_date)} (${relativeDays(meta.due_date)})`}
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

      {!edition && editions.length > 0 && (
        <Card
          title="Turmas"
          description="Cada edição desta frente — clique pra abrir o painel completo dela."
        >
          {visibleEditions.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visibleEditions.map((item) => (
                <Link
                  key={item.id}
                  to={`/empresa/${company.id}/produtos/${product.id}/turmas/${item.id}`}
                  className="block rounded-lg border border-line p-3 transition hover:border-line-strong hover:bg-hover"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-medium text-content">{item.name}</p>
                    <Badge tone="slate">{PRODUCT_EDITION_STATUS_LABEL[item.status]}</Badge>
                  </div>
                  {(item.start_date || item.end_date) && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-content-faint">
                      <CalendarRange className="h-3.5 w-3.5" />
                      {item.start_date ? formatDate(item.start_date) : '—'} a{' '}
                      {item.end_date ? formatDate(item.end_date) : '—'}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          )}
          {upcomingEditionsCount > 0 && (
            <p className={`text-xs text-content-faint ${visibleEditions.length > 0 ? 'mt-3' : ''}`}>
              {upcomingEditionsCount} turma(s) programada(s) ainda não aparece(m) aqui — some(m) quando o mês dela(s)
              chegar.
            </p>
          )}
        </Card>
      )}

      <Card
        title="Próximos prazos"
        description={edition ? 'Tarefas abertas desta turma.' : 'Tarefas abertas deste produto.'}
        actions={
            <Link to={`/empresa/${company.id}/tarefas`} className="btn-ghost py-1.5 text-xs">
              Ver Tarefas
            </Link>
          }
        >
          {upcomingTasks.length === 0 ? (
            <p className="text-sm text-content-soft">Nenhuma tarefa com prazo definido.</p>
          ) : (
            <ul className="space-y-2.5">
              {upcomingTasks.map((task) => {
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
                        <span className="text-xs text-content-faint">{TASK_PRIORITY_LABEL[task.priority]}</span>
                      </span>
                    </span>
                    <Badge tone={late ? 'red' : 'slate'}>{relativeDays(task.due_date)}</Badge>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

      {budgetsInScope.length > 0 && (
        <Card title="Orçamento" description="Execução de despesa de cada orçamento deste escopo.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {budgetsInScope.map((budget) => {
              const execution = executionByBudget.get(budget.id)
              const ratio = execution && execution.planned > 0 ? execution.actual / execution.planned : null
              return (
                <div key={budget.id} className="rounded-lg border border-line p-3">
                  <p className="truncate text-sm font-medium text-content">{budget.title}</p>
                  {ratio !== null && execution ? (
                    <div className="mt-2">
                      <ProgressBar
                        ratio={ratio}
                        label="Despesa executada"
                        variant="spend"
                        caption={`${formatValue(execution.actual, 'currency')} de ${formatValue(execution.planned, 'currency')} previstos`}
                      />
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-content-faint">Sem despesa lançada ainda.</p>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </div>
  )
}
