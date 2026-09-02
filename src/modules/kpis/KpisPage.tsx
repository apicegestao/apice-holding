// KPIs e metas da empresa — a mesma coisa: cadastro, lançamento por período,
// histórico e, quando o indicador tem prazo, quem responde e como está indo.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Archive,
  ArchiveRestore,
  ArrowDownRight,
  ArrowUpRight,
  CalendarRange,
  History,
  Layers,
  Pencil,
  Plus,
  Trash2,
  TrendingUp,
} from 'lucide-react'
import {
  CartesianGrid,
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
  labelPeriod,
  periodBounds,
  relativeDays,
} from '../../core/lib/format'
import { useAuth } from '../../core/auth/AuthProvider'
import { useCompany } from '../../core/company/CompanyProvider'
import { useChartTheme } from '../../core/theme/ThemeProvider'
import {
  Badge,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorText,
  Field,
  Loading,
  Modal,
  NumberInput,
  PageHeader,
  ProgressBar,
  Spinner,
  useConfirmDelete,
  useToast,
} from '../../core/ui'
import { KPI_CATEGORIES, type KpiTemplate } from '../../core/catalog'
import KpiSuggestions from './KpiSuggestions'
import {
  FINER_FREQUENCIES,
  FREQUENCIES,
  FREQUENCY_LABEL,
  GOAL_STATUS_LABEL,
  UNIT_LABEL,
  type GoalStatus,
  type Kpi,
  type KpiCheckpoint,
  type KpiDirection,
  type KpiFrequency,
  type KpiUnit,
  type KpiValue,
  type KpiValueEntry,
  type Product,
  type ProductEdition,
  type Profile,
} from '../../core/types'

const UNITS: KpiUnit[] = ['currency', 'percent', 'number', 'days', 'ratio']
const STATUSES: GoalStatus[] = ['planned', 'active', 'at_risk', 'achieved', 'missed']

function statusTone(status: GoalStatus) {
  if (status === 'achieved') return 'green'
  if (status === 'at_risk') return 'amber'
  if (status === 'missed') return 'red'
  return 'slate'
}

const emptyKpi = {
  name: '',
  description: '',
  category: '',
  unit: 'number' as KpiUnit,
  direction: 'up' as KpiDirection,
  frequency: 'monthly' as KpiFrequency,
  target_value: null as number | null,
  is_active: true,
  due_date: '',
  owner_id: '',
  status: 'active' as GoalStatus,
  product_id: '',
  product_edition_id: '',
  entry_frequency: '' as KpiFrequency | '',
  parent_kpi_id: '',
}

export default function KpisPage() {
  const { company, canWrite } = useCompany()
  const { notify } = useToast()
  const chart = useChartTheme()
  const [searchParams, setSearchParams] = useSearchParams()

  const [kpis, setKpis] = useState<Kpi[]>([])
  const [values, setValues] = useState<KpiValue[]>([])
  const [entries, setEntries] = useState<KpiValueEntry[]>([])
  const [people, setPeople] = useState<Profile[]>([])
  const [checkpoints, setCheckpoints] = useState<KpiCheckpoint[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [editions, setEditions] = useState<ProductEdition[]>([])
  const [productFilter, setProductFilter] = useState('')
  // Arquivados ficam num ambiente à parte — só aparece a aba quando existe
  // pelo menos um, pra não acrescentar nada na tela de quem nunca arquivou.
  const [showArchived, setShowArchived] = useState(false)
  const [loading, setLoading] = useState(true)

  const [kpiForm, setKpiForm] = useState(emptyKpi)
  const [editingKpi, setEditingKpi] = useState<Kpi | null>(null)
  const [creatingKpi, setCreatingKpi] = useState(false)
  const [createMode, setCreateMode] = useState<'suggestions' | 'custom'>('suggestions')
  const [chosen, setChosen] = useState<KpiTemplate[]>([])
  const [removingKpi, setRemovingKpi] = useState<Kpi | null>(null)
  const [entryFor, setEntryFor] = useState<Kpi | null>(null)
  const [historyFor, setHistoryFor] = useState<Kpi | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: kpiRows }, { data: memberRows }, { data: productRows }, { data: editionRows }] =
      await Promise.all([
        supabase
          .from('kpis')
          .select('*')
          .eq('company_id', company.id)
          .order('display_order')
          .order('name'),
        supabase.from('company_members').select('user_id').eq('company_id', company.id),
        supabase.from('products').select('*').eq('company_id', company.id).eq('is_active', true).order('display_order'),
        supabase.from('product_editions').select('*').eq('company_id', company.id),
      ])

    const ids = (kpiRows ?? []).map((row) => row.id)
    const [{ data: valueRows }, { data: checkpointRows }, { data: entryRows }] = await Promise.all([
      ids.length
        ? supabase.from('kpi_values').select('*').in('kpi_id', ids).order('period_start', { ascending: true })
        : Promise.resolve({ data: [] as KpiValue[] }),
      ids.length
        ? supabase.from('kpi_checkpoints').select('*').in('kpi_id', ids).order('seq', { ascending: true })
        : Promise.resolve({ data: [] as KpiCheckpoint[] }),
      ids.length
        ? supabase
            .from('kpi_value_entries')
            .select('*')
            .in('kpi_id', ids)
            .order('period_start', { ascending: true })
        : Promise.resolve({ data: [] as KpiValueEntry[] }),
    ])

    const memberIds = (memberRows ?? []).map((row) => row.user_id)
    const { data: profileRows } = memberIds.length
      ? await supabase.from('profiles').select('*').in('id', memberIds)
      : { data: [] as Profile[] }

    setKpis((kpiRows as Kpi[]) ?? [])
    setValues((valueRows as KpiValue[]) ?? [])
    setEntries((entryRows as KpiValueEntry[]) ?? [])
    setCheckpoints((checkpointRows as KpiCheckpoint[]) ?? [])
    setPeople((profileRows as Profile[]) ?? [])
    setProducts((productRows as Product[]) ?? [])
    setEditions((editionRows as ProductEdition[]) ?? [])
    setLoading(false)
  }, [company.id])

  useEffect(() => {
    void load()
  }, [load])

  // Acesso rápido vindo do painel: ?kpi=<id> rola até o cartão certo e
  // destaca por alguns segundos, em vez de deixar a pessoa procurar na lista.
  const focusKpiId = searchParams.get('kpi')
  const [highlightedKpiId, setHighlightedKpiId] = useState<string | null>(null)

  useEffect(() => {
    if (!focusKpiId || loading) return
    const el = document.getElementById(`kpi-${focusKpiId}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightedKpiId(focusKpiId)
    const timer = setTimeout(() => setHighlightedKpiId(null), 2500)
    return () => clearTimeout(timer)
  }, [focusKpiId, loading])

  const seriesByKpi = useMemo(() => {
    const map = new Map<string, KpiValue[]>()
    for (const value of values) {
      const list = map.get(value.kpi_id) ?? []
      list.push(value)
      map.set(value.kpi_id, list)
    }
    return map
  }, [values])

  const openCreate = (prefill?: Partial<typeof emptyKpi>) => {
    setKpiForm({ ...emptyKpi, ...prefill })
    setChosen([])
    // Vindo de um atalho com produto/edição já escolhidos, pula direto pro
    // formulário — a lista de sugestões não sabe de produto, não ajuda aqui.
    setCreateMode(prefill ? 'custom' : 'suggestions')
    setError('')
    setCreatingKpi(true)
  }

  // Atalho vindo da tela de Produtos: "+ Nova meta" leva pra cá com
  // ?novo=1&product_id=X (e, se for de uma turma, &product_edition_id=Y) —
  // abre o formulário já com o produto/edição certos, sem a pessoa ter que
  // escolher nada de novo. Os parâmetros somem da URL assim que consumidos,
  // pra um F5 não abrir o formulário de novo sozinho.
  useEffect(() => {
    if (loading || searchParams.get('novo') !== '1') return
    const productId = searchParams.get('product_id') ?? ''
    const editionId = searchParams.get('product_edition_id') ?? ''
    openCreate({
      product_id: products.some((item) => item.id === productId) ? productId : '',
      product_edition_id: editions.some((item) => item.id === editionId) ? editionId : '',
    })
    const next = new URLSearchParams(searchParams)
    next.delete('novo')
    next.delete('product_id')
    next.delete('product_edition_id')
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, searchParams, products, editions])

  const closeCreate = () => {
    setCreatingKpi(false)
    setEditingKpi(null)
    setChosen([])
  }

  const toggleTemplate = (template: KpiTemplate) => {
    setChosen((current) =>
      current.some((item) => item.name === template.name)
        ? current.filter((item) => item.name !== template.name)
        : [...current, template],
    )
  }

  /** Sugestões viram KPIs de uma vez, prontos para receber valores. */
  const addChosen = async () => {
    if (!chosen.length) return
    setError('')
    setBusy(true)
    const { error: insertError } = await supabase.from('kpis').insert(
      chosen.map((template, index) => ({
        company_id: company.id,
        name: template.name,
        description: template.description,
        category: template.category,
        unit: template.unit,
        direction: template.direction,
        frequency: template.frequency,
        display_order: kpis.length + index,
      })),
    )
    setBusy(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    notify(
      chosen.length === 1
        ? `${chosen[0].name} adicionado.`
        : `${chosen.length} indicadores adicionados.`,
    )
    closeCreate()
    await load()
  }

  const openEdit = (kpi: Kpi) => {
    setKpiForm({
      name: kpi.name,
      description: kpi.description ?? '',
      category: kpi.category ?? '',
      unit: kpi.unit,
      direction: kpi.direction,
      frequency: kpi.frequency,
      target_value: kpi.target_value,
      is_active: kpi.is_active,
      due_date: kpi.due_date ?? '',
      owner_id: kpi.owner_id ?? '',
      status: kpi.status,
      product_id: kpi.product_id ?? '',
      product_edition_id: kpi.product_edition_id ?? '',
      entry_frequency: kpi.entry_frequency ?? '',
      parent_kpi_id: kpi.parent_kpi_id ?? '',
    })
    setError('')
    setEditingKpi(kpi)
  }

  const submitKpi = async (event: FormEvent) => {
    event.preventDefault()
    setError('')

    const payload = {
      company_id: company.id,
      name: kpiForm.name.trim(),
      description: kpiForm.description.trim() || null,
      category: kpiForm.category.trim() || null,
      unit: kpiForm.unit,
      direction: kpiForm.direction,
      frequency: kpiForm.frequency,
      target_value: kpiForm.target_value,
      is_active: kpiForm.is_active,
      due_date: kpiForm.due_date || null,
      owner_id: kpiForm.owner_id || null,
      status: kpiForm.status,
      product_id: kpiForm.product_id || null,
      // Edição só faz sentido junto do produto — trocar o produto e deixar
      // a edição antiga presa nele seria o mesmo bug que a guarda no banco
      // (assert_kpi_product) já rejeitaria; melhor nem tentar gravar.
      product_edition_id: kpiForm.product_id ? kpiForm.product_edition_id || null : null,
      // Só faz sentido lançar em cadência mais fina quando ela existe pra
      // essa frequência — se a pessoa trocou a frequência depois de escolher
      // uma cadência que não cabe mais nela, descarta em vez de gravar lixo.
      entry_frequency:
        kpiForm.entry_frequency && FINER_FREQUENCIES[kpiForm.frequency].includes(kpiForm.entry_frequency)
          ? kpiForm.entry_frequency
          : null,
      // "Contribui para" existe pra turma (soma no produto) e pra produto
      // (soma numa meta da empresa) — não pra um KPI sem produto nenhum.
      parent_kpi_id: kpiForm.product_id ? kpiForm.parent_kpi_id || null : null,
    }

    if (!payload.name) {
      setError('Dê um nome ao indicador.')
      return
    }

    setBusy(true)
    const result = editingKpi
      ? await supabase.from('kpis').update(payload).eq('id', editingKpi.id)
      : await supabase.from('kpis').insert(payload)
    setBusy(false)

    if (result.error) {
      setError(
        result.error.code === '23505'
          ? 'Já existe um KPI com esse nome nesta empresa.'
          : result.error.message,
      )
      return
    }

    notify(editingKpi ? 'KPI atualizado.' : 'KPI criado.')
    setCreatingKpi(false)
    setEditingKpi(null)
    await load()
  }

  const removeKpi = async () => {
    if (!removingKpi) return
    setBusy(true)
    const { error: deleteError } = await supabase.from('kpis').delete().eq('id', removingKpi.id)
    setBusy(false)
    if (deleteError) {
      notify(deleteError.message, 'error')
      return
    }
    notify('KPI excluído.')
    setRemovingKpi(null)
    await load()
  }

  // Arquivar não some com nada — só tira da tela de ativos. O sistema já
  // arquiva sozinho quando o prazo passa; isto é só a versão manual, com o
  // desfazer sempre à mão na aba de arquivados.
  const archiveKpi = async (kpi: Kpi) => {
    const { error } = await supabase.from('kpis').update({ archived_at: new Date().toISOString() }).eq('id', kpi.id)
    if (error) {
      notify(error.message, 'error')
      return
    }
    notify('KPI arquivado.')
    await load()
  }

  const unarchiveKpi = async (kpi: Kpi) => {
    const { error } = await supabase.from('kpis').update({ archived_at: null }).eq('id', kpi.id)
    if (error) {
      notify(error.message, 'error')
      return
    }
    notify('KPI reativado.')
    await load()
  }

  const ownerName = (id: string | null) =>
    id ? (people.find((person) => person.id === id)?.full_name ?? '—') : null

  const productName = (id: string | null) => (id ? products.find((item) => item.id === id)?.name : null) ?? null
  const editionsForProduct = (productId: string) =>
    editions.filter((edition) => edition.product_id === productId)

  // Checagem por "verdadeiro" (não por === null) de propósito: em dado
  // vindo de fora do banco de verdade (ex. simulação de teste) o campo pode
  // vir ausente (undefined) em vez de nulo — mesmo padrão que product_id já
  // usa aqui embaixo, pra não tratar "campo faltando" como "arquivado".
  const archivedKpis = useMemo(() => kpis.filter((kpi) => Boolean(kpi.archived_at)), [kpis])

  const visibleKpis = useMemo(() => {
    const byArchiveTab = kpis.filter((kpi) => (showArchived ? Boolean(kpi.archived_at) : !kpi.archived_at))
    return productFilter ? byArchiveTab.filter((kpi) => kpi.product_id === productFilter) : byArchiveTab
  }, [kpis, productFilter, showArchived])

  const checkpointsByKpi = useMemo(() => {
    const map = new Map<string, KpiCheckpoint[]>()
    for (const checkpoint of checkpoints) {
      const list = map.get(checkpoint.kpi_id) ?? []
      list.push(checkpoint)
      map.set(checkpoint.kpi_id, list)
    }
    return map
  }, [checkpoints])

  const entriesByKpi = useMemo(() => {
    const map = new Map<string, KpiValueEntry[]>()
    for (const entry of entries) {
      const list = map.get(entry.kpi_id) ?? []
      list.push(entry)
      map.set(entry.kpi_id, list)
    }
    return map
  }, [entries])

  // Produto pai (ex. "Entre Donos") e seus sub-produtos (turmas) — cada
  // filho soma pro pai. Guardado pelos dois lados: quem são os filhos de
  // cada pai, pra calcular a soma e pra agrupar visualmente na lista.
  const childrenByParent = useMemo(() => {
    const map = new Map<string, Kpi[]>()
    for (const kpi of kpis) {
      if (!kpi.parent_kpi_id) continue
      const list = map.get(kpi.parent_kpi_id) ?? []
      list.push(kpi)
      map.set(kpi.parent_kpi_id, list)
    }
    return map
  }, [kpis])

  /** Valor "de verdade" de um KPI: se ele tem filhos, é a soma dos valores
   *  deles (recursivo); senão, é o último valor lançado direto nele. Existe
   *  pra cadeia de mais de dois níveis (turma → produto → empresa): o nó do
   *  meio ("produto") nunca lança direto — o valor que ele repassa pro avô é
   *  sempre a própria soma dos filhos, nunca um número solto que porventura
   *  exista nele. `seen` só existe por segurança (o banco já impede ciclo). */
  const effectiveValue = useCallback(
    (kpiId: string, seen: Set<string> = new Set()): number | null => {
      if (seen.has(kpiId)) return null
      seen.add(kpiId)
      const children = childrenByParent.get(kpiId)
      if (children?.length) {
        let total = 0
        let any = false
        for (const child of children) {
          const value = effectiveValue(child.id, seen)
          if (value !== null) {
            total += value
            any = true
          }
        }
        return any ? total : null
      }
      const series = seriesByKpi.get(kpiId) ?? []
      const latest = series[series.length - 1]
      return latest ? Number(latest.value) : null
    },
    [childrenByParent, seriesByKpi],
  )

  /** Soma o valor de cada sub-produto — o valor "oficial" do pai é essa
   *  soma, não um lançamento próprio nele. */
  const rollupFor = useCallback(
    (kpiId: string) => {
      const children = childrenByParent.get(kpiId)
      if (!children?.length) return null
      let value = 0
      let reported = 0
      for (const child of children) {
        const childValue = effectiveValue(child.id)
        if (childValue !== null) {
          value += childValue
          reported += 1
        }
      }
      return { value, total: children.length, reported, children }
    },
    [childrenByParent, effectiveValue],
  )

  // Lista final: cada pai visível é seguido imediatamente da própria
  // cadeia de descendentes (filhos, netos...) — assim dá pra acompanhar o
  // produto e suas turmas juntos, em vez de espalhados pela ordem
  // alfabética. Recursivo de propósito: a cadeia pode ter mais de dois
  // níveis (turma → produto → empresa).
  const groupedKpis = useMemo(() => {
    const visibleIds = new Set(visibleKpis.map((kpi) => kpi.id))
    const seen = new Set<string>()
    const ordered: Kpi[] = []
    const visit = (kpi: Kpi) => {
      if (seen.has(kpi.id)) return
      ordered.push(kpi)
      seen.add(kpi.id)
      for (const child of childrenByParent.get(kpi.id) ?? []) {
        if (visibleIds.has(child.id)) visit(child)
      }
    }
    for (const kpi of visibleKpis) {
      if (kpi.parent_kpi_id && visibleIds.has(kpi.parent_kpi_id)) continue
      visit(kpi)
    }
    return ordered
  }, [visibleKpis, childrenByParent])

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={`Metas · ${company.name}`}
        subtitle="Indicadores desta empresa. Um KPI com prazo já é a meta — com responsável e andamento."
        actions={
          <>
            {products.length > 0 && (
              <select
                className="input w-auto"
                value={productFilter}
                onChange={(event) => setProductFilter(event.target.value)}
                aria-label="Filtrar por produto"
              >
                <option value="">Todos os produtos</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            )}
            {canWrite && !showArchived && (
              <button type="button" className="btn-primary" onClick={() => openCreate()}>
                <Plus className="h-4 w-4" /> Novo KPI
              </button>
            )}
          </>
        }
      />

      {/* Arquivados vivem num ambiente à parte — a aba só existe quando há
          pelo menos um, pra não acrescentar nada em quem nunca arquivou. */}
      {archivedKpis.length > 0 && (
        <div className="mb-4 inline-flex rounded-lg border border-line-strong p-0.5 text-sm">
          <button
            type="button"
            onClick={() => setShowArchived(false)}
            className={`rounded-md px-3 py-1.5 font-medium transition ${
              !showArchived ? 'bg-brand/10 text-brand-text' : 'text-content-muted hover:bg-hover'
            }`}
          >
            Ativos
          </button>
          <button
            type="button"
            onClick={() => setShowArchived(true)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition ${
              showArchived ? 'bg-brand/10 text-brand-text' : 'text-content-muted hover:bg-hover'
            }`}
          >
            <Archive className="h-3.5 w-3.5" /> Arquivados ({archivedKpis.length})
          </button>
        </div>
      )}

      {loading ? (
        <Loading />
      ) : kpis.length === 0 ? (
        <EmptyState
          title="Nenhum indicador ainda"
          description="Comece pelos números que você olharia primeiro se pudesse ver só três."
          action={
            canWrite && (
              <button type="button" className="btn-primary" onClick={() => openCreate()}>
                <Plus className="h-4 w-4" /> Novo KPI
              </button>
            )
          }
        />
      ) : visibleKpis.length === 0 ? (
        <EmptyState
          title={showArchived ? 'Nenhum KPI arquivado' : 'Nenhum KPI neste produto'}
          description={
            showArchived
              ? 'Indicadores arquivados (manualmente ou por prazo vencido) aparecem aqui.'
              : 'Troque o filtro ou cadastre um indicador vinculado a este produto.'
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groupedKpis.map((kpi) => {
            const series = seriesByKpi.get(kpi.id) ?? []
            const latest = series[series.length - 1]
            const previous = series[series.length - 2]
            // Um KPI pai não lança valor direto — o número dele é a soma do
            // último valor de cada sub-produto.
            const rollup = rollupFor(kpi.id)
            const parent = kpi.parent_kpi_id ? kpis.find((item) => item.id === kpi.parent_kpi_id) : null
            const displayValue = rollup ? rollup.value : latest ? Number(latest.value) : null
            const onTarget = displayValue !== null ? isOnTarget(displayValue, kpi.target_value, kpi.direction) : null
            const ratio = displayValue !== null ? attainmentRatio(displayValue, kpi.target_value, kpi.direction) : null
            const delta =
              !rollup && latest && previous ? Number(latest.value) - Number(previous.value) : null
            const improving =
              delta === null ? null : kpi.direction === 'up' ? delta >= 0 : delta <= 0

            const chartData = series.slice(-12).map((item) => ({
              label: labelPeriod(item.period_start, kpi.frequency),
              value: Number(item.value),
            }))

            return (
              <Card
                key={kpi.id}
                id={`kpi-${kpi.id}`}
                className={`${kpi.is_active ? '' : 'opacity-60'} ${
                  highlightedKpiId === kpi.id ? 'ring-2 ring-brand-500 transition-shadow' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-content">{kpi.name}</p>
                    <p className="text-xs text-content-soft">
                      {kpi.category ? `${kpi.category} · ` : ''}
                      {FREQUENCY_LABEL[kpi.frequency]}
                      {kpi.entry_frequency && ` · lançado por ${FREQUENCY_LABEL[kpi.entry_frequency].toLowerCase()}`}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {kpi.product_id && (
                        <Badge tone="violet">
                          {productName(kpi.product_id)}
                          {kpi.product_edition_id &&
                            ` · ${editions.find((edition) => edition.id === kpi.product_edition_id)?.name ?? ''}`}
                        </Badge>
                      )}
                      {rollup && (
                        <Badge tone="blue">
                          <Layers className="mr-1 inline h-3 w-3" />
                          soma {rollup.reported}/{rollup.total} sub-produtos
                        </Badge>
                      )}
                      {parent && <Badge tone="slate">contribui p/ {parent.name}</Badge>}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-content-faint hover:bg-hover hover:text-content"
                      title="Histórico"
                      onClick={() => setHistoryFor(kpi)}
                    >
                      <History className="h-4 w-4" />
                    </button>
                    {canWrite && (
                      <>
                        <button
                          type="button"
                          className="rounded-md p-1.5 text-content-faint hover:bg-hover hover:text-content"
                          title="Editar"
                          onClick={() => openEdit(kpi)}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        {kpi.archived_at ? (
                          <button
                            type="button"
                            className="rounded-md p-1.5 text-content-faint hover:bg-hover hover:text-content"
                            title="Reativar"
                            onClick={() => void unarchiveKpi(kpi)}
                          >
                            <ArchiveRestore className="h-4 w-4" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="rounded-md p-1.5 text-content-faint hover:bg-hover hover:text-content"
                            title="Arquivar"
                            onClick={() => void archiveKpi(kpi)}
                          >
                            <Archive className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          className="rounded-md p-1.5 text-content-faint hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400"
                          title="Excluir"
                          onClick={() => setRemovingKpi(kpi)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex items-end justify-between gap-2">
                  <div>
                    <p className="text-2xl font-semibold text-content">
                      {displayValue !== null ? formatValue(displayValue, kpi.unit) : '—'}
                    </p>
                    <p className="text-xs text-content-soft">
                      {rollup
                        ? 'soma atual dos sub-produtos'
                        : latest
                          ? labelPeriod(latest.period_start, kpi.frequency)
                          : 'sem lançamento'}
                      {kpi.target_value !== null && (
                        <> · meta {formatValue(kpi.target_value, kpi.unit)}</>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {onTarget !== null && (
                      <Badge tone={onTarget ? 'green' : 'red'}>
                        {onTarget ? 'na meta' : 'fora da meta'}
                      </Badge>
                    )}
                    {delta !== null && (
                      <span
                        className={`flex items-center gap-0.5 text-xs font-medium ${
                          improving ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {improving ? (
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowDownRight className="h-3.5 w-3.5" />
                        )}
                        {formatValue(Math.abs(delta), kpi.unit)}
                      </span>
                    )}
                  </div>
                </div>

                {rollup && (
                  <ul className="mt-2 space-y-1 border-t border-line pt-2">
                    {rollup.children.map((child) => {
                      // O filho pode, ele mesmo, somar os próprios filhos
                      // (cadeia de 3+ níveis) — por isso o valor de verdade
                      // vem de effectiveValue, não de um lançamento direto.
                      const childValue = effectiveValue(child.id)
                      return (
                        <li key={child.id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate text-content-soft">
                            {child.name}
                            {childrenByParent.has(child.id) && (
                              <Layers className="ml-1 inline h-3 w-3 text-content-faint" />
                            )}
                          </span>
                          <span className="font-medium text-content">
                            {childValue !== null ? formatValue(childValue, kpi.unit) : 'sem lançamento'}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}

                {/* KPI com prazo já ganha a barra lá embaixo, junto do resto
                    da meta — mostrar duas vezes na mesma tela é redundante. */}
                {ratio !== null && !kpi.due_date && (
                  <div className="mt-3">
                    <ProgressBar ratio={ratio} label="Meta x realizado" />
                  </div>
                )}

                {chartData.length > 1 && (
                  <div className="mt-4 h-24">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                        <XAxis dataKey="label" hide />
                        <YAxis hide domain={['auto', 'auto']} />
                        <Tooltip
                          formatter={(value: number) => formatValue(value, kpi.unit)}
                          labelFormatter={(label: string) => label}
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
                        {kpi.target_value !== null && (
                          <ReferenceLine
                            y={kpi.target_value}
                            stroke={chart.reference}
                            strokeDasharray="4 4"
                            ifOverflow="extendDomain"
                          />
                        )}
                        <Line
                          type="monotone"
                          dataKey="value"
                          stroke={company.color}
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* KPI com prazo é também a meta: mostra quem responde, até
                    quando e o andamento — sem precisar de outra tela. */}
                {kpi.due_date && (
                  <div className="mt-4 border-t border-line pt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-content-soft">
                        {ownerName(kpi.owner_id) ?? 'Sem responsável'} · prazo {formatDate(kpi.due_date)}
                        {' '}({relativeDays(kpi.due_date)})
                      </p>
                      <Badge tone={statusTone(kpi.status)}>{GOAL_STATUS_LABEL[kpi.status]}</Badge>
                    </div>
                    {ratio !== null && (
                      <div className="mt-2">
                        <ProgressBar ratio={ratio} label="Progresso da meta" />
                      </div>
                    )}
                    {(checkpointsByKpi.get(kpi.id)?.length ?? 0) > 0 && (
                      <p className="mt-1.5 text-[11px] text-content-faint">
                        {checkpointsByKpi.get(kpi.id)!.length} parcela(s) semanal(is) — ver em Histórico
                      </p>
                    )}
                  </div>
                )}

                <div className="mt-4 flex items-center justify-between gap-2">
                  <div className="flex gap-1.5">
                    {kpi.source === 'integration' && <Badge tone="violet">integração</Badge>}
                  </div>
                  {/* KPI pai não lança valor direto — o número vem da soma
                      dos sub-produtos, mostrada acima. */}
                  {canWrite && !rollup && (
                    <button type="button" className="btn-ghost py-1.5" onClick={() => setEntryFor(kpi)}>
                      <TrendingUp className="h-3.5 w-3.5" /> Lançar valor
                    </button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* ------------------------------------------------------ form de KPI */}
      <Modal
        open={creatingKpi || Boolean(editingKpi)}
        title={editingKpi ? `Editar ${editingKpi.name}` : 'Novo KPI'}
        width={!editingKpi && createMode === 'suggestions' ? 'max-w-3xl' : 'max-w-lg'}
        onClose={closeCreate}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={closeCreate}>
              Cancelar
            </button>
            {!editingKpi && createMode === 'suggestions' ? (
              <button
                type="button"
                className="btn-primary"
                disabled={busy || chosen.length === 0}
                onClick={() => void addChosen()}
              >
                {busy && <Spinner />}
                {chosen.length <= 1
                  ? 'Adicionar indicador'
                  : `Adicionar ${chosen.length} indicadores`}
              </button>
            ) : (
              <button type="submit" form="kpi-form" className="btn-primary" disabled={busy}>
                {busy && <Spinner />}
                {editingKpi ? 'Salvar' : 'Criar KPI'}
              </button>
            )}
          </>
        }
      >
        {!editingKpi && (
          <div className="mb-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setCreateMode('suggestions')}
              className={`rounded-lg border px-3 py-2 text-sm transition ${
                createMode === 'suggestions'
                  ? 'border-brand-500 bg-brand/10 font-medium text-brand-text'
                  : 'border-line-strong text-content-muted hover:bg-hover'
              }`}
            >
              Usar sugestões
            </button>
            <button
              type="button"
              onClick={() => setCreateMode('custom')}
              className={`rounded-lg border px-3 py-2 text-sm transition ${
                createMode === 'custom'
                  ? 'border-brand-500 bg-brand/10 font-medium text-brand-text'
                  : 'border-line-strong text-content-muted hover:bg-hover'
              }`}
            >
              Criar o meu
            </button>
          </div>
        )}

        {!editingKpi && createMode === 'suggestions' ? (
          <>
            <KpiSuggestions
              existingNames={kpis.map((item) => item.name)}
              selected={chosen.map((item) => item.name)}
              onToggle={toggleTemplate}
            />
            {error && (
              <div className="mt-3">
                <ErrorText>{error}</ErrorText>
              </div>
            )}
          </>
        ) : (
        <form id="kpi-form" onSubmit={submitKpi} className="space-y-4">
          <Field label="Nome do indicador">
            <input
              className="input"
              required
              placeholder="Faturamento, Ticket médio, Churn…"
              value={kpiForm.name}
              onChange={(event) => setKpiForm((c) => ({ ...c, name: event.target.value }))}
            />
          </Field>
          {/* Agrupado numa caixa só, como a de prazo/meta mais abaixo — três
              campos que só existem quando a empresa usa produtos, e o
              terceiro só quando o segundo aponta pra uma turma. Ver os três
              juntos deixa claro que "contribui para" é consequência de
              "edição", que é consequência de "produto". */}
          {products.length > 0 && (
            <div className="rounded-lg border border-dashed border-line-strong p-3">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-content-soft">
                Produto e sub-produto — opcional
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Produto" hint="Deixe em branco pra um KPI geral da empresa.">
                  <select
                    className="input"
                    value={kpiForm.product_id}
                    onChange={(event) =>
                      setKpiForm((c) => ({
                        ...c,
                        product_id: event.target.value,
                        product_edition_id: '',
                        parent_kpi_id: '',
                      }))
                    }
                  >
                    <option value="">Nenhum — indicador da empresa toda</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                </Field>
                {kpiForm.product_id && editionsForProduct(kpiForm.product_id).length > 0 && (
                  <Field label="Edição" hint="Só se este KPI for de uma turma específica.">
                    <select
                      className="input"
                      value={kpiForm.product_edition_id}
                      onChange={(event) =>
                        setKpiForm((c) => ({ ...c, product_edition_id: event.target.value, parent_kpi_id: '' }))
                      }
                    >
                      <option value="">Todas as edições (o produto como um todo)</option>
                      {editionsForProduct(kpiForm.product_id).map((edition) => (
                        <option key={edition.id} value={edition.id}>
                          {edition.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </div>

              {/* A cadeia pode ter três elos: turma soma no produto, que por
                  sua vez pode somar numa meta da empresa toda. Uma turma
                  mira num indicador do mesmo produto (sem edição); um
                  indicador de produto (sem edição) mira num indicador sem
                  produto nenhum — nunca os dois ao mesmo tempo, cada tela
                  só sobe um elo por vez. */}
              {kpiForm.product_id &&
                (() => {
                  const isEdition = Boolean(kpiForm.product_edition_id)
                  const candidates = kpis.filter((candidate) =>
                    candidate.id !== editingKpi?.id &&
                    (isEdition
                      ? candidate.product_id === kpiForm.product_id && !candidate.product_edition_id
                      : !candidate.product_id),
                  )
                  return (
                    <div className="mt-4">
                      <Field
                        label="Contribui para"
                        hint={
                          isEdition
                            ? 'Opcional — o indicador do produto (sem edição) que recebe a soma desta turma.'
                            : 'Opcional — um indicador da empresa toda que recebe a soma deste produto.'
                        }
                      >
                        <select
                          className="input"
                          value={kpiForm.parent_kpi_id}
                          onChange={(event) => setKpiForm((c) => ({ ...c, parent_kpi_id: event.target.value }))}
                        >
                          <option value="">Nenhum — não soma em nenhum outro indicador</option>
                          {candidates.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {candidates.length === 0 && (
                        <p className="mt-1.5 text-xs text-content-faint">
                          {isEdition
                            ? 'Ainda não existe um indicador deste produto sem edição — crie um primeiro (deixe "Edição" em branco nele) pra poder somar as turmas ali.'
                            : 'Ainda não existe um indicador da empresa toda (sem produto) — crie um primeiro pra poder somar este produto ali.'}
                        </p>
                      )}
                    </div>
                  )
                })()}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Categoria">
              <input
                className="input"
                list="kpi-categorias"
                placeholder="Comercial, Financeiro…"
                value={kpiForm.category}
                onChange={(event) => setKpiForm((c) => ({ ...c, category: event.target.value }))}
              />
              <datalist id="kpi-categorias">
                {KPI_CATEGORIES.map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
            </Field>
            <Field label="Frequência de medição">
              <select
                className="input"
                value={kpiForm.frequency}
                onChange={(event) => {
                  const frequency = event.target.value as KpiFrequency
                  setKpiForm((c) => ({
                    ...c,
                    frequency,
                    // A cadência de lançamento só existe se ainda couber na
                    // nova frequência (ex. trocar de anual pra mensal tira o
                    // sentido de lançar "por mês" — já é a própria medição).
                    entry_frequency: FINER_FREQUENCIES[frequency].includes(c.entry_frequency as KpiFrequency)
                      ? c.entry_frequency
                      : '',
                  }))
                }}
              >
                {FREQUENCIES.map((item) => (
                  <option key={item} value={item}>
                    {FREQUENCY_LABEL[item]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* Uma meta anual (ex. faturamento) pode ser mais fácil de
              acompanhar lançando mês a mês — só aparece quando a frequência
              escolhida tem uma cadência mais fina que faça sentido. */}
          {FINER_FREQUENCIES[kpiForm.frequency].length > 0 && (
            <Field
              label="Lançar em cadência mais fina"
              hint={`Opcional — os lançamentos somam automaticamente pro total ${FREQUENCY_LABEL[kpiForm.frequency].toLowerCase()}.`}
            >
              <select
                className="input"
                value={kpiForm.entry_frequency}
                onChange={(event) =>
                  setKpiForm((c) => ({ ...c, entry_frequency: event.target.value as KpiFrequency | '' }))
                }
              >
                <option value="">Lançar direto no período {FREQUENCY_LABEL[kpiForm.frequency].toLowerCase()}</option>
                {FINER_FREQUENCIES[kpiForm.frequency].map((item) => (
                  <option key={item} value={item}>
                    Lançar por {FREQUENCY_LABEL[item].toLowerCase()}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Unidade">
              <select
                className="input"
                value={kpiForm.unit}
                onChange={(event) => setKpiForm((c) => ({ ...c, unit: event.target.value as KpiUnit }))}
              >
                {UNITS.map((item) => (
                  <option key={item} value={item}>
                    {UNIT_LABEL[item]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Direção">
              <select
                className="input"
                value={kpiForm.direction}
                onChange={(event) =>
                  setKpiForm((c) => ({ ...c, direction: event.target.value as KpiDirection }))
                }
              >
                <option value="up">Quanto maior, melhor</option>
                <option value="down">Quanto menor, melhor</option>
              </select>
            </Field>
            <Field label="Meta">
              <NumberInput
                unit={kpiForm.unit}
                value={kpiForm.target_value}
                onChange={(target_value) => setKpiForm((c) => ({ ...c, target_value }))}
              />
            </Field>
          </div>

          <div className="rounded-lg border border-dashed border-line-strong p-3">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-content-soft">
              Vira meta quando tem prazo — opcional
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Prazo" hint="Em branco, fica só um indicador de acompanhamento.">
                <input
                  className="input"
                  type="date"
                  value={kpiForm.due_date}
                  onChange={(event) => setKpiForm((c) => ({ ...c, due_date: event.target.value }))}
                />
              </Field>
              <Field label="Responsável" hint="Notificado quando você define ou troca.">
                <select
                  className="input"
                  value={kpiForm.owner_id}
                  onChange={(event) => setKpiForm((c) => ({ ...c, owner_id: event.target.value }))}
                >
                  <option value="">Sem responsável</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.full_name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Andamento">
                <select
                  className="input"
                  value={kpiForm.status}
                  onChange={(event) => setKpiForm((c) => ({ ...c, status: event.target.value as GoalStatus }))}
                >
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {GOAL_STATUS_LABEL[status]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>

          <Field label="Descrição">
            <textarea
              className="input min-h-16"
              placeholder="Como esse número é apurado?"
              value={kpiForm.description}
              onChange={(event) => setKpiForm((c) => ({ ...c, description: event.target.value }))}
            />
          </Field>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={kpiForm.is_active}
                onChange={(event) => setKpiForm((c) => ({ ...c, is_active: event.target.checked }))}
              />
              Indicador ativo
            </label>
          </div>
          {error && <ErrorText>{error}</ErrorText>}
        </form>
        )}
      </Modal>

      {entryFor && (
        <ValueEntryModal
          kpi={entryFor}
          companyId={company.id}
          existing={seriesByKpi.get(entryFor.id) ?? []}
          entries={entriesByKpi.get(entryFor.id) ?? []}
          onClose={() => setEntryFor(null)}
          onSaved={async () => {
            setEntryFor(null)
            await load()
          }}
        />
      )}

      {historyFor && (
        <HistoryModal
          kpi={historyFor}
          series={seriesByKpi.get(historyFor.id) ?? []}
          entries={entriesByKpi.get(historyFor.id) ?? []}
          checkpoints={checkpointsByKpi.get(historyFor.id) ?? []}
          canWrite={canWrite}
          onClose={() => setHistoryFor(null)}
          onChanged={load}
        />
      )}

      <ConfirmDialog
        open={Boolean(removingKpi)}
        title="Excluir KPI"
        danger
        busy={busy}
        confirmLabel="Excluir"
        message={
          <>
            Excluir <strong>{removingKpi?.name}</strong> remove também todo o histórico de valores
            lançados nele.
          </>
        }
        onConfirm={() => void removeKpi()}
        onCancel={() => setRemovingKpi(null)}
      />
    </div>
  )
}

// ------------------------------------------------------------- lançamento
function ValueEntryModal({
  kpi,
  companyId,
  existing,
  entries,
  onClose,
  onSaved,
}: {
  kpi: Kpi
  companyId: string
  existing: KpiValue[]
  entries: KpiValueEntry[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { notify } = useToast()
  const { profile } = useAuth()
  // Quando o KPI tem uma cadência de lançamento mais fina (entry_frequency),
  // é ela que decide o período do formulário — o banco soma sozinho pro
  // total no período da frequência declarada (frequency), via gatilho.
  const usesEntries = kpi.entry_frequency !== null
  const entryFrequency = kpi.entry_frequency ?? kpi.frequency

  // A frequência já diz o tamanho do período — pedir início E fim toda vez
  // que alguém lança um valor é redundante. Um único campo de referência
  // basta: a pessoa escolhe qualquer dia dentro do período (hoje, por
  // padrão) e o sistema calcula o intervalo certo sozinho.
  const [reference, setReference] = useState(() => new Date().toISOString().slice(0, 10))
  const [value, setValue] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const { start: periodStart, end: periodEnd } = useMemo(
    () => periodBounds(entryFrequency, new Date(`${reference}T12:00:00`)),
    [entryFrequency, reference],
  )

  // Contexto de quem lança fino: quanto já soma no período grosso (ex. mês
  // dentro do ano) antes mesmo de salvar este lançamento.
  const coarseBounds = useMemo(
    () => (usesEntries ? periodBounds(kpi.frequency, new Date(`${reference}T12:00:00`)) : null),
    [usesEntries, kpi.frequency, reference],
  )
  // Exclui o próprio período sendo editado — a mensagem sempre significa
  // "o que já está lançado além deste", tanto criando quanto editando.
  const coarseEntries = useMemo(
    () =>
      coarseBounds
        ? entries.filter(
            (item) =>
              item.period_start >= coarseBounds.start &&
              item.period_start <= coarseBounds.end &&
              item.period_start !== periodStart,
          )
        : [],
    [entries, coarseBounds, periodStart],
  )
  const coarseTotal = coarseEntries.reduce((sum, item) => sum + Number(item.value), 0)

  // Se já existe lançamento no período escolhido, o formulário vira edição.
  useEffect(() => {
    if (usesEntries) {
      const found = entries.find((item) => item.period_start === periodStart)
      setValue(found ? Number(found.value) : null)
      setNote(found?.note ?? '')
    } else {
      const found = existing.find((item) => item.period_start === periodStart)
      setValue(found ? Number(found.value) : null)
      setNote(found?.note ?? '')
    }
  }, [periodStart, existing, entries, usesEntries])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (value === null) {
      setError('Informe o valor apurado.')
      return
    }

    setBusy(true)
    const { error: upsertError } = usesEntries
      ? await supabase.from('kpi_value_entries').upsert(
          {
            kpi_id: kpi.id,
            company_id: companyId,
            period_start: periodStart,
            period_end: periodEnd,
            value,
            note: note.trim() || null,
            created_by: profile?.id ?? null,
          },
          { onConflict: 'kpi_id,period_start' },
        )
      : await supabase.from('kpi_values').upsert(
          {
            kpi_id: kpi.id,
            company_id: companyId,
            period_start: periodStart,
            period_end: periodEnd,
            value,
            note: note.trim() || null,
            source: 'manual',
          },
          { onConflict: 'kpi_id,period_start' },
        )
    setBusy(false)

    if (upsertError) {
      setError(upsertError.message)
      return
    }
    notify('Valor lançado.')
    await onSaved()
    onClose()
  }

  return (
    <Modal
      open
      title={`Lançar valor · ${kpi.name}`}
      description={
        usesEntries
          ? `Lançamento ${FREQUENCY_LABEL[entryFrequency].toLowerCase()} — soma pro total ${FREQUENCY_LABEL[kpi.frequency].toLowerCase()}`
          : `Medição ${FREQUENCY_LABEL[kpi.frequency].toLowerCase()}`
      }
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="value-form" className="btn-primary" disabled={busy}>
            {busy && <Spinner />}
            Salvar
          </button>
        </>
      }
    >
      <form id="value-form" onSubmit={submit} className="space-y-4">
        <Field
          label={entryFrequency === 'daily' ? 'Dia' : 'Qualquer dia do período'}
          hint={
            entryFrequency === 'daily'
              ? undefined
              : `Período: ${formatDate(periodStart)} a ${formatDate(periodEnd)}`
          }
        >
          {entryFrequency === 'monthly' ? (
            <input
              className="input"
              type="month"
              required
              value={reference.slice(0, 7)}
              onChange={(event) => setReference(`${event.target.value}-01`)}
            />
          ) : (
            <input
              className="input"
              type="date"
              required
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          )}
        </Field>
        <Field
          label={`Valor apurado (${UNIT_LABEL[kpi.unit]})`}
          hint={kpi.target_value !== null ? `Meta: ${formatValue(kpi.target_value, kpi.unit)}` : undefined}
        >
          <NumberInput unit={kpi.unit} required value={value} onChange={setValue} />
        </Field>
        {/* Contexto de quem lança fino: quanto já está somado no período
            grosso antes deste lançamento, pra não digitar "no escuro". */}
        {usesEntries && coarseBounds && (
          <p className="rounded-lg bg-hover px-3 py-2 text-xs text-content-soft">
            Já lançado no {FREQUENCY_LABEL[kpi.frequency].toLowerCase()} de {formatDate(coarseBounds.start)} a{' '}
            {formatDate(coarseBounds.end)}:{' '}
            <strong className="text-content">{formatValue(coarseTotal, kpi.unit)}</strong>
            {coarseEntries.length > 0 && ` em ${coarseEntries.length} período(s)`}
            {' '}(sem contar este lançamento).
          </p>
        )}
        {/* Atualiza junto com o valor digitado — vê o efeito antes de salvar. */}
        {!usesEntries &&
          (() => {
            const ratio = attainmentRatio(value, kpi.target_value, kpi.direction)
            return ratio !== null ? <ProgressBar ratio={ratio} label="Meta x realizado" /> : null
          })()}
        <Field label="Observação">
          <textarea
            className="input min-h-16"
            placeholder="O que explica esse número?"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        {error && <ErrorText>{error}</ErrorText>}
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------- histórico
function HistoryModal({
  kpi,
  series,
  entries,
  checkpoints,
  canWrite,
  onClose,
  onChanged,
}: {
  kpi: Kpi
  series: KpiValue[]
  entries: KpiValueEntry[]
  checkpoints: KpiCheckpoint[]
  canWrite: boolean
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const { notify } = useToast()
  const chart = useChartTheme()
  const [busy, setBusy] = useState(false)
  const chartData = series.map((item) => ({
    label: labelPeriod(item.period_start, kpi.frequency),
    value: Number(item.value),
  }))
  const latestValue = series.length ? Number(series[series.length - 1].value) : null

  const removeValue = useConfirmDelete<KpiValue>(async (item) => {
    const { error } = await supabase.from('kpi_values').delete().eq('id', item.id)
    if (error) {
      notify(error.message, 'error')
      return
    }
    notify('Lançamento removido.')
    await onChanged()
  })

  // Um lançamento fino removido refaz a soma do período grosso sozinho —
  // o mesmo gatilho que soma também resolve quando sobra zero.
  const removeEntry = useConfirmDelete<KpiValueEntry>(async (item) => {
    const { error } = await supabase.from('kpi_value_entries').delete().eq('id', item.id)
    if (error) {
      notify(error.message, 'error')
      return
    }
    notify('Lançamento removido.')
    await onChanged()
  })

  // Divide o alvo final numa meta acumulada por semana — semana 1 pede uma
  // fatia do total, a última semana pede o total inteiro. Refazer substitui
  // a divisão anterior inteira, não soma em cima.
  const repartirPorSemana = async () => {
    if (!kpi.due_date || kpi.target_value === null) return
    const start = new Date()
    const end = new Date(`${kpi.due_date}T00:00:00`)
    const weeks = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (7 * 24 * 3600 * 1000)))
    const rows = Array.from({ length: weeks }, (_, i) => {
      const periodStart = new Date(start.getTime() + i * 7 * 24 * 3600 * 1000)
      const periodEnd = new Date(Math.min(periodStart.getTime() + 6 * 24 * 3600 * 1000, end.getTime()))
      return {
        kpi_id: kpi.id,
        company_id: kpi.company_id,
        seq: i + 1,
        period_start: periodStart.toISOString().slice(0, 10),
        period_end: periodEnd.toISOString().slice(0, 10),
        target_value: Math.round((kpi.target_value! * ((i + 1) / weeks)) * 100) / 100,
      }
    })

    setBusy(true)
    await supabase.from('kpi_checkpoints').delete().eq('kpi_id', kpi.id)
    const { error } = await supabase.from('kpi_checkpoints').insert(rows)
    setBusy(false)
    if (error) {
      notify(error.message, 'error')
      return
    }
    notify(`Meta repartida em ${weeks} semana(s).`)
    await onChanged()
  }

  const limparRepartição = useConfirmDelete<true>(async () => {
    const { error } = await supabase.from('kpi_checkpoints').delete().eq('kpi_id', kpi.id)
    if (error) {
      notify(error.message, 'error')
      return
    }
    notify('Divisão semanal removida.')
    await onChanged()
  })

  const updateCheckpoint = async (id: string, target_value: number | null) => {
    if (target_value === null) return
    const { error } = await supabase.from('kpi_checkpoints').update({ target_value }).eq('id', id)
    if (error) notify(error.message, 'error')
    else await onChanged()
  }

  return (
    <>
    <Modal open title={`Histórico · ${kpi.name}`} onClose={onClose} width="max-w-2xl">
      {kpi.due_date && (
        <div className="mb-5 rounded-lg border border-line p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-medium text-content">
              <CalendarRange className="h-4 w-4 text-content-faint" /> Meta por semana
            </p>
            {canWrite && kpi.target_value !== null && (
              <div className="flex gap-2">
                <button type="button" className="btn-ghost py-1 text-xs" disabled={busy} onClick={() => void repartirPorSemana()}>
                  {checkpoints.length ? 'Refazer divisão' : 'Repartir por semana'}
                </button>
                {checkpoints.length > 0 && (
                  <button
                    type="button"
                    className="text-xs text-rose-600 hover:underline dark:text-rose-400"
                    disabled={busy}
                    onClick={() => limparRepartição.ask(true)}
                  >
                    Limpar
                  </button>
                )}
              </div>
            )}
          </div>
          {kpi.target_value === null ? (
            <p className="mt-2 text-xs text-content-soft">Defina uma meta (alvo) para poder repartir por semana.</p>
          ) : checkpoints.length === 0 ? (
            <p className="mt-2 text-xs text-content-soft">
              Sem divisão ainda — cada semana pede uma fatia acumulada do alvo final.
            </p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {checkpoints.map((checkpoint) => {
                const reached =
                  latestValue !== null &&
                  (kpi.direction === 'up'
                    ? latestValue >= checkpoint.target_value
                    : latestValue <= checkpoint.target_value)
                return (
                  <li key={checkpoint.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-content-soft">
                      Semana {checkpoint.seq} · {formatDate(checkpoint.period_start)}–{formatDate(checkpoint.period_end)}
                    </span>
                    <span className="flex items-center gap-2">
                      {canWrite ? (
                        <NumberInput
                          unit={kpi.unit}
                          value={checkpoint.target_value}
                          onChange={(value) => void updateCheckpoint(checkpoint.id, value)}
                        />
                      ) : (
                        <span className="font-medium">{formatValue(checkpoint.target_value, kpi.unit)}</span>
                      )}
                      <Badge tone={reached ? 'green' : 'slate'}>{reached ? 'em dia' : 'a caminho'}</Badge>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {/* Lançamentos finos (entry_frequency) por trás da soma que aparece no
          gráfico abaixo — só existe quando o KPI lança em cadência mais fina
          que a própria medição. */}
      {kpi.entry_frequency && (
        <div className="mb-5 rounded-lg border border-line p-3">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-content">
            <Layers className="h-4 w-4 text-content-faint" /> Lançamentos por {FREQUENCY_LABEL[kpi.entry_frequency].toLowerCase()}
          </p>
          {entries.length === 0 ? (
            <p className="text-xs text-content-soft">Nenhum lançamento fino ainda.</p>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
              {[...entries].reverse().map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-2">
                  <span className="text-content-soft">{labelPeriod(item.period_start, kpi.entry_frequency!)}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-content">{formatValue(Number(item.value), kpi.unit)}</span>
                    {canWrite && (
                      <button
                        type="button"
                        className="rounded-md p-1 text-content-faint hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400"
                        onClick={() => removeEntry.ask(item)}
                        aria-label="Remover lançamento fino"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {series.length === 0 ? (
        <EmptyState
          title="Sem lançamentos"
          description={
            kpi.entry_frequency
              ? 'Sem total ainda — registre o primeiro lançamento fino acima.'
              : 'Registre o primeiro valor deste KPI.'
          }
        />
      ) : (
        <>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: chart.tick }} />
                <YAxis tick={{ fontSize: 11, fill: chart.tick }} width={70} />
                <Tooltip
                  formatter={(value: number) => formatValue(value, kpi.unit)}
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
                {kpi.target_value !== null && (
                  <ReferenceLine
                    y={kpi.target_value}
                    stroke={chart.reference}
                    strokeDasharray="4 4"
                    ifOverflow="extendDomain"
                  />
                )}
                <Line type="monotone" dataKey="value" stroke="rgb(var(--brand))" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="-mx-1 mt-5 overflow-x-auto px-1">
          <table className="w-full min-w-[30rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-content-soft">
                <th className="py-2">Período</th>
                <th className="py-2">Valor</th>
                <th className="py-2">Origem</th>
                <th className="py-2">Observação</th>
                {canWrite && <th className="py-2" />}
              </tr>
            </thead>
            <tbody>
              {[...series].reverse().map((item) => (
                <tr key={item.id} className="border-b border-line">
                  <td className="py-2">{labelPeriod(item.period_start, kpi.frequency)}</td>
                  <td className="py-2 font-medium">{formatValue(Number(item.value), kpi.unit)}</td>
                  <td className="py-2 text-xs text-content-soft">
                    {item.source === 'integration' ? 'integração' : 'manual'}
                  </td>
                  <td className="py-2 text-xs text-content-soft">{item.note ?? '—'}</td>
                  {canWrite && (
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        className="rounded-md p-1 text-content-faint hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400"
                        onClick={() => removeValue.ask(item)}
                        aria-label="Remover lançamento"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </Modal>
    <ConfirmDialog
      open={removeValue.target !== null}
      title="Excluir lançamento?"
      message="O valor sai do histórico e dos gráficos deste KPI. Não dá pra desfazer."
      confirmLabel="Excluir"
      danger
      busy={removeValue.busy}
      onConfirm={() => void removeValue.confirm()}
      onCancel={removeValue.cancel}
    />
    <ConfirmDialog
      open={removeEntry.target !== null}
      title="Excluir lançamento fino?"
      message="O total do período refaz a soma sozinho, sem contar mais este valor. Não dá pra desfazer."
      confirmLabel="Excluir"
      danger
      busy={removeEntry.busy}
      onConfirm={() => void removeEntry.confirm()}
      onCancel={removeEntry.cancel}
    />
    <ConfirmDialog
      open={limparRepartição.target !== null}
      title="Limpar divisão semanal?"
      message="As metas semanais já definidas são apagadas. Você pode repartir de novo depois."
      confirmLabel="Limpar"
      danger
      busy={limparRepartição.busy}
      onConfirm={() => void limparRepartição.confirm()}
      onCancel={limparRepartição.cancel}
    />
    </>
  )
}
