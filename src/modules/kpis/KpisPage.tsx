// Metas da empresa: cadastro, lançamento por período e histórico. Alvo —
// valor-alvo, prazo, responsável, andamento — é uma coisa à parte (tabela
// `metas`, uma ou várias por meta); a meta em si é só a ferramenta de
// medição por trás do alvo. Alvo existe em TODO nível (empresa, produto e
// turma), somando via parent_kpi_id (ver core/lib/kpiRollup.ts).
//
// Estrutura da tela (reformulada — ver docs/verificacao.md): Visão Geral é
// uma LISTA escaneável, agrupada por categoria, uma linha por meta — nada
// aninhado aparece aqui. Clicar numa linha abre o Detalhe: um drill-down por
// breadcrumb (Metas / Faturamento / Entre Donos / Imersão Set-2026), com um
// bloco de destaque pro nível atual e uma tabela de quebra pros filhos
// diretos dele. Este arquivo é o container: carrega os dados, guarda o
// estado dos modais (compartilhados pelas duas telas) e decide qual delas
// mostrar pelo :kpiId da rota — MetasOverview.tsx e MetaDetail.tsx são só
// apresentação, recebendo tudo pronto por `KpisCtx`.
//
// AVISO DE NOMENCLATURA: nesta tela e no resto da UI, o que o usuário vê
// como "Meta" é o tipo `Kpi` (nome/unidade/direção/frequência) — a coisa
// medida. O que o usuário vê como "Alvo" é o tipo `Meta` (target_value/
// due_date/owner_id/status) — o objetivo sobre uma meta de empresa. Os
// nomes de tipo, tabela, coluna, variável e rota NÃO mudaram; só o texto
// exibido foi invertido. Ver core/types.ts para o mesmo aviso.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { CalendarRange, Pencil, Layers, Trash2 } from 'lucide-react'
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
  formatDate,
  formatValue,
  labelPeriod,
  periodBounds,
  splitTargetIntoPeriods,
  sumValuesInRange,
} from '../../core/lib/format'
import { buildChildrenByParent, effectiveKpiValue, type RollupRow } from '../../core/lib/kpiRollup'
import { buildBulkEditions } from '../../core/lib/bulkEditions'
import { useAuth } from '../../core/auth/AuthProvider'
import { useCompany } from '../../core/company/CompanyProvider'
import { useChartTheme } from '../../core/theme/ThemeProvider'
import {
  Badge,
  ConfirmDialog,
  EmptyState,
  ErrorText,
  Field,
  Modal,
  NumberInput,
  Spinner,
  useConfirmDelete,
  useToast,
} from '../../core/ui'
import { KPI_CATEGORIES, type KpiTemplate } from '../../core/catalog'
import KpiSuggestions from './KpiSuggestions'
import MetasOverview from './MetasOverview'
import MetaDetail from './MetaDetail'
import {
  CHECKPOINT_FREQUENCIES,
  CHECKPOINT_FREQUENCY_LABEL,
  FINER_FREQUENCIES,
  FREQUENCIES,
  FREQUENCY_LABEL,
  GOAL_STATUS_LABEL,
  UNIT_LABEL,
  type CheckpointFrequency,
  type Department,
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

export function statusTone(status: GoalStatus) {
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
  department_id: '',
}

// Rascunho do primeiro alvo, oferecido junto na hora de criar a meta —
// opcional, cobre o caso comum (meta + 1 alvo) numa submissão só, sem
// reintroduzir o fluxo de dois passos que motivou fundir os dois em 2026.
const emptyMetaDraft = { target_value: null as number | null, due_date: '', owner_id: '' }

// Tudo que MetasOverview/MetaDetail precisam pra renderizar — computado uma
// vez só aqui (o container), evitando duplicar consulta/lógica nas duas
// telas. Elas são só apresentação: leem `ctx`, chamam os setters de volta.
export type KpisCtx = {
  companyId: string
  companyColor: string
  companyName: string
  canWrite: boolean
  people: Profile[]
  products: Product[]
  editions: ProductEdition[]
  kpis: Kpi[]
  metas: Meta[]
  loading: boolean
  kpiById: Map<string, Kpi>
  metasByKpi: Map<string, Meta[]>
  seriesByKpi: Map<string, KpiValue[]>
  checkpointsByMeta: Map<string, KpiCheckpoint[]>
  childrenByParent: Map<string, Kpi[]>
  effectiveValue: (kpiId: string) => number | null
  rollupFor: (kpiId: string) => { value: number; total: number; reported: number; children: Kpi[] } | null
  ownerName: (id: string | null) => string | null
  productName: (id: string | null) => string | null
  editionName: (id: string | null) => string | null
  nestedLabel: (kpi: Kpi) => string
  openCreate: () => void
  openEdit: (kpi: Kpi) => void
  archiveKpi: (kpi: Kpi) => Promise<void>
  unarchiveKpi: (kpi: Kpi) => Promise<void>
  toggleKpiActive: (kpi: Kpi) => Promise<void>
  setRemovingKpi: (kpi: Kpi | null) => void
  setRemovingMeta: (meta: Meta | null) => void
  setMetaModalFor: (v: { kpi: Kpi; meta: Meta | null } | null) => void
  setEntryFor: (kpi: Kpi | null, reference?: string) => void
  setHistoryFor: (kpi: Kpi | null) => void
  setAttachingTo: (kpi: Kpi | null) => void
  setEditingEntity: (kpi: Kpi | null) => void
}

export default function KpisPage() {
  const { company, canWrite } = useCompany()
  const { notify } = useToast()
  const { kpiId } = useParams<{ kpiId: string }>()

  const [kpis, setKpis] = useState<Kpi[]>([])
  const [metas, setMetas] = useState<Meta[]>([])
  const [values, setValues] = useState<KpiValue[]>([])
  const [entries, setEntries] = useState<KpiValueEntry[]>([])
  const [people, setPeople] = useState<Profile[]>([])
  const [checkpoints, setCheckpoints] = useState<KpiCheckpoint[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [editions, setEditions] = useState<ProductEdition[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
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
  // Período pré-selecionado ao abrir "Lançar valor" a partir de um lápis de
  // editar no Histórico — null quando é um lançamento novo (padrão: hoje).
  const [entryReference, setEntryReference] = useState<string | null>(null)
  // Lançamento fino específico sendo editado (lápis no Histórico, lista de
  // "Lançamentos por dia") — null = lançamento novo. Precisa ser o
  // lançamento inteiro (não só o período) porque agora cabe mais de um no
  // mesmo dia (0037_kpi_value_entries_multiple_per_day.sql).
  const [editingEntry, setEditingEntry] = useState<KpiValueEntry | null>(null)
  const openEntry = useCallback((kpi: Kpi | null, reference?: string, entry?: KpiValueEntry) => {
    setEntryReference(reference ?? null)
    setEditingEntry(entry ?? null)
    setEntryFor(kpi)
  }, [])
  const [historyFor, setHistoryFor] = useState<Kpi | null>(null)
  const [attachingTo, setAttachingTo] = useState<Kpi | null>(null)
  // Meta (kpi) de um nó de produto/turma cujo produto/edição em si (nome,
  // datas) está sendo editado — distinto de openEdit, que edita a meta.
  const [editingEntity, setEditingEntity] = useState<Kpi | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [
      { data: kpiRows },
      { data: memberRows },
      { data: productRows },
      { data: editionRows },
      { data: metaRows },
      { data: departmentRows },
    ] = await Promise.all([
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
      supabase.from('departments').select('*').eq('company_id', company.id).eq('is_active', true).order('display_order'),
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
    setDepartments((departmentRows as Department[]) ?? [])
    setLoading(false)
  }, [company.id])

  useEffect(() => {
    void load()
  }, [load])

  const kpiById = useMemo(() => new Map(kpis.map((item) => [item.id, item])), [kpis])

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

  // Todo descendente (filho, neto...) de um kpi — usado por toggleKpiActive
  // pra ativar/desativar a família inteira de uma vez. `seen` só protege
  // contra ciclo (o banco já impede formar um, mas o cliente não precisa
  // confiar cegamente nisso).
  const descendantIds = useCallback(
    (kpiId: string, seen: Set<string> = new Set()): string[] => {
      if (seen.has(kpiId)) return []
      seen.add(kpiId)
      const children = childrenByParent.get(kpiId) ?? []
      const ids: string[] = []
      for (const child of children) {
        ids.push(child.id)
        ids.push(...descendantIds(child.id, seen))
      }
      return ids
    },
    [childrenByParent],
  )

  // Valor "de verdade" de cada meta — mesmo algoritmo de soma em cadeia que
  // ProductsPage/CompanyDashboard já usam (core/lib/kpiRollup.ts), sem
  // reimplementar a recursão aqui de novo.
  //
  // Só entra quem está ativo e não arquivado — mesmo filtro que todo painel
  // (CompanyDashboard/ProductDashboard/DepartmentDashboard/HoldingDashboard)
  // já aplica na CONSULTA (`.eq('is_active', true).is('archived_at', null)`).
  // Esta tela busca todos os KPIs sem esse filtro de propósito (precisa
  // mostrar o desativado, esmaecido, pra dar pra reativar) — mas o cálculo
  // da soma tem que se comportar igual aos painéis: um produto/turma
  // desativado para de contribuir pro total do pai, senão o número mostrado
  // aqui divergiria do que os painéis mostram.
  const rollupRows = useMemo<RollupRow[]>(
    () =>
      kpis
        .filter((kpi) => kpi.is_active && !kpi.archived_at)
        .map((kpi) => {
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

  const ownerName = useCallback(
    (id: string | null) => (id ? (people.find((person) => person.id === id)?.full_name ?? '—') : null),
    [people],
  )
  const productName = useCallback(
    (id: string | null) => (id ? (products.find((item) => item.id === id)?.name ?? null) : null),
    [products],
  )
  const editionName = useCallback(
    (id: string | null) => (id ? (editions.find((item) => item.id === id)?.name ?? null) : null),
    [editions],
  )

  // Rótulo de um nó: nome do produto (+ edição, se for turma) em vez do nome
  // sintetizado gravado no banco — esse existe só pra satisfazer a
  // constraint de nome único por empresa, não é o texto certo pra tela.
  const nestedLabel = useCallback(
    (kpi: Kpi): string => {
      if (kpi.product_edition_id) return editionName(kpi.product_edition_id) ?? kpi.name
      if (kpi.product_id) return productName(kpi.product_id) ?? kpi.name
      return kpi.name
    },
    [editionName, productName],
  )

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
        status: 'planned',
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
      department_id: kpi.department_id ?? '',
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
      department_id: kpiForm.department_id || null,
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
        status: 'planned',
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

  // Ativar/desativar direto da lista — atalho rápido, sem abrir o modal de
  // editar. Diferente de arquivar (`archiveKpi`, acima): desativar não some
  // com a linha aqui (fica esmaecida, fácil de achar e reverter), só some
  // dos painéis (mesmo `is_active` que eles já filtram na consulta) e para
  // de contar na soma de quem tem produto/turma por baixo (`rollupRows`,
  // acima).
  //
  // Em cascata pra família inteira (raiz + produtos + turmas por baixo):
  // o cartão de Metas mostra tudo isso como UMA coisa só, então
  // ativar/desativar só a raiz deixaria os filhos ativos por baixo,
  // continuando a contar nos painéis e a poluir o cartão "Metas" deles —
  // bug real encontrado (raiz desativada com produtos/turmas ativos por
  // baixo, todos sem nenhum lançamento).
  const toggleKpiActive = async (kpi: Kpi) => {
    const nextActive = !kpi.is_active
    const ids = [kpi.id, ...descendantIds(kpi.id)]
    const { error } = await supabase.from('kpis').update({ is_active: nextActive }).in('id', ids)
    if (error) {
      notify(error.message, 'error')
      return
    }
    const extra = ids.length - 1
    notify(
      extra > 0
        ? `Meta e ${extra} vinculado(s) ${nextActive ? 'ativados' : 'desativados'}.`
        : nextActive
          ? 'Meta ativada.'
          : 'Meta desativada.',
    )
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

  const ctx: KpisCtx = {
    companyId: company.id,
    companyColor: company.color,
    companyName: company.name,
    canWrite,
    people,
    products,
    editions,
    kpis,
    metas,
    loading,
    kpiById,
    metasByKpi,
    seriesByKpi,
    checkpointsByMeta,
    childrenByParent,
    effectiveValue,
    rollupFor,
    ownerName,
    productName,
    editionName,
    nestedLabel,
    openCreate,
    openEdit,
    archiveKpi,
    unarchiveKpi,
    toggleKpiActive,
    setRemovingKpi,
    setRemovingMeta,
    setMetaModalFor,
    setEntryFor: openEntry,
    setHistoryFor,
    setAttachingTo,
    setEditingEntity,
  }

  return (
    <div className="mx-auto max-w-6xl">
      {kpiId ? <MetaDetail ctx={ctx} kpiId={kpiId} /> : <MetasOverview ctx={ctx} />}

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
            {departments.length > 0 && (
              <Field label="Área" hint="Opcional — organiza esta meta junto com as tarefas e o orçamento da mesma área.">
                <select
                  className="input"
                  value={kpiForm.department_id}
                  onChange={(event) => setKpiForm((c) => ({ ...c, department_id: event.target.value }))}
                >
                  <option value="">Sem área</option>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field
              label="Frequência de medição"
              hint={
                FINER_FREQUENCIES[kpiForm.frequency].includes('daily')
                  ? 'Sem opção diária aqui de propósito — pra lançar todo dia, use "Lançar em cadência mais fina" logo abaixo.'
                  : undefined
              }
            >
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
          series={seriesByKpi.get(metaModalFor.kpi.id) ?? []}
          checkpoints={metaModalFor.meta ? checkpointsByMeta.get(metaModalFor.meta.id) ?? [] : []}
          hasChildren={(childrenByParent.get(metaModalFor.kpi.id) ?? []).length > 0}
          childCount={(childrenByParent.get(metaModalFor.kpi.id) ?? []).length}
          childAlvos={(childrenByParent.get(metaModalFor.kpi.id) ?? [])
            .map((child) => (metasByKpi.get(child.id) ?? [])[0])
            .filter((m): m is Meta => m != null)}
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

      {editingEntity && (
        <EditEntityModal
          product={products.find((item) => item.id === editingEntity.product_id) ?? null}
          edition={
            editingEntity.product_edition_id
              ? editions.find((item) => item.id === editingEntity.product_edition_id) ?? null
              : null
          }
          onClose={() => setEditingEntity(null)}
          onSaved={load}
        />
      )}

      {entryFor && (
        <ValueEntryModal
          kpi={entryFor}
          companyId={company.id}
          existing={seriesByKpi.get(entryFor.id) ?? []}
          entries={entriesByKpi.get(entryFor.id) ?? []}
          initialReference={entryReference ?? undefined}
          editingEntry={editingEntry ?? undefined}
          onClose={() => {
            setEntryFor(null)
            setEntryReference(null)
            setEditingEntry(null)
          }}
          onSaved={async () => {
            setEntryFor(null)
            setEntryReference(null)
            setEditingEntry(null)
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
          onEdit={(periodStart, entry) => {
            // Fecha o Histórico ao abrir o lançamento — dois modais
            // empilhados nunca é a intenção (mesma convenção do resto).
            setHistoryFor(null)
            openEntry(historyFor, periodStart, entry)
          }}
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
// Três formas de chegar num produto/turma vinculado — pedido explícito pra
// não obrigar ida até Produtos no meio da criação de uma meta:
// 'existing' vincula algo já cadastrado (fluxo original), 'new' cadastra
// um só na hora, e 'bulk' (só faz sentido pra turma) gera vários de uma vez
// — ex. as 12 turmas mensais de um ano de planejamento, sem repetir o
// formulário 12 vezes.
type AttachMode = 'existing' | 'new' | 'bulk'

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
      ? editions.filter(
          (edition) =>
            edition.product_id === parentKpi.product_id && !edition.archived_at && !alreadyLinked.has(edition.id),
        )
      : products.filter((product) => !alreadyLinked.has(product.id))
  const parentProductName = products.find((item) => item.id === parentKpi.product_id)?.name ?? ''

  const [mode, setMode] = useState<AttachMode>(candidates.length > 0 ? 'existing' : 'new')
  const [candidateId, setCandidateId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Criar um produto/turma só, na hora.
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('') // só produto
  const [newStart, setNewStart] = useState('') // só turma
  const [newEnd, setNewEnd] = useState('') // só turma

  // Criar várias turmas de uma vez — ver core/lib/bulkEditions.ts.
  const [bulkPrefix, setBulkPrefix] = useState(parentProductName)
  const [bulkCount, setBulkCount] = useState(12)
  const [bulkStartMonth, setBulkStartMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [bulkInterval, setBulkInterval] = useState(1)
  const [bulkDurationMode, setBulkDurationMode] = useState<'month' | 'custom'>('month')
  const [bulkStartDay, setBulkStartDay] = useState(1)
  const [bulkDurationDays, setBulkDurationDays] = useState(1)

  const bulkPreview = useMemo(() => {
    if (mode !== 'bulk' || !bulkStartMonth) return []
    return buildBulkEditions({
      prefix: bulkPrefix,
      count: Math.max(1, Math.min(36, bulkCount || 1)),
      startMonth: bulkStartMonth,
      intervalMonths: bulkInterval,
      durationMode: bulkDurationMode,
      startDay: bulkStartDay,
      durationDays: bulkDurationDays,
    })
  }, [mode, bulkPrefix, bulkCount, bulkStartMonth, bulkInterval, bulkDurationMode, bulkStartDay, bulkDurationDays])

  // Cria a linha de meta (kpis) que vincula um produto/turma já existente —
  // mesma lógica pros três modos, só muda se quem chega até aqui já
  // existia ou acabou de ser criado.
  const linkChild = (productId: string, editionId: string | null, entityName: string) => {
    // `parentKpi.name` já é o nome completo do nó pai — pra turma, o nó pai
    // é o produto, e o nome DELE já foi sintetizado como "{meta} · {produto}"
    // quando ele mesmo foi vinculado (ver o branch de baixo). Repetir
    // `parentProductName` aqui de novo duplicava ("... · Entre Donos ·
    // Entre Donos · ..."). Só a turma entra por cima do que já existe.
    const name = `${parentKpi.name} · ${entityName}`
    return supabase.from('kpis').insert({
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
  }

  const submitExisting = async (event: FormEvent) => {
    event.preventDefault()
    if (!candidateId) {
      setError(level === 'turma' ? 'Escolha uma turma.' : 'Escolha um produto.')
      return
    }
    setError('')
    setBusy(true)
    const { error: insertError } =
      level === 'turma'
        ? await linkChild(parentKpi.product_id!, candidateId, editions.find((item) => item.id === candidateId)!.name)
        : await linkChild(candidateId, null, products.find((item) => item.id === candidateId)!.name)
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

  const submitNew = async (event: FormEvent) => {
    event.preventDefault()
    if (!newName.trim()) {
      setError(level === 'turma' ? 'Dê um nome à turma.' : 'Dê um nome ao produto.')
      return
    }
    setError('')
    setBusy(true)
    if (level === 'turma') {
      const { data: edition, error: insertError } = await supabase
        .from('product_editions')
        .insert({
          product_id: parentKpi.product_id,
          company_id: companyId,
          name: newName.trim(),
          start_date: newStart || null,
          end_date: newEnd || null,
        })
        .select()
        .single()
      if (insertError || !edition) {
        setBusy(false)
        setError(
          insertError?.code === '23505'
            ? 'Já existe uma turma com esse nome neste produto.'
            : insertError?.message ?? 'Erro ao criar turma.',
        )
        return
      }
      const { error: linkError } = await linkChild(parentKpi.product_id!, edition.id, edition.name)
      setBusy(false)
      if (linkError) {
        setError(linkError.message)
        return
      }
      notify('Turma criada e vinculada.')
    } else {
      const { data: product, error: insertError } = await supabase
        .from('products')
        .insert({
          company_id: companyId,
          name: newName.trim(),
          description: newDescription.trim() || null,
          display_order: products.length,
        })
        .select()
        .single()
      if (insertError || !product) {
        setBusy(false)
        setError(
          insertError?.code === '23505'
            ? 'Já existe um produto com esse nome nesta empresa.'
            : insertError?.message ?? 'Erro ao criar produto.',
        )
        return
      }
      const { error: linkError } = await linkChild(product.id, null, product.name)
      setBusy(false)
      if (linkError) {
        setError(linkError.message)
        return
      }
      notify('Produto criado e vinculado.')
    }
    await onSaved()
    onClose()
  }

  const submitBulk = async (event: FormEvent) => {
    event.preventDefault()
    if (!bulkStartMonth) {
      setError('Escolha o mês/ano da primeira turma.')
      return
    }
    if (bulkPreview.length === 0) return
    setError('')
    setBusy(true)
    const { data: newEditions, error: insertError } = await supabase
      .from('product_editions')
      .insert(bulkPreview.map((row) => ({ ...row, product_id: parentKpi.product_id, company_id: companyId })))
      .select()
    if (insertError || !newEditions) {
      setBusy(false)
      setError(
        insertError?.code === '23505'
          ? 'Já existe uma turma com um desses nomes neste produto.'
          : insertError?.message ?? 'Erro ao criar as turmas.',
      )
      return
    }
    const kpiRows = newEditions.map((edition) => ({
      company_id: companyId,
      // Mesma correção de linkChild: `parentKpi.name` já inclui o produto.
      name: `${parentKpi.name} · ${edition.name}`,
      category: parentKpi.category,
      unit: parentKpi.unit,
      direction: parentKpi.direction,
      frequency: parentKpi.frequency,
      product_id: parentKpi.product_id,
      product_edition_id: edition.id,
      parent_kpi_id: parentKpi.id,
      is_active: true,
    }))
    const { error: kpiError } = await supabase.from('kpis').insert(kpiRows)
    setBusy(false)
    if (kpiError) {
      setError(kpiError.message)
      return
    }
    notify(`${newEditions.length} turma(s) criada(s) e vinculada(s).`)
    await onSaved()
    onClose()
  }

  const tabClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-xs font-medium transition ${
      active ? 'bg-brand/10 text-brand-text' : 'text-content-muted hover:bg-hover'
    }`

  return (
    <Modal
      open
      title={level === 'turma' ? `Vincular turma · ${parentKpi.name}` : `Vincular produto · ${parentKpi.name}`}
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          {(mode !== 'existing' || candidates.length > 0) && (
            <button
              type="submit"
              form="attach-form"
              className="btn-primary"
              disabled={busy || (mode === 'bulk' && bulkPreview.length === 0)}
            >
              {busy && <Spinner />}
              {mode === 'existing' && 'Vincular'}
              {mode === 'new' && 'Criar e vincular'}
              {mode === 'bulk' && `Criar ${bulkPreview.length || ''} turma(s)`}
            </button>
          )}
        </>
      }
    >
      {/* Abas só aparecem quando fazem sentido: "Vincular existente" some
          se não sobrou nenhum candidato; "Criar várias" só existe pra
          turma. */}
      <div className="mb-4 inline-flex rounded-lg border border-line-strong p-0.5">
        {candidates.length > 0 && (
          <button type="button" onClick={() => setMode('existing')} className={tabClass(mode === 'existing')}>
            Vincular existente
          </button>
        )}
        <button type="button" onClick={() => setMode('new')} className={tabClass(mode === 'new')}>
          Criar {level === 'turma' ? 'turma' : 'produto'}
        </button>
        {level === 'turma' && (
          <button type="button" onClick={() => setMode('bulk')} className={tabClass(mode === 'bulk')}>
            Criar várias
          </button>
        )}
      </div>

      {mode === 'existing' &&
        (candidates.length === 0 ? (
          <p className="text-sm text-content-soft">
            {level === 'turma'
              ? 'Todas as turmas deste produto já estão vinculadas aqui, ou o produto ainda não tem turma cadastrada.'
              : 'Todos os produtos cadastrados já estão vinculados a esta meta, ou nenhum produto foi cadastrado ainda.'}
          </p>
        ) : (
          <form id="attach-form" onSubmit={submitExisting} className="space-y-4">
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
        ))}

      {mode === 'new' && (
        <form id="attach-form" onSubmit={submitNew} className="space-y-4">
          <Field label={level === 'turma' ? 'Nome da turma' : 'Nome do produto'}>
            <input
              className="input"
              required
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={level === 'turma' ? 'Ex.: Imersão Março 2027' : 'Ex.: Entre Donos'}
            />
          </Field>
          {level === 'turma' ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Início">
                <input
                  className="input"
                  type="date"
                  value={newStart}
                  onChange={(event) => setNewStart(event.target.value)}
                />
              </Field>
              <Field label="Fim">
                <input className="input" type="date" value={newEnd} onChange={(event) => setNewEnd(event.target.value)} />
              </Field>
            </div>
          ) : (
            <Field label="Descrição">
              <textarea
                className="input min-h-16"
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
              />
            </Field>
          )}
          {error && <ErrorText>{error}</ErrorText>}
        </form>
      )}

      {mode === 'bulk' && (
        <form id="attach-form" onSubmit={submitBulk} className="space-y-4">
          <Field label="Prefixo do nome" hint='Ex.: "Imersão" vira "Imersão Março 2027".'>
            <input className="input" value={bulkPrefix} onChange={(event) => setBulkPrefix(event.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Quantidade de turmas">
              <input
                className="input"
                type="number"
                min={1}
                max={36}
                value={bulkCount}
                onChange={(event) => setBulkCount(Number(event.target.value))}
              />
            </Field>
            <Field label="Mês/ano da primeira">
              <input
                className="input"
                type="month"
                required
                value={bulkStartMonth}
                onChange={(event) => setBulkStartMonth(event.target.value)}
              />
            </Field>
          </div>
          <Field label="Intervalo entre turmas">
            <select
              className="input"
              value={bulkInterval}
              onChange={(event) => setBulkInterval(Number(event.target.value))}
            >
              <option value={1}>A cada mês</option>
              <option value={2}>A cada 2 meses</option>
              <option value={3}>A cada 3 meses (trimestral)</option>
              <option value={6}>A cada 6 meses (semestral)</option>
            </select>
          </Field>
          <Field label="Duração de cada turma">
            <select
              className="input"
              value={bulkDurationMode}
              onChange={(event) => setBulkDurationMode(event.target.value as 'month' | 'custom')}
            >
              <option value="month">Mês inteiro</option>
              <option value="custom">Alguns dias (evento)</option>
            </select>
          </Field>
          {bulkDurationMode === 'custom' && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Dia de início no mês">
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={31}
                  value={bulkStartDay}
                  onChange={(event) => setBulkStartDay(Number(event.target.value))}
                />
              </Field>
              <Field label="Duração (dias)">
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={31}
                  value={bulkDurationDays}
                  onChange={(event) => setBulkDurationDays(Number(event.target.value))}
                />
              </Field>
            </div>
          )}
          {bulkPreview.length > 0 && (
            <div className="rounded-lg bg-hover px-3 py-2 text-xs text-content-soft">
              <p className="font-medium text-content">Prévia: {bulkPreview.length} turma(s)</p>
              <p className="mt-1">
                {bulkPreview[0].name} ({formatDate(bulkPreview[0].start_date)}–{formatDate(bulkPreview[0].end_date)})
                {bulkPreview.length > 1 && <> … {bulkPreview[bulkPreview.length - 1].name}</>}
              </p>
            </div>
          )}
          {error && <ErrorText>{error}</ErrorText>}
        </form>
      )}
    </Modal>
  )
}

// Edita o produto ou a turma em si (nome, datas) — não a meta vinculada a
// ele. `edition` vem preenchido só quando o nó é de turma; `product` sempre
// vem preenchido (toda turma pertence a um produto).
function EditEntityModal({
  product,
  edition,
  onClose,
  onSaved,
}: {
  product: Product | null
  edition: ProductEdition | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { notify } = useToast()
  const [form, setForm] = useState({
    name: edition ? edition.name : product?.name ?? '',
    description: product?.description ?? '',
    start_date: edition?.start_date ?? '',
    end_date: edition?.end_date ?? '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!product) return null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!form.name.trim()) {
      setError('Dê um nome.')
      return
    }
    setError('')
    setBusy(true)
    const result = edition
      ? await supabase
          .from('product_editions')
          .update({
            name: form.name.trim(),
            start_date: form.start_date || null,
            end_date: form.end_date || null,
          })
          .eq('id', edition.id)
      : await supabase
          .from('products')
          .update({ name: form.name.trim(), description: form.description.trim() || null })
          .eq('id', product.id)
    setBusy(false)
    if (result.error) {
      setError(result.error.message)
      return
    }
    notify(edition ? 'Turma atualizada.' : 'Produto atualizado.')
    await onSaved()
    onClose()
  }

  return (
    <Modal
      open
      title={edition ? `Editar turma · ${edition.name}` : `Editar produto · ${product.name}`}
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="entity-form" className="btn-primary" disabled={busy}>
            {busy && <Spinner />}
            Salvar
          </button>
        </>
      }
    >
      <form id="entity-form" onSubmit={submit} className="space-y-4">
        <Field label="Nome">
          <input
            className="input"
            required
            value={form.name}
            onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))}
          />
        </Field>
        {edition ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Início">
              <input
                className="input"
                type="date"
                value={form.start_date}
                onChange={(event) => setForm((c) => ({ ...c, start_date: event.target.value }))}
              />
            </Field>
            <Field label="Fim">
              <input
                className="input"
                type="date"
                value={form.end_date}
                onChange={(event) => setForm((c) => ({ ...c, end_date: event.target.value }))}
              />
            </Field>
          </div>
        ) : (
          <Field label="Descrição">
            <textarea
              className="input min-h-16"
              value={form.description}
              onChange={(event) => setForm((c) => ({ ...c, description: event.target.value }))}
            />
          </Field>
        )}
        {error && <ErrorText>{error}</ErrorText>}
      </form>
    </Modal>
  )
}

// ------------------------------------------------------------------ meta
export function MetaFormModal({
  kpi,
  meta,
  people,
  series,
  checkpoints,
  hasChildren,
  childCount,
  childAlvos,
  onClose,
  onSaved,
}: {
  kpi: Kpi
  meta: Meta | null
  people: Profile[]
  series: KpiValue[]
  checkpoints: KpiCheckpoint[]
  // Meta já tem produto/turma por baixo — a tabela "Como este número se
  // divide" já É o acompanhamento por período nesse caso (com dados de
  // verdade, não um cronograma abstrato); repartir por período junto
  // criaria duas respostas desencontradas pra mesma pergunta.
  hasChildren: boolean
  // Total de produto(s)/turma(s) vinculados, com ou sem alvo definido —
  // usado só pra avisar quando a soma abaixo é parcial (nem todo filho tem
  // alvo ainda), nunca pra esconder ou travar o campo.
  childCount: number
  // Alvo (mais recente) de cada filho que já tem um — ver botão "Usar soma
  // dos filhos" abaixo. Continua sendo um preenchimento manual e pontual,
  // não um vínculo permanente: depois de clicado, os campos viram normais,
  // editáveis, e não se atualizam sozinhos se um filho mudar depois.
  childAlvos: Meta[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { notify } = useToast()
  const [splitFrequency, setSplitFrequency] = useState<CheckpointFrequency>(
    checkpoints[0]?.frequency ?? 'monthly',
  )
  const [form, setForm] = useState({
    target_value: meta?.target_value ?? null,
    due_date: meta?.due_date ?? '',
    owner_id: meta?.owner_id ?? '',
    status: meta?.status ?? ('planned' as GoalStatus),
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Soma dos alvos já definidos nos filhos + o prazo mais distante entre
  // eles — só usados quando a pessoa clica em "Usar soma dos filhos"
  // (nunca sozinhos): ver debate na conversa sobre por que isso não é
  // automático nem obrigatório (perde a flexibilidade de planejar de cima
  // pra baixo, e uma soma parcial silenciosa é pior que não ter soma).
  const childrenSum = useMemo(() => {
    const withTarget = childAlvos.filter((m) => m.target_value != null)
    if (!withTarget.length) return null
    const sum = withTarget.reduce((acc, m) => acc + Number(m.target_value), 0)
    const dueDates = childAlvos.map((m) => m.due_date).filter((d): d is string => Boolean(d))
    const maxDue = dueDates.length ? dueDates.reduce((a, b) => (a > b ? a : b)) : null
    return { sum, maxDue, definedCount: withTarget.length }
  }, [childAlvos])

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

  // Divide o alvo final em parcelas iguais na periodicidade escolhida — alvo
  // de 100 em 4 meses vira 4 parcelas de 25 (não mais um acumulado: ver
  // splitTargetIntoPeriods). Refazer substitui a divisão anterior inteira,
  // não soma em cima. Só existe editando um alvo que já foi salvo (precisa
  // de um meta_id de verdade pra gravar).
  const repartir = async () => {
    if (!meta || !meta.due_date || meta.target_value === null) return
    const chunks = splitTargetIntoPeriods(new Date(), new Date(`${meta.due_date}T00:00:00`), splitFrequency, meta.target_value)
    const rows = chunks.map((chunk) => ({
      meta_id: meta.id,
      company_id: kpi.company_id,
      seq: chunk.seq,
      period_start: chunk.period_start,
      period_end: chunk.period_end,
      target_value: chunk.target_value,
      frequency: splitFrequency,
    }))

    setBusy(true)
    await supabase.from('kpi_checkpoints').delete().eq('meta_id', meta.id)
    const { error: insertError } = await supabase.from('kpi_checkpoints').insert(rows)
    setBusy(false)
    if (insertError) {
      notify(insertError.message, 'error')
      return
    }
    notify(`Alvo repartido em ${rows.length} parcela(s) de ${CHECKPOINT_FREQUENCY_LABEL[splitFrequency].toLowerCase()}.`)
    await onSaved()
  }

  const limparRepartição = useConfirmDelete<true>(async () => {
    if (!meta) return
    const { error: deleteError } = await supabase.from('kpi_checkpoints').delete().eq('meta_id', meta.id)
    if (deleteError) {
      notify(deleteError.message, 'error')
      return
    }
    notify('Divisão removida.')
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
        {/* Preenchimento manual e pontual — nunca automático nem travado — pra
            não obrigar a digitar de novo um número que já existe embaixo
            (produto/turma). Um clique só; depois disso o campo é um alvo
            normal, e continua editável mesmo que os filhos mudem depois. */}
        {childrenSum && (
          <button
            type="button"
            className="-mt-2 flex items-center gap-1.5 text-xs text-brand-text hover:underline"
            onClick={() =>
              setForm((c) => ({
                ...c,
                target_value: childrenSum.sum,
                due_date: childrenSum.maxDue ?? c.due_date,
              }))
            }
          >
            <Layers className="h-3.5 w-3.5 shrink-0" />
            Usar soma d{kpi.product_id ? 'as turmas' : 'os produtos'} vinculados: {formatValue(childrenSum.sum, kpi.unit)}
            {childrenSum.definedCount < childCount && ` (só ${childrenSum.definedCount} de ${childCount} já tem alvo)`}
          </button>
        )}
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

      {/* Repartição por período só existe pra um alvo já salvo (precisa de
          um id de verdade) — some da tela na hora de criar um alvo novo. O
          progresso detalhado de cada parcela (valor lançado x cota, %) fica
          no Detalhe da meta, com mais espaço — aqui só a divisão em si.
          Também some quando a meta já tem produto/turma por baixo: "Como
          este número se divide" já é o acompanhamento por período nesse
          caso (com dados de verdade), e deixar as duas coisas juntas cria
          duas respostas desencontradas pra mesma pergunta. */}
      {meta && !hasChildren && (
        <div className="mt-5 rounded-lg border border-line p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-medium text-content">
              <CalendarRange className="h-4 w-4 text-content-faint" /> Repartir por período
            </p>
            {meta.target_value !== null && (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="input py-1 text-xs"
                  value={splitFrequency}
                  disabled={busy}
                  aria-label="Periodicidade da repartição"
                  onChange={(event) => setSplitFrequency(event.target.value as CheckpointFrequency)}
                >
                  {CHECKPOINT_FREQUENCIES.map((freq) => (
                    <option key={freq} value={freq}>
                      {CHECKPOINT_FREQUENCY_LABEL[freq]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-ghost py-1 text-xs"
                  disabled={busy}
                  onClick={() => void repartir()}
                >
                  {checkpoints.length ? 'Refazer divisão' : 'Repartir'}
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
            <p className="mt-2 text-xs text-content-soft">Defina um alvo pra poder repartir por período.</p>
          ) : checkpoints.length === 0 ? (
            <p className="mt-2 text-xs text-content-soft">
              Sem divisão ainda — cada período pede uma cota igual do alvo final.
            </p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {checkpoints.map((checkpoint) => {
                const actual = sumValuesInRange(series, checkpoint.period_start, checkpoint.period_end)
                const pct =
                  actual !== null && checkpoint.target_value ? Math.round((actual / checkpoint.target_value) * 100) : null
                return (
                  <li key={checkpoint.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-content-soft">
                      {CHECKPOINT_FREQUENCY_LABEL[checkpoint.frequency]} {checkpoint.seq} ·{' '}
                      {formatDate(checkpoint.period_start)}–{formatDate(checkpoint.period_end)}
                    </span>
                    <span className="flex items-center gap-2">
                      <NumberInput
                        unit={kpi.unit}
                        value={checkpoint.target_value}
                        onChange={(value) => void updateCheckpoint(checkpoint.id, value)}
                      />
                      <Badge tone={pct === null ? 'slate' : pct >= 100 ? 'green' : pct >= 70 ? 'amber' : 'red'}>
                        {pct === null ? 'sem lanç.' : `${pct}%`}
                      </Badge>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {/* Meta ganhou produto/turma DEPOIS de já ter sido repartida por
          período — a divisão antiga fica órfã (nem aparece mais em lugar
          nenhum, já que a seção acima some com hasChildren) e só confunde
          se continuar guardada. Oferece apagar em vez de deixar lixo. */}
      {meta && hasChildren && checkpoints.length > 0 && (
        <div className="mt-5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-content">
            <CalendarRange className="h-4 w-4 text-amber-600 dark:text-amber-400" /> Divisão por período desatualizada
          </p>
          <p className="mt-1 text-xs text-content-soft">
            Esta meta tinha sido repartida em {checkpoints.length} parcela(s) antes de ganhar produto/turma — agora
            "Como este número se divide" já mostra o acompanhamento de verdade, então essa divisão antiga não
            aparece mais em lugar nenhum.
          </p>
          <button
            type="button"
            className="mt-2 text-xs text-rose-600 hover:underline dark:text-rose-400"
            onClick={() => limparRepartição.ask(true)}
          >
            Remover divisão antiga
          </button>
        </div>
      )}
    </Modal>
    <ConfirmDialog
      open={limparRepartição.target !== null}
      title="Limpar divisão?"
      message="As parcelas já definidas são apagadas. Você pode repartir de novo depois."
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
export function ValueEntryModal({
  kpi,
  companyId,
  existing,
  entries,
  initialReference,
  editingEntry,
  onClose,
  onSaved,
}: {
  kpi: Kpi
  companyId: string
  existing: KpiValue[]
  entries: KpiValueEntry[]
  // Período pré-selecionado ao abrir a partir do lápis de editar no
  // Histórico — undefined/omitido = lançamento novo (padrão: hoje).
  initialReference?: string
  // Presente = editando ESTE lançamento fino específico (vindo do lápis no
  // Histórico). Ausente = lançamento novo — com vários lançamentos por dia
  // permitidos (ver 0037_kpi_value_entries_multiple_per_day.sql), não dá
  // mais pra decidir "é edição" só pelo dia escolhido bater com um já
  // existente, precisa saber QUAL lançamento é (por id).
  editingEntry?: KpiValueEntry
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { notify } = useToast()
  const { profile } = useAuth()
  // Quando o KPI tem uma cadência de lançamento mais fina (entry_frequency),
  // é ela que decide o período do formulário — o banco soma sozinho pro
  // total no período da frequência declarada (frequency), via gatilho.
  // Checagem por "falso" (não por === null) de propósito: em dado vindo de
  // fora do banco de verdade (ex. simulação de teste) o campo pode vir
  // ausente (undefined) em vez de nulo — mesma classe de bug já corrigida
  // em MetaDetail.tsx (canAttachChild).
  const usesEntries = Boolean(kpi.entry_frequency)
  const entryFrequency = kpi.entry_frequency ?? kpi.frequency

  // A frequência já diz o tamanho do período — pedir início E fim toda vez
  // que alguém lança um valor é redundante. Um único campo de referência
  // basta: a pessoa escolhe qualquer dia dentro do período (hoje, por
  // padrão) e o sistema calcula o intervalo certo sozinho. Calendário
  // completo (type="date"), sem horário — só o dia importa pra decidir o
  // período.
  const [reference, setReference] = useState(() => initialReference ?? new Date().toISOString().slice(0, 10))
  const [value, setValue] = useState<number | null>(() => (editingEntry ? Number(editingEntry.value) : null))
  const [note, setNote] = useState(() => editingEntry?.note ?? '')
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
  // Exclui o próprio lançamento sendo editado (por id, não mais por dia —
  // com vários lançamentos no mesmo dia permitidos, "o dia bate" não quer
  // dizer "é o mesmo lançamento"). Lançamento novo não exclui nada: ele
  // ainda não existe, então o total já lançado é o total de verdade.
  const coarseEntries = useMemo(
    () =>
      coarseBounds
        ? entries.filter(
            (item) =>
              item.period_start >= coarseBounds.start &&
              item.period_start <= coarseBounds.end &&
              item.id !== editingEntry?.id,
          )
        : [],
    [entries, coarseBounds, editingEntry],
  )
  const coarseTotal = coarseEntries.reduce((sum, item) => sum + Number(item.value), 0)

  // Editar é uma ação explícita agora (veio do lápis no Histórico, com o
  // lançamento certo em mãos) — não dá mais pra inferir "é edição" só
  // porque o dia escolhido já tem algum valor, já que vários lançamentos
  // cabem no mesmo dia (0037_kpi_value_entries_multiple_per_day.sql). Pra
  // quem lança direto no período (sem entry_frequency), isso não muda: ali
  // o período AINDA é único por natureza (kpi_values continua um valor só
  // por período), então "o período já tem valor" continua querendo dizer
  // "é edição".
  const isEditing = usesEntries ? Boolean(editingEntry) : existing.some((item) => item.period_start === periodStart)

  // Sincroniza valor/observação com o que já está salvo SÓ no modo sem
  // entry_frequency, onde um período só pode ter um valor — trocar de dia
  // no formulário precisa refletir o que já existe naquele dia (ou limpar,
  // se não existir nada). Bug relatado: só sincronizar quando `periodStart`
  // MUDA de verdade (guarda por ref), não a cada vez que o efeito roda —
  // `existing` vem de fora (`?? []` cria uma referência nova toda vez que o
  // componente pai re-renderiza, mesmo sem o período ter mudado), e sem
  // essa guarda o efeito rodava de novo e sobrescrevia o que a pessoa
  // estava digitando de volta pro valor salvo — o formulário parecia
  // travado e "não salvava o lançamento atual". No modo com
  // entry_frequency, valor/observação só vêm de `editingEntry` (seedado uma
  // vez no useState acima) — trocar o dia num lançamento NOVO nunca deve
  // apagar o que a pessoa já digitou.
  const syncedPeriodRef = useRef<string | null>(null)
  useEffect(() => {
    if (usesEntries) return
    if (syncedPeriodRef.current === periodStart) return
    syncedPeriodRef.current = periodStart
    const found = existing.find((item) => item.period_start === periodStart)
    setValue(found ? Number(found.value) : null)
    setNote(found?.note ?? '')
  }, [periodStart, existing, usesEntries])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (value === null) {
      setError('Informe o valor apurado.')
      return
    }

    setBusy(true)
    const occurredAt = new Date(`${reference}T12:00:00`).toISOString()
    // Com entry_frequency, "lançar" nunca mais é upsert por período — vários
    // lançamentos cabem no mesmo dia agora, então editar precisa mirar o ID
    // certo (editingEntry), e um lançamento novo é sempre um insert, nunca
    // substitui um lançamento existente no mesmo dia por engano.
    const { error: upsertError } = usesEntries
      ? editingEntry
        ? await supabase
            .from('kpi_value_entries')
            .update({ value, note: note.trim() || null, occurred_at: occurredAt })
            .eq('id', editingEntry.id)
        : await supabase.from('kpi_value_entries').insert({
            kpi_id: kpi.id,
            company_id: companyId,
            period_start: periodStart,
            period_end: periodEnd,
            value,
            note: note.trim() || null,
            created_by: profile?.id ?? null,
            occurred_at: occurredAt,
          })
      : await supabase.from('kpi_values').upsert(
          {
            kpi_id: kpi.id,
            company_id: companyId,
            period_start: periodStart,
            period_end: periodEnd,
            value,
            note: note.trim() || null,
            source: 'manual',
            occurred_at: occurredAt,
          },
          { onConflict: 'kpi_id,period_start' },
        )
    setBusy(false)

    if (upsertError) {
      setError(upsertError.message)
      return
    }
    notify(isEditing ? 'Lançamento atualizado.' : 'Valor lançado.')
    await onSaved()
    onClose()
  }

  return (
    <Modal
      open
      title={`${isEditing ? 'Editar lançamento' : 'Lançar valor'} · ${kpi.name}`}
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
          <input
            className="input"
            type="date"
            required
            value={reference}
            onChange={(event) => setReference(event.target.value)}
          />
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
            {coarseEntries.length > 0 && ` em ${coarseEntries.length} lançamento(s)`}
            {editingEntry ? ' (sem contar este lançamento).' : '.'}
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
export function HistoryModal({
  kpi,
  series,
  entries,
  canWrite,
  onClose,
  onChanged,
  onEdit,
}: {
  kpi: Kpi
  series: KpiValue[]
  entries: KpiValueEntry[]
  canWrite: boolean
  onClose: () => void
  onChanged: () => Promise<void>
  // Abre o mesmo modal de "Lançar valor", pré-preenchido com este período —
  // passar o `entry` (lista de lançamentos finos) faz abrir editando ELE
  // especificamente; sem `entry` (lista grossa, sem entry_frequency) é o
  // período que decide se vira edição, como sempre foi.
  onEdit: (periodStart: string, entry?: KpiValueEntry) => void
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
                  <span className="text-content-soft">
                    {labelPeriod(item.period_start, kpi.entry_frequency!)}
                    {item.occurred_at && (
                      <span className="ml-1.5 text-xs text-content-faint">· {formatDate(item.occurred_at)}</span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-content">{formatValue(Number(item.value), kpi.unit)}</span>
                    {canWrite && (
                      <>
                        <button
                          type="button"
                          className="rounded-md p-1 text-content-faint hover:bg-hover hover:text-content"
                          onClick={() => onEdit(item.period_start, item)}
                          aria-label="Editar lançamento fino"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="rounded-md p-1 text-content-faint hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400"
                          onClick={() => removeEntry.ask(item)}
                          aria-label="Remover lançamento fino"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
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
                <th className="py-2">Lançado em</th>
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
                  <td className="py-2 text-xs text-content-soft">
                    {item.occurred_at ? formatDate(item.occurred_at) : '—'}
                  </td>
                  <td className="py-2 font-medium">{formatValue(Number(item.value), kpi.unit)}</td>
                  <td className="py-2 text-xs text-content-soft">
                    {item.source === 'integration' ? 'integração' : 'manual'}
                  </td>
                  <td className="py-2 text-xs text-content-soft">{item.note ?? '—'}</td>
                  {canWrite && (
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        className="rounded-md p-1 text-content-faint hover:bg-hover hover:text-content"
                        onClick={() => onEdit(item.period_start)}
                        aria-label="Editar lançamento"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
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
