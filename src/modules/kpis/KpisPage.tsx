// Metas da empresa: cadastro, lançamento por período e histórico. Alvo —
// valor-alvo, prazo, responsável, andamento — é uma coisa à parte (tabela
// `metas`, uma ou várias por meta); a meta em si é só a ferramenta de
// medição por trás do alvo. Alvo agora existe em TODO nível (empresa,
// produto e turma) — cada meta de empresa (raiz, sem parent_kpi_id) é UM
// cartão só, que cresce verticalmente: o valor da empresa no topo, os
// produtos que contribuem aninhados dentro dele, e as turmas de cada
// produto aninhadas mais um nível abaixo — tudo somando via parent_kpi_id
// (ver core/lib/kpiRollup.ts). Vincular um produto/turma já cadastrado
// (em Produtos) a uma meta acontece de dentro do próprio cartão dela.
//
// AVISO DE NOMENCLATURA: nesta tela e no resto da UI, o que o usuário vê
// como "Meta" é o tipo `Kpi` (nome/unidade/direção/frequência) — a coisa
// medida. O que o usuário vê como "Alvo" é o tipo `Meta` (target_value/
// due_date/owner_id/status) — o objetivo sobre uma meta de empresa. Os
// nomes de tipo, tabela, coluna, variável e rota NÃO mudaram; só o texto
// exibido foi invertido. Ver core/types.ts para o mesmo aviso.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Archive,
  ArchiveRestore,
  ArrowDownRight,
  ArrowUpRight,
  CalendarRange,
  ChevronRight,
  History,
  Layers,
  Pencil,
  Plus,
  Target,
  Trash2,
  TrendingUp,
} from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
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
  labelPeriod,
  periodBounds,
  relativeDays,
} from '../../core/lib/format'
import { buildChildrenByParent, effectiveKpiValue, type RollupRow } from '../../core/lib/kpiRollup'
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
  type Meta,
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
  is_active: true,
  product_id: '',
  product_edition_id: '',
  entry_frequency: '' as KpiFrequency | '',
  parent_kpi_id: '',
}

// Rascunho do primeiro alvo, oferecido junto na hora de criar a meta —
// opcional, cobre o caso comum (meta + 1 alvo) numa submissão só, sem
// reintroduzir o fluxo de dois passos que motivou fundir os dois em 2026.
const emptyMetaDraft = { target_value: null as number | null, due_date: '', owner_id: '' }

export default function KpisPage() {
  const { company, canWrite } = useCompany()
  const { notify } = useToast()
  const chart = useChartTheme()
  const [searchParams] = useSearchParams()

  const [kpis, setKpis] = useState<Kpi[]>([])
  const [metas, setMetas] = useState<Meta[]>([])
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
  const [wantsInitialMeta, setWantsInitialMeta] = useState(false)
  const [metaDraft, setMetaDraft] = useState(emptyMetaDraft)
  const [removingKpi, setRemovingKpi] = useState<Kpi | null>(null)
  const [metaModalFor, setMetaModalFor] = useState<{ kpi: Kpi; meta: Meta | null } | null>(null)
  const [removingMeta, setRemovingMeta] = useState<Meta | null>(null)
  const [entryFor, setEntryFor] = useState<Kpi | null>(null)
  const [historyFor, setHistoryFor] = useState<Kpi | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: kpiRows }, { data: memberRows }, { data: productRows }, { data: editionRows }, { data: metaRows }] =
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
        supabase
          .from('metas')
          .select('*')
          .eq('company_id', company.id)
          .order('due_date', { ascending: true, nullsFirst: false }),
      ])

    const ids = (kpiRows ?? []).map((row) => row.id)
    const metaIds = (metaRows ?? []).map((row) => row.id)
    const [{ data: valueRows }, { data: checkpointRows }, { data: entryRows }] = await Promise.all([
      ids.length
        ? supabase.from('kpi_values').select('*').in('kpi_id', ids).order('period_start', { ascending: true })
        : Promise.resolve({ data: [] as KpiValue[] }),
      metaIds.length
        ? supabase.from('kpi_checkpoints').select('*').in('meta_id', metaIds).order('seq', { ascending: true })
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
    setMetas((metaRows as Meta[]) ?? [])
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

  // Acesso rápido vindo do painel/Produtos: ?kpi=<id> rola até o cartão
  // certo e destaca por alguns segundos, em vez de deixar a pessoa procurar
  // na lista. Se o alvo estiver aninhado (produto/turma), primeiro expande
  // toda a cadeia de ancestrais — senão fica escondido num bloco recolhido.
  const focusKpiId = searchParams.get('kpi')
  const [highlightedKpiId, setHighlightedKpiId] = useState<string | null>(null)
  const [expandedKpiIds, setExpandedKpiIds] = useState<Set<string>>(new Set())
  const toggleExpanded = (id: string) =>
    setExpandedKpiIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const kpiById = useMemo(() => new Map(kpis.map((item) => [item.id, item])), [kpis])

  useEffect(() => {
    if (!focusKpiId || loading) return
    setExpandedKpiIds((current) => {
      const next = new Set(current)
      let cursor = kpiById.get(focusKpiId)?.parent_kpi_id ?? null
      while (cursor) {
        next.add(cursor)
        cursor = kpiById.get(cursor)?.parent_kpi_id ?? null
      }
      return next
    })
  }, [focusKpiId, loading, kpiById])

  useEffect(() => {
    if (!focusKpiId || loading) return
    // Espera o próximo quadro pra dar tempo do bloco (se acabou de expandir
    // por causa do efeito acima) existir de verdade no DOM.
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(`kpi-${focusKpiId}`)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setHighlightedKpiId(focusKpiId)
    })
    const timer = setTimeout(() => setHighlightedKpiId(null), 2500)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
  }, [focusKpiId, loading, expandedKpiIds])

  const seriesByKpi = useMemo(() => {
    const map = new Map<string, KpiValue[]>()
    for (const value of values) {
      const list = map.get(value.kpi_id) ?? []
      list.push(value)
      map.set(value.kpi_id, list)
    }
    return map
  }, [values])

  const metasByKpi = useMemo(() => {
    const map = new Map<string, Meta[]>()
    for (const meta of metas) {
      if (meta.archived_at) continue
      const list = map.get(meta.kpi_id) ?? []
      list.push(meta)
      map.set(meta.kpi_id, list)
    }
    return map
  }, [metas])

  // O botão "Nova Meta" sempre cria meta de empresa inteira (raiz), sem
  // seletor de produto/turma nenhum — vincular um produto/turma já
  // cadastrado a uma meta acontece de dentro do próprio cartão dela (ver
  // AttachProductModal), nunca por aqui.
  const openCreate = () => {
    setKpiForm(emptyKpi)
    setWantsInitialMeta(false)
    setMetaDraft(emptyMetaDraft)
    setChosen([])
    setCreateMode('suggestions')
    setError('')
    setCreatingKpi(true)
  }

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
    // Alvo inicial só é possível quando é uma meta só (ver o box condicional
    // no JSX) — com várias, não haveria como saber a qual delas aplicá-lo.
    const withInitialMeta = chosen.length === 1 && wantsInitialMeta
    if (withInitialMeta && !metaDraft.due_date) {
      setError('Defina um prazo para o alvo, ou desmarque "Definir um alvo agora".')
      return
    }
    setError('')
    setBusy(true)
    const { data: created, error: insertError } = await supabase
      .from('kpis')
      .insert(
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
      .select('id')

    if (insertError) {
      setBusy(false)
      setError(insertError.message)
      return
    }

    if (withInitialMeta && created?.[0]) {
      const { error: metaError } = await supabase.from('metas').insert({
        company_id: company.id,
        kpi_id: created[0].id,
        target_value: metaDraft.target_value,
        due_date: metaDraft.due_date,
        owner_id: metaDraft.owner_id || null,
      })
      if (metaError) {
        setBusy(false)
        notify(`Meta criada, mas o alvo não pôde ser salvo: ${metaError.message}`, 'error')
        closeCreate()
        await load()
        return
      }
    }

    setBusy(false)
    notify(
      withInitialMeta
        ? `${chosen[0].name} e alvo criados.`
        : chosen.length === 1
          ? `${chosen[0].name} adicionada.`
          : `${chosen.length} metas adicionadas.`,
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
      is_active: kpi.is_active,
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
      is_active: kpiForm.is_active,
      // Produto/edição/pai não são editáveis por aqui (ver "Vinculado a"
      // somente-leitura no form) — o modal principal só cria/edita metas
      // raiz de empresa; um vínculo com produto/turma preexistente (ao
      // editar uma meta aninhada) segue exatamente igual, sem selects.
      product_id: kpiForm.product_id || null,
      product_edition_id: kpiForm.product_edition_id || null,
      // Só faz sentido lançar em cadência mais fina quando ela existe pra
      // essa frequência — se a pessoa trocou a frequência depois de escolher
      // uma cadência que não cabe mais nela, descarta em vez de gravar lixo.
      entry_frequency:
        kpiForm.entry_frequency && FINER_FREQUENCIES[kpiForm.frequency].includes(kpiForm.entry_frequency)
          ? kpiForm.entry_frequency
          : null,
      parent_kpi_id: kpiForm.parent_kpi_id || null,
    }

    if (!payload.name) {
      setError('Dê um nome à meta.')
      return
    }
    if (!editingKpi && wantsInitialMeta && !metaDraft.due_date) {
      setError('Defina um prazo para o alvo, ou desmarque "Definir um alvo agora".')
      return
    }

    setBusy(true)

    if (editingKpi) {
      const { error: updateError } = await supabase.from('kpis').update(payload).eq('id', editingKpi.id)
      setBusy(false)
      if (updateError) {
        setError(
          updateError.code === '23505' ? 'Já existe uma meta com esse nome nesta empresa.' : updateError.message,
        )
        return
      }
      notify('Meta atualizada.')
      setEditingKpi(null)
      await load()
      return
    }

    const { data: created, error: insertError } = await supabase.from('kpis').insert(payload).select('id').single()
    if (insertError) {
      setBusy(false)
      setError(
        insertError.code === '23505' ? 'Já existe uma meta com esse nome nesta empresa.' : insertError.message,
      )
      return
    }

    if (wantsInitialMeta) {
      const { error: metaError } = await supabase.from('metas').insert({
        company_id: company.id,
        kpi_id: created!.id,
        target_value: metaDraft.target_value,
        due_date: metaDraft.due_date,
        owner_id: metaDraft.owner_id || null,
      })
      if (metaError) {
        setBusy(false)
        notify(`Meta criada, mas o alvo não pôde ser salvo: ${metaError.message}`, 'error')
        setCreatingKpi(false)
        await load()
        return
      }
    }

    setBusy(false)
    notify(wantsInitialMeta ? 'Meta e alvo criados.' : 'Meta criada.')
    setCreatingKpi(false)
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
    notify('Meta excluída.')
    setRemovingKpi(null)
    await load()
  }

  // Arquivar não some com nada — só tira da tela de ativos. Ao contrário de
  // antes, a meta nunca mais arquiva sozinha por causa de um alvo vencido
  // (isso agora é só do alvo, automático) — este botão é sempre uma decisão
  // manual, com o desfazer sempre à mão na aba de arquivados.
  const archiveKpi = async (kpi: Kpi) => {
    const { error } = await supabase.from('kpis').update({ archived_at: new Date().toISOString() }).eq('id', kpi.id)
    if (error) {
      notify(error.message, 'error')
      return
    }
    notify('Meta arquivada.')
    await load()
  }

  const unarchiveKpi = async (kpi: Kpi) => {
    const { error } = await supabase.from('kpis').update({ archived_at: null }).eq('id', kpi.id)
    if (error) {
      notify(error.message, 'error')
      return
    }
    notify('Meta reativada.')
    await load()
  }

  const removeMeta = async () => {
    if (!removingMeta) return
    setBusy(true)
    const { error } = await supabase.from('metas').delete().eq('id', removingMeta.id)
    setBusy(false)
    if (error) {
      notify(error.message, 'error')
      return
    }
    notify('Meta excluída.')
    setRemovingMeta(null)
    await load()
  }

  const ownerName = (id: string | null) =>
    id ? (people.find((person) => person.id === id)?.full_name ?? '—') : null

  const productName = (id: string | null) => (id ? products.find((item) => item.id === id)?.name : null) ?? null
  const editionName = (id: string | null) => (id ? editions.find((item) => item.id === id)?.name : null) ?? null

  const checkpointsByMeta = useMemo(() => {
    const map = new Map<string, KpiCheckpoint[]>()
    for (const checkpoint of checkpoints) {
      const list = map.get(checkpoint.meta_id) ?? []
      list.push(checkpoint)
      map.set(checkpoint.meta_id, list)
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
  // filho soma pro pai. Guardado com o Kpi completo (não só o RollupRow
  // genérico abaixo) porque a árvore de render precisa de nome/unidade/
  // produto de cada filho, não só do valor.
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

  // Valor "de verdade" de cada meta — mesmo algoritmo de soma em cadeia que
  // ProductsPage/CompanyDashboard já usam (core/lib/kpiRollup.ts), sem
  // reimplementar a recursão aqui de novo.
  const rollupRows = useMemo<RollupRow[]>(
    () =>
      kpis.map((kpi) => {
        const series = seriesByKpi.get(kpi.id) ?? []
        const latest = series[series.length - 1]
        return { kpi_id: kpi.id, value: latest ? Number(latest.value) : null, parent_kpi_id: kpi.parent_kpi_id }
      }),
    [kpis, seriesByKpi],
  )
  const rollupChildrenByParent = useMemo(() => buildChildrenByParent(rollupRows), [rollupRows])
  const rollupRowById = useMemo(() => new Map(rollupRows.map((row) => [row.kpi_id, row])), [rollupRows])
  const effectiveValue = useCallback(
    (kpiId: string) => effectiveKpiValue(kpiId, rollupChildrenByParent, rollupRowById),
    [rollupChildrenByParent, rollupRowById],
  )

  /** Soma o valor de cada produto/turma direto abaixo — o valor "oficial"
   *  do pai é essa soma, não um lançamento próprio nele. */
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

  // Cartões do topo: só as raízes (sem parent_kpi_id) — todo o resto vive
  // aninhado dentro delas (ver renderNested). Checagem por "verdadeiro" (não
  // por === null) de propósito: em dado vindo de fora do banco de verdade
  // (ex. simulação de teste) o campo pode vir ausente (undefined) em vez de
  // nulo.
  const archivedKpis = useMemo(
    () => kpis.filter((kpi) => !kpi.parent_kpi_id && Boolean(kpi.archived_at)),
    [kpis],
  )

  // "Filtrar por produto" busca a raiz cujo ramo (em qualquer profundidade)
  // contenha aquele produto — a raiz em si nunca tem product_id (ela é
  // sempre a meta de empresa inteira).
  const hasProductInTree = useCallback(
    (kpi: Kpi, productId: string): boolean => {
      if (kpi.product_id === productId) return true
      return (childrenByParent.get(kpi.id) ?? []).some((child) => hasProductInTree(child, productId))
    },
    [childrenByParent],
  )

  const rootKpis = useMemo(() => {
    const byArchiveTab = kpis.filter(
      (kpi) => !kpi.parent_kpi_id && (showArchived ? Boolean(kpi.archived_at) : !kpi.archived_at),
    )
    return productFilter ? byArchiveTab.filter((kpi) => hasProductInTree(kpi, productFilter)) : byArchiveTab
  }, [kpis, productFilter, showArchived, hasProductInTree])

  const [attachingTo, setAttachingTo] = useState<Kpi | null>(null)

  // Rótulo de um nó aninhado: nome do produto (+ edição, se for turma) em
  // vez do nome sintetizado gravado no banco — esse existe só pra
  // satisfazer a constraint de nome único por empresa, não é o texto certo
  // pra tela.
  const nestedLabel = (kpi: Kpi): string => {
    if (kpi.product_edition_id) return editionName(kpi.product_edition_id) ?? kpi.name
    if (kpi.product_id) return productName(kpi.product_id) ?? kpi.name
    return kpi.name
  }

  // Editar/arquivar/excluir/histórico — mesmos ícones/handlers pro cartão
  // raiz e pra cada nó aninhado, só muda o tamanho.
  const renderActions = (kpi: Kpi, compact = false) => {
    const iconClass = compact ? 'h-3.5 w-3.5' : 'h-4 w-4'
    const btnClass = compact
      ? 'rounded-md p-1 text-content-faint hover:bg-hover hover:text-content'
      : 'rounded-md p-1.5 text-content-faint hover:bg-hover hover:text-content'
    return (
      <div className="flex shrink-0 gap-1">
        <button type="button" className={btnClass} title="Histórico" onClick={() => setHistoryFor(kpi)}>
          <History className={iconClass} />
        </button>
        {canWrite && (
          <>
            <button type="button" className={btnClass} title="Editar" onClick={() => openEdit(kpi)}>
              <Pencil className={iconClass} />
            </button>
            {kpi.archived_at ? (
              <button type="button" className={btnClass} title="Reativar" onClick={() => void unarchiveKpi(kpi)}>
                <ArchiveRestore className={iconClass} />
              </button>
            ) : (
              <button type="button" className={btnClass} title="Arquivar" onClick={() => void archiveKpi(kpi)}>
                <Archive className={iconClass} />
              </button>
            )}
            <button
              type="button"
              className={`${btnClass} hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400`}
              title="Excluir"
              onClick={() => setRemovingKpi(kpi)}
            >
              <Trash2 className={iconClass} />
            </button>
          </>
        )}
      </div>
    )
  }

  // Alvos desta meta — zero, um ou vários ao mesmo tempo (ex. alvo mensal e
  // alvo anual da mesma meta), em TODO nível (empresa, produto e turma).
  const renderAlvoSection = (kpi: Kpi, displayValue: number | null) => {
    const kpiMetas = metasByKpi.get(kpi.id) ?? []
    return (
      <div className="mt-4 border-t border-line pt-3">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-content-soft">
            <Target className="h-3.5 w-3.5" /> Alvos{kpiMetas.length > 0 && ` (${kpiMetas.length})`}
          </p>
          {canWrite && (
            <button
              type="button"
              className="text-xs text-brand-text hover:underline"
              onClick={() => setMetaModalFor({ kpi, meta: null })}
            >
              + Alvo
            </button>
          )}
        </div>
        {kpiMetas.length === 0 ? (
          <p className="mt-1.5 text-xs text-content-faint">Nenhum alvo ainda.</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {kpiMetas.map((meta) => {
              const ratio =
                displayValue !== null ? attainmentRatio(displayValue, meta.target_value, kpi.direction) : null
              const caption =
                meta.target_value !== null && displayValue !== null
                  ? `${formatValue(displayValue, kpi.unit)} de ${formatValue(meta.target_value, kpi.unit)}`
                  : undefined
              return (
                <li key={meta.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setMetaModalFor({ kpi, meta })}
                    >
                      {/* O valor buscado é a informação principal do alvo —
                          fica em destaque aqui, não escondido só na legenda
                          da barra de progresso (que só existe quando já há
                          um valor lançado pra comparar). */}
                      <span className="block truncate text-sm font-semibold text-content hover:underline">
                        {meta.target_value !== null ? formatValue(meta.target_value, kpi.unit) : 'Alvo sem valor definido'}
                      </span>
                      <span className="block truncate text-xs text-content-soft">
                        {ownerName(meta.owner_id) ?? 'Sem responsável'}
                        {meta.due_date && (
                          <> · prazo {formatDate(meta.due_date)} ({relativeDays(meta.due_date)})</>
                        )}
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Badge tone={statusTone(meta.status)}>{GOAL_STATUS_LABEL[meta.status]}</Badge>
                      {canWrite && (
                        <button
                          type="button"
                          className="rounded p-0.5 text-content-faint hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400"
                          onClick={() => setRemovingMeta(meta)}
                          aria-label="Excluir alvo"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  {ratio !== null && (
                    <div className="mt-1.5">
                      <ProgressBar ratio={ratio} caption={caption} />
                    </div>
                  )}
                  {(checkpointsByMeta.get(meta.id)?.length ?? 0) > 0 && (
                    <p className="mt-1 text-[11px] text-content-faint">
                      {checkpointsByMeta.get(meta.id)!.length} parcela(s) semanal(is)
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    )
  }

  // Produtos/turmas aninhados dentro do cartão da família — recolhidos por
  // padrão. Recursivo: depth 1 = produto, depth 2 = turma (a cadeia aceita
  // mais níveis se algum dia precisar, sem mudar nada aqui).
  const renderNested = (kpi: Kpi, depth: number) => {
    const children = childrenByParent.get(kpi.id) ?? []
    if (!children.length) return null
    return (
      <ul className="mt-3 space-y-2 border-t border-line pt-3">
        {children.map((child) => {
          const isOpen = expandedKpiIds.has(child.id)
          const childValue = effectiveValue(child.id)
          const childRollup = rollupFor(child.id)
          return (
            <li
              key={child.id}
              id={`kpi-${child.id}`}
              className={`rounded-lg border ${
                highlightedKpiId === child.id ? 'border-brand-500 ring-2 ring-brand-500' : 'border-line'
              } ${child.is_active ? '' : 'opacity-60'}`}
              style={{ marginLeft: (depth - 1) * 12 }}
            >
              <button
                type="button"
                onClick={() => toggleExpanded(child.id)}
                className="flex w-full items-center justify-between gap-2 p-2.5 text-left"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <ChevronRight
                    className={`h-4 w-4 shrink-0 text-content-faint transition-transform ${isOpen ? 'rotate-90' : ''}`}
                  />
                  <span className="min-w-0 truncate text-sm font-medium text-content">{nestedLabel(child)}</span>
                  {childRollup && (
                    <Badge tone="blue">
                      <Layers className="mr-1 inline h-3 w-3" />
                      soma {childRollup.reported}/{childRollup.total}
                    </Badge>
                  )}
                </span>
                <span className="shrink-0 text-sm text-content-soft">
                  {childValue !== null ? formatValue(childValue, child.unit) : 'sem lançamento'}
                </span>
              </button>
              {isOpen && (
                <div className="border-t border-line p-2.5">
                  <div className="flex items-center justify-end">{renderActions(child, true)}</div>
                  {renderAlvoSection(child, childValue)}
                  {renderNested(child, depth + 1)}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {canWrite && !childrenByParent.has(child.id) && (
                      <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => setEntryFor(child)}>
                        <TrendingUp className="h-3.5 w-3.5" /> Lançar valor
                      </button>
                    )}
                    {canWrite && child.product_edition_id === null && (
                      <button
                        type="button"
                        className="btn-ghost py-1.5 text-xs"
                        onClick={() => setAttachingTo(child)}
                      >
                        <Plus className="h-3.5 w-3.5" /> Vincular turma
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={`Metas · ${company.name}`}
        subtitle="Metas desta empresa — cada uma pode ter alvo em todo nível (empresa, produto e turma) e cresce com os produtos que contribuem pra ela."
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
                <Plus className="h-4 w-4" /> Nova Meta
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
          title="Nenhuma meta ainda"
          description="Comece pelos números que você olharia primeiro se pudesse ver só três."
          action={
            canWrite && (
              <button type="button" className="btn-primary" onClick={() => openCreate()}>
                <Plus className="h-4 w-4" /> Nova Meta
              </button>
            )
          }
        />
      ) : rootKpis.length === 0 ? (
        <EmptyState
          title={showArchived ? 'Nenhuma meta arquivada' : 'Nenhuma meta neste produto'}
          description={
            showArchived
              ? 'Metas arquivadas manualmente aparecem aqui.'
              : 'Troque o filtro ou vincule um produto já cadastrado a uma meta existente.'
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {rootKpis.map((kpi) => {
            const series = seriesByKpi.get(kpi.id) ?? []
            const latest = series[series.length - 1]
            const previous = series[series.length - 2]
            // Uma meta com produtos ligados nunca lança valor direto — o
            // número dela é a soma do valor de cada um.
            const rollup = rollupFor(kpi.id)
            const displayValue = effectiveValue(kpi.id)
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
                      {/* Rede de segurança: um indicador de produto/turma
                          criado antes desta cadeia existir pode não ter
                          parent_kpi_id — aparece como "raiz" solta, com a
                          badge pra dar contexto de onde ele vem. */}
                      {kpi.product_id && (
                        <Badge tone="violet">
                          {productName(kpi.product_id)}
                          {kpi.product_edition_id && ` · ${editionName(kpi.product_edition_id)}`}
                        </Badge>
                      )}
                      {rollup && (
                        <Badge tone="blue">
                          <Layers className="mr-1 inline h-3 w-3" />
                          soma {rollup.reported}/{rollup.total} produto(s)
                        </Badge>
                      )}
                    </div>
                  </div>
                  {renderActions(kpi)}
                </div>

                <div className="mt-3 flex items-end justify-between gap-2">
                  <div>
                    <p className="text-2xl font-semibold text-content">
                      {displayValue !== null ? formatValue(displayValue, kpi.unit) : '—'}
                    </p>
                    <p className="text-xs text-content-soft">
                      {rollup
                        ? 'soma atual dos produtos'
                        : latest
                          ? labelPeriod(latest.period_start, kpi.frequency)
                          : 'sem lançamento'}
                    </p>
                  </div>
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

                {renderAlvoSection(kpi, displayValue)}

                {renderNested(kpi, 1)}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {kpi.source === 'integration' && <Badge tone="violet">integração</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {/* Uma meta com produtos ligados nunca lança valor
                        direto — o número vem da soma deles, mostrada acima. */}
                    {canWrite && !rollup && (
                      <button type="button" className="btn-ghost py-1.5" onClick={() => setEntryFor(kpi)}>
                        <TrendingUp className="h-3.5 w-3.5" /> Lançar valor
                      </button>
                    )}
                    {canWrite && !kpi.product_id && (
                      <button type="button" className="btn-ghost py-1.5" onClick={() => setAttachingTo(kpi)}>
                        <Plus className="h-3.5 w-3.5" /> Vincular produto
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* ----------------------------------------------------- form de meta */}
      <Modal
        open={creatingKpi || Boolean(editingKpi)}
        title={editingKpi ? `Editar ${editingKpi.name}` : 'Nova Meta'}
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
                {chosen.length === 1 && wantsInitialMeta
                  ? 'Adicionar meta e alvo'
                  : chosen.length <= 1
                    ? 'Adicionar meta'
                    : `Adicionar ${chosen.length} metas`}
              </button>
            ) : (
              <button type="submit" form="kpi-form" className="btn-primary" disabled={busy}>
                {busy && <Spinner />}
                {editingKpi ? 'Salvar' : 'Criar Meta'}
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
            {/* Só faz sentido definir um alvo aqui quando é uma meta só —
                com várias escolhidas de uma vez não dá pra saber a qual
                delas o valor pertence. */}
            {chosen.length === 1 && (
              <div className="mt-3 rounded-lg border border-dashed border-line-strong p-3">
                <label className="flex items-center gap-2 text-sm font-medium text-content">
                  <input
                    type="checkbox"
                    checked={wantsInitialMeta}
                    onChange={(event) => setWantsInitialMeta(event.target.checked)}
                  />
                  Definir um alvo agora
                </label>
                <p className="mt-1 text-xs text-content-faint">
                  Opcional — uma meta pode ganhar alvos depois, a qualquer momento.
                </p>
                {wantsInitialMeta && (
                  <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Field label="Prazo">
                      <input
                        className="input"
                        type="date"
                        required
                        value={metaDraft.due_date}
                        onChange={(event) => setMetaDraft((c) => ({ ...c, due_date: event.target.value }))}
                      />
                    </Field>
                    <Field label="Alvo">
                      <NumberInput
                        unit={chosen[0].unit}
                        value={metaDraft.target_value}
                        onChange={(target_value) => setMetaDraft((c) => ({ ...c, target_value }))}
                      />
                    </Field>
                    <Field label="Responsável" hint="Notificado quando você define ou troca.">
                      <select
                        className="input"
                        value={metaDraft.owner_id}
                        onChange={(event) => setMetaDraft((c) => ({ ...c, owner_id: event.target.value }))}
                      >
                        <option value="">Sem responsável</option>
                        {people.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.full_name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                )}
              </div>
            )}
            {error && (
              <div className="mt-3">
                <ErrorText>{error}</ErrorText>
              </div>
            )}
          </>
        ) : (
        <form id="kpi-form" onSubmit={submitKpi} className="space-y-4">
          <Field label="Nome da meta">
            <input
              className="input"
              required
              placeholder="Faturamento, Ticket médio, Churn…"
              value={kpiForm.name}
              onChange={(event) => setKpiForm((c) => ({ ...c, name: event.target.value }))}
            />
          </Field>
          {/* Este formulário só cria/edita a meta em si (nome/categoria/
              unidade/frequência/descrição) — o vínculo com produto/turma
              não é editável por aqui: nasce de dentro do cartão certo (ver
              "+ Vincular produto"/"Vincular turma") e, se já existir, só
              aparece como referência somente-leitura abaixo. */}
          {editingKpi?.product_id && (
            <p className="rounded-lg bg-hover px-3 py-2 text-xs text-content-soft">
              Vinculado a: <strong className="text-content">{productName(editingKpi.product_id)}</strong>
              {editingKpi.product_edition_id && (
                <>
                  {' '}
                  · <strong className="text-content">{editionName(editingKpi.product_edition_id)}</strong>
                </>
              )}
            </p>
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

          {/* Um total anual (ex. faturamento) pode ser mais fácil de
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          </div>

          {/* Alvo inicial, opcional — pode ser adicionado (ou um segundo,
              terceiro...) depois, a qualquer momento, pelo "+ Alvo" no
              cartão da meta. Este modal só cria meta raiz de empresa; uma
              meta de produto/turma ganha o alvo dela direto no cartão
              aninhado, pelo mesmo "+ Alvo". */}
          {!editingKpi && (
            <div className="rounded-lg border border-dashed border-line-strong p-3">
              <label className="flex items-center gap-2 text-sm font-medium text-content">
                <input
                  type="checkbox"
                  checked={wantsInitialMeta}
                  onChange={(event) => setWantsInitialMeta(event.target.checked)}
                />
                Definir um alvo agora
              </label>
              <p className="mt-1 text-xs text-content-faint">
                Opcional — uma meta pode ganhar alvos depois, a qualquer momento.
              </p>
              {wantsInitialMeta && (
                <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field label="Prazo">
                    <input
                      className="input"
                      type="date"
                      required
                      value={metaDraft.due_date}
                      onChange={(event) => setMetaDraft((c) => ({ ...c, due_date: event.target.value }))}
                    />
                  </Field>
                  <Field label="Alvo">
                    <NumberInput
                      unit={kpiForm.unit}
                      value={metaDraft.target_value}
                      onChange={(target_value) => setMetaDraft((c) => ({ ...c, target_value }))}
                    />
                  </Field>
                  <Field label="Responsável" hint="Notificado quando você define ou troca.">
                    <select
                      className="input"
                      value={metaDraft.owner_id}
                      onChange={(event) => setMetaDraft((c) => ({ ...c, owner_id: event.target.value }))}
                    >
                      <option value="">Sem responsável</option>
                      {people.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.full_name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              )}
            </div>
          )}

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
              Meta ativa
            </label>
          </div>
          {error && <ErrorText>{error}</ErrorText>}
        </form>
        )}
      </Modal>

      {metaModalFor && (
        <MetaFormModal
          kpi={metaModalFor.kpi}
          meta={metaModalFor.meta}
          people={people}
          latestValue={
            rollupFor(metaModalFor.kpi.id)
              ? effectiveValue(metaModalFor.kpi.id)
              : (() => {
                  const s = seriesByKpi.get(metaModalFor.kpi.id) ?? []
                  const last = s[s.length - 1]
                  return last ? Number(last.value) : null
                })()
          }
          checkpoints={metaModalFor.meta ? checkpointsByMeta.get(metaModalFor.meta.id) ?? [] : []}
          onClose={() => setMetaModalFor(null)}
          onSaved={load}
        />
      )}

      {attachingTo && (
        <AttachProductModal
          parentKpi={attachingTo}
          products={products}
          editions={editions}
          existingChildren={childrenByParent.get(attachingTo.id) ?? []}
          companyId={company.id}
          onClose={() => setAttachingTo(null)}
          onSaved={load}
        />
      )}

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
          canWrite={canWrite}
          onClose={() => setHistoryFor(null)}
          onChanged={load}
        />
      )}

      <ConfirmDialog
        open={Boolean(removingKpi)}
        title="Excluir meta"
        danger
        busy={busy}
        confirmLabel="Excluir"
        message={
          <>
            Excluir <strong>{removingKpi?.name}</strong> remove também todo o histórico de valores e
            todos os alvos ligados a ela.
          </>
        }
        onConfirm={() => void removeKpi()}
        onCancel={() => setRemovingKpi(null)}
      />

      <ConfirmDialog
        open={Boolean(removingMeta)}
        title="Excluir alvo"
        danger
        busy={busy}
        confirmLabel="Excluir"
        message="A meta e o histórico dela continuam intactos — só este alvo some. Não dá pra desfazer."
        onConfirm={() => void removeMeta()}
        onCancel={() => setRemovingMeta(null)}
      />
    </div>
  )
}

// ------------------------------------------------------- vincular produto
// Cria o vínculo entre uma meta (empresa ou produto) e um produto/turma já
// cadastrado em Produtos — o pai já é sabido (o cartão de onde este modal
// foi aberto), então não tem "Contribui para" nenhum pra escolher: o
// vínculo nasce direto, sem passo manual.
function AttachProductModal({
  parentKpi,
  products,
  editions,
  existingChildren,
  companyId,
  onClose,
  onSaved,
}: {
  parentKpi: Kpi
  products: Product[]
  editions: ProductEdition[]
  existingChildren: Kpi[]
  companyId: string
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { notify } = useToast()
  // Um nó de produto (product_id preenchido, sem edição) vincula turma;
  // uma meta de empresa (sem produto) vincula produto.
  const level: 'turma' | 'produto' = parentKpi.product_id ? 'turma' : 'produto'
  const alreadyLinked = new Set(
    existingChildren.map((kpi) => (level === 'turma' ? kpi.product_edition_id : kpi.product_id)),
  )
  const candidates =
    level === 'turma'
      ? editions.filter((edition) => edition.product_id === parentKpi.product_id && !alreadyLinked.has(edition.id))
      : products.filter((product) => !alreadyLinked.has(product.id))

  const [candidateId, setCandidateId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!candidateId) {
      setError(level === 'turma' ? 'Escolha uma turma.' : 'Escolha um produto.')
      return
    }
    setError('')
    setBusy(true)

    let productId: string
    let editionId: string | null
    let name: string
    if (level === 'turma') {
      const edition = editions.find((item) => item.id === candidateId)!
      const product = products.find((item) => item.id === parentKpi.product_id)
      productId = parentKpi.product_id!
      editionId = edition.id
      name = `${parentKpi.name} · ${product?.name ?? ''} · ${edition.name}`
    } else {
      const product = products.find((item) => item.id === candidateId)!
      productId = product.id
      editionId = null
      name = `${parentKpi.name} · ${product.name}`
    }

    const { error: insertError } = await supabase.from('kpis').insert({
      company_id: companyId,
      name,
      category: parentKpi.category,
      unit: parentKpi.unit,
      direction: parentKpi.direction,
      frequency: parentKpi.frequency,
      product_id: productId,
      product_edition_id: editionId,
      parent_kpi_id: parentKpi.id,
      is_active: true,
    })
    setBusy(false)
    if (insertError) {
      setError(
        insertError.code === '23505'
          ? 'Já existe uma meta com esse nome — tente de novo em instantes.'
          : insertError.message,
      )
      return
    }
    notify('Vínculo criado.')
    await onSaved()
    onClose()
  }

  return (
    <Modal
      open
      title={level === 'turma' ? `Vincular turma · ${parentKpi.name}` : `Vincular produto · ${parentKpi.name}`}
      onClose={onClose}
      width="max-w-md"
      footer={
        candidates.length > 0 && (
          <>
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" form="attach-form" className="btn-primary" disabled={busy}>
              {busy && <Spinner />}
              Vincular
            </button>
          </>
        )
      }
    >
      {candidates.length === 0 ? (
        <p className="text-sm text-content-soft">
          {level === 'turma'
            ? 'Todas as turmas deste produto já estão vinculadas aqui, ou o produto ainda não tem turma cadastrada.'
            : 'Todos os produtos cadastrados já estão vinculados a esta meta, ou nenhum produto foi cadastrado ainda.'}
        </p>
      ) : (
        <form id="attach-form" onSubmit={submit} className="space-y-4">
          <Field label={level === 'turma' ? 'Turma' : 'Produto'}>
            <select className="input" value={candidateId} onChange={(event) => setCandidateId(event.target.value)}>
              <option value="">Selecione…</option>
              {candidates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
          {error && <ErrorText>{error}</ErrorText>}
        </form>
      )}
    </Modal>
  )
}

// ------------------------------------------------------------------ meta
function MetaFormModal({
  kpi,
  meta,
  people,
  latestValue,
  checkpoints,
  onClose,
  onSaved,
}: {
  kpi: Kpi
  meta: Meta | null
  people: Profile[]
  latestValue: number | null
  checkpoints: KpiCheckpoint[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { notify } = useToast()
  const [form, setForm] = useState({
    target_value: meta?.target_value ?? null,
    due_date: meta?.due_date ?? '',
    owner_id: meta?.owner_id ?? '',
    status: meta?.status ?? ('active' as GoalStatus),
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!form.due_date) {
      setError('Defina um prazo para o alvo.')
      return
    }
    const payload = {
      company_id: kpi.company_id,
      kpi_id: kpi.id,
      target_value: form.target_value,
      due_date: form.due_date,
      owner_id: form.owner_id || null,
      status: form.status,
    }
    setBusy(true)
    const result = meta
      ? await supabase.from('metas').update(payload).eq('id', meta.id)
      : await supabase.from('metas').insert(payload)
    setBusy(false)
    if (result.error) {
      setError(result.error.message)
      return
    }
    notify(meta ? 'Alvo atualizado.' : 'Alvo criado.')
    await onSaved()
    onClose()
  }

  // Divide o alvo final num alvo semanal acumulado — semana 1 pede uma
  // fatia do total, a última semana pede o total inteiro. Refazer substitui
  // a divisão anterior inteira, não soma em cima. Só existe editando um
  // alvo que já foi salvo (precisa de um meta_id de verdade pra gravar).
  const repartirPorSemana = async () => {
    if (!meta || !meta.due_date || meta.target_value === null) return
    const start = new Date()
    const end = new Date(`${meta.due_date}T00:00:00`)
    const weeks = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (7 * 24 * 3600 * 1000)))
    const rows = Array.from({ length: weeks }, (_, i) => {
      const periodStart = new Date(start.getTime() + i * 7 * 24 * 3600 * 1000)
      const periodEnd = new Date(Math.min(periodStart.getTime() + 6 * 24 * 3600 * 1000, end.getTime()))
      return {
        meta_id: meta.id,
        company_id: kpi.company_id,
        seq: i + 1,
        period_start: periodStart.toISOString().slice(0, 10),
        period_end: periodEnd.toISOString().slice(0, 10),
        target_value: Math.round((meta.target_value! * ((i + 1) / weeks)) * 100) / 100,
      }
    })

    setBusy(true)
    await supabase.from('kpi_checkpoints').delete().eq('meta_id', meta.id)
    const { error: insertError } = await supabase.from('kpi_checkpoints').insert(rows)
    setBusy(false)
    if (insertError) {
      notify(insertError.message, 'error')
      return
    }
    notify(`Alvo repartido em ${weeks} semana(s).`)
    await onSaved()
  }

  const limparRepartição = useConfirmDelete<true>(async () => {
    if (!meta) return
    const { error: deleteError } = await supabase.from('kpi_checkpoints').delete().eq('meta_id', meta.id)
    if (deleteError) {
      notify(deleteError.message, 'error')
      return
    }
    notify('Divisão semanal removida.')
    await onSaved()
  })

  const updateCheckpoint = async (id: string, target_value: number | null) => {
    if (target_value === null) return
    const { error: updateError } = await supabase.from('kpi_checkpoints').update({ target_value }).eq('id', id)
    if (updateError) notify(updateError.message, 'error')
    else await onSaved()
  }

  return (
    <>
    <Modal
      open
      title={meta ? `Editar alvo · ${kpi.name}` : `Novo alvo · ${kpi.name}`}
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="meta-form" className="btn-primary" disabled={busy}>
            {busy && <Spinner />}
            Salvar
          </button>
        </>
      }
    >
      <form id="meta-form" onSubmit={submit} className="space-y-4">
        {/* O valor buscado é o campo mais importante deste formulário —
            fica sozinho, em primeiro lugar, em vez de dividir a linha com
            "Prazo" (e, principalmente, longe de "Andamento": ver comentário
            abaixo). */}
        <Field label="Alvo" hint="O valor que você está buscando atingir.">
          <NumberInput
            unit={kpi.unit}
            value={form.target_value}
            onChange={(target_value) => setForm((c) => ({ ...c, target_value }))}
          />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Prazo">
            <input
              className="input"
              type="date"
              required
              value={form.due_date}
              onChange={(event) => setForm((c) => ({ ...c, due_date: event.target.value }))}
            />
          </Field>
          <Field label="Responsável" hint="Notificado quando você define ou troca.">
            <select
              className="input"
              value={form.owner_id}
              onChange={(event) => setForm((c) => ({ ...c, owner_id: event.target.value }))}
            >
              <option value="">Sem responsável</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.full_name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {/* Sozinho na própria linha, longe do campo "Alvo" — evita qualquer
            chance de confundir os dois campos ao preencher o formulário. Não
            é onde se registra o valor medido (isso é "Lançar valor", no
            cartão da meta): aqui só se ajusta manualmente o status deste
            alvo específico. */}
        <Field label="Andamento" hint="Não é o valor medido — isso é lançado à parte, no cartão da meta.">
          <select
            className="input"
            value={form.status}
            onChange={(event) => setForm((c) => ({ ...c, status: event.target.value as GoalStatus }))}
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {GOAL_STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </Field>
        {error && <ErrorText>{error}</ErrorText>}
      </form>

      {/* Repartição semanal só existe pra um alvo já salvo (precisa de um
          id de verdade) — some da tela na hora de criar um alvo novo. */}
      {meta && (
        <div className="mt-5 rounded-lg border border-line p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-medium text-content">
              <CalendarRange className="h-4 w-4 text-content-faint" /> Alvo por semana
            </p>
            {meta.target_value !== null && (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-ghost py-1 text-xs"
                  disabled={busy}
                  onClick={() => void repartirPorSemana()}
                >
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
          {meta.target_value === null ? (
            <p className="mt-2 text-xs text-content-soft">Defina um alvo pra poder repartir por semana.</p>
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
                      <NumberInput
                        unit={kpi.unit}
                        value={checkpoint.target_value}
                        onChange={(value) => void updateCheckpoint(checkpoint.id, value)}
                      />
                      <Badge tone={reached ? 'green' : 'slate'}>{reached ? 'em dia' : 'a caminho'}</Badge>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </Modal>
    <ConfirmDialog
      open={limparRepartição.target !== null}
      title="Limpar divisão semanal?"
      message="Os alvos semanais já definidos são apagados. Você pode repartir de novo depois."
      confirmLabel="Limpar"
      danger
      busy={limparRepartição.busy}
      onConfirm={() => void limparRepartição.confirm()}
      onCancel={limparRepartição.cancel}
    />
    </>
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
        <Field label={`Valor apurado (${UNIT_LABEL[kpi.unit]})`}>
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
  canWrite,
  onClose,
  onChanged,
}: {
  kpi: Kpi
  series: KpiValue[]
  entries: KpiValueEntry[]
  canWrite: boolean
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const { notify } = useToast()
  const chart = useChartTheme()
  const chartData = series.map((item) => ({
    label: labelPeriod(item.period_start, kpi.frequency),
    value: Number(item.value),
  }))

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

  return (
    <>
    <Modal open title={`Histórico · ${kpi.name}`} onClose={onClose} width="max-w-2xl">
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
              : 'Registre o primeiro valor desta meta.'
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
      message="O valor sai do histórico e dos gráficos desta meta. Não dá pra desfazer."
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
    </>
  )
}
