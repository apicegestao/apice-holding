// Produtos: as frentes de produto/serviço dentro de uma empresa — caso real
// que motivou este módulo: a MDD (Mesa dos Donos) controla "Entre Donos",
// "Imersão", "Mentoria" e "Club" ao mesmo tempo. Frente recorrente (Entre
// Donos, Imersão) cadastra uma edição por turma/encontro; frente contínua
// (Mentoria, Club) pode não ter edição nenhuma — funciona sozinha.
//
// Esta tela é cadastro PURO: nome, descrição, edições (turma/encontro,
// com data). Nenhuma meta é criada nem editada por aqui — vincular um
// produto/turma a uma meta acontece de dentro do cartão dela, na tela de
// Metas (?vincular produto"/"turma"). O que aparece aqui é só uma lista de
// leitura mostrando em quais metas cada produto/turma já é acompanhado
// (nome + valor atual, já com a soma dos filhos incluída — mesma cadeia
// turma → produto → empresa de sempre, ver `kpiRollup.ts`), mais um atalho
// pra vincular vários indicadores de uma vez.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { CalendarRange, ClipboardList, Pencil, Plus, Target, Trash2 } from 'lucide-react'
import { supabase } from '../../core/lib/supabase'
import { formatDate, formatValue } from '../../core/lib/format'
import { buildChildrenByParent, contributionRatio, effectiveKpiValue } from '../../core/lib/kpiRollup'
import { useCompany } from '../../core/company/CompanyProvider'
import {
  Badge,
  ConfirmDialog,
  EmptyState,
  ErrorText,
  Field,
  Loading,
  Modal,
  PageHeader,
  Spinner,
  useConfirmDelete,
  useToast,
} from '../../core/ui'
import { COMPANY_PALETTE } from '../companies/CompanyFields'
import { type KpiTemplate } from '../../core/catalog'
import KpiSuggestions from '../kpis/KpiSuggestions'
import {
  PRODUCT_EDITION_STATUS_LABEL,
  type Kpi,
  type KpiDirection,
  type KpiFrequency,
  type KpiLatestValue,
  type KpiUnit,
  type Product,
  type ProductEdition,
  type ProductEditionStatus,
} from '../../core/types'

const EDITION_STATUSES: ProductEditionStatus[] = ['planejamento', 'em_andamento', 'encerrado']
const EDITION_STATUS_TONE: Record<ProductEditionStatus, 'slate' | 'blue' | 'green'> = {
  planejamento: 'slate',
  em_andamento: 'blue',
  encerrado: 'green',
}

type ProductForm = { name: string; description: string; is_active: boolean }
const blankForm: ProductForm = { name: '', description: '', is_active: true }

type EditionForm = { name: string; start_date: string; end_date: string }
const blankEditionForm: EditionForm = { name: '', start_date: '', end_date: '' }

// Maior valor primeiro; `null` (sem lançamento ainda) sempre por último —
// nunca empatado com quem já lançou zero.
function byValueDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return b - a
}

// Tarefa enxuta só com o que esta tela precisa contar — nada de trazer
// título/descrição de toda tarefa da empresa à toa.
type TaskCount = { id: string; product_id: string | null; status: string }

// Uma meta ativa entra aqui com lançamento ou não — uma meta que só soma os
// filhos (ex. a do produto, que nunca lança direto) não pode sumir da tela
// por nunca ter uma linha própria em kpi_values. Produto e edição não têm
// alvo próprio — só medição, este é o único tipo de linha que a tela usa
// pra "como está indo".
type ProductKpiRow = {
  kpi_id: string
  name: string
  unit: KpiUnit
  direction: KpiDirection
  value: number | null
  product_id: string | null
  product_edition_id: string | null
  parent_kpi_id: string | null
}

export default function ProductsPage() {
  const { company, canWrite } = useCompany()
  const { notify } = useToast()

  const [products, setProducts] = useState<Product[]>([])
  const [editions, setEditions] = useState<ProductEdition[]>([])
  const [kpiDefs, setKpiDefs] = useState<Kpi[]>([])
  const [kpiValues, setKpiValues] = useState<KpiLatestValue[]>([])
  const [tasks, setTasks] = useState<TaskCount[]>([])
  const [loading, setLoading] = useState(true)

  const [activeId, setActiveId] = useState<string | null>(null)
  const [modal, setModal] = useState<{ editing: Product | null } | null>(null)
  const [form, setForm] = useState<ProductForm>(blankForm)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editionForm, setEditionForm] = useState<EditionForm>(blankEditionForm)
  const [editingEdition, setEditingEdition] = useState<ProductEdition | null>(null)
  const [attachEditionFor, setAttachEditionFor] = useState<ProductEdition | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [
      { data: productRows },
      { data: editionRows },
      { data: kpiDefRows },
      { data: kpiValueRows },
      { data: taskRows },
    ] = await Promise.all([
      supabase.from('products').select('*').eq('company_id', company.id).order('display_order'),
      supabase
        .from('product_editions')
        .select('*')
        .eq('company_id', company.id)
        .order('start_date', { ascending: false, nullsFirst: false }),
      supabase.from('kpis').select('*').eq('company_id', company.id).eq('is_active', true).is('archived_at', null),
      supabase.from('kpi_latest_values').select('*').eq('company_id', company.id).is('archived_at', null),
      supabase.from('tasks').select('id, product_id, status').eq('company_id', company.id),
    ])
    setProducts((productRows as Product[]) ?? [])
    setEditions((editionRows as ProductEdition[]) ?? [])
    setKpiDefs((kpiDefRows as Kpi[]) ?? [])
    setKpiValues((kpiValueRows as KpiLatestValue[]) ?? [])
    setTasks((taskRows as TaskCount[]) ?? [])
    setLoading(false)
  }, [company.id])

  useEffect(() => {
    void load()
  }, [load])

  const kpiRows = useMemo<ProductKpiRow[]>(
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

  // Soma em cadeia (turma → produto → empresa): uma meta com filhos nunca
  // lança direto, o valor dela é sempre a soma deles.
  const childrenByParent = useMemo(() => buildChildrenByParent(kpiRows), [kpiRows])
  const kpiRowById = useMemo(() => new Map(kpiRows.map((row) => [row.kpi_id, row])), [kpiRows])
  const effectiveValue = useCallback(
    (kpiId: string) => effectiveKpiValue(kpiId, childrenByParent, kpiRowById),
    [childrenByParent, kpiRowById],
  )

  // Contribuição de uma meta pra meta-mãe dela (ex.: "9% de Faturamento") —
  // só existe quando a linha tem pai (toda meta de produto/turma tem, é a
  // meta raiz da empresa ou, no caso da turma, a meta do produto).
  const contributionFor = useCallback(
    (row: ProductKpiRow): { ratio: number | null; parentName: string | null } => {
      if (!row.parent_kpi_id) return { ratio: null, parentName: null }
      return {
        ratio: contributionRatio(effectiveValue(row.kpi_id), effectiveValue(row.parent_kpi_id)),
        parentName: kpiRowById.get(row.parent_kpi_id)?.name ?? null,
      }
    },
    [effectiveValue, kpiRowById],
  )

  // Metas próprias de cada turma (sem edição = do produto, ver
  // `statsByProduct` abaixo) — mapa pra não refiltrar `kpiRows` inteiro a
  // cada edição renderizada.
  const indicatorsByEdition = useMemo(() => {
    const map = new Map<string, ProductKpiRow[]>()
    for (const row of kpiRows) {
      if (!row.product_edition_id) continue
      const list = map.get(row.product_edition_id) ?? []
      list.push(row)
      map.set(row.product_edition_id, list)
    }
    return map
  }, [kpiRows])

  // Produto e turma são medição pura — alvo só existe na meta de empresa
  // inteira. O que o cartão do produto mostra é o valor das metas PRÓPRIAS
  // dele (sem edição — as de cada turma aparecem um nível abaixo, dentro
  // do modal), mais quantas tarefas dele estão abertas.
  const statsByProduct = useMemo(() => {
    const map = new Map<string, { open: number; indicators: ProductKpiRow[] }>()
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

  // Toda meta raiz de empresa (sem produto, sem pai) — a lista que o atalho
  // de vincular em lote oferece, sempre recalculada a partir do que já está
  // em uso, nunca uma lista fixa.
  const rootKpis = useMemo(() => kpiDefs.filter((kpi) => !kpi.parent_kpi_id && !kpi.product_id), [kpiDefs])

  // Soma das metas próprias de um produto/turma — o valor usado pra
  // ordenar por contribuição (maior primeiro). `null` quando nenhuma delas
  // tem lançamento ainda, pra não empatar com quem já lançou zero.
  const totalValueOf = useCallback(
    (rows: ProductKpiRow[]): number | null => {
      let total = 0
      let any = false
      for (const row of rows) {
        const value = effectiveValue(row.kpi_id)
        if (value !== null) {
          total += value
          any = true
        }
      }
      return any ? total : null
    },
    [effectiveValue],
  )
  const productValue = useCallback(
    (productId: string) => totalValueOf(statsByProduct.get(productId)?.indicators ?? []),
    [statsByProduct, totalValueOf],
  )
  const editionValue = useCallback(
    (editionId: string) => totalValueOf(indicatorsByEdition.get(editionId) ?? []),
    [indicatorsByEdition, totalValueOf],
  )

  // Produtos e edições ordenados por quanto cada um contribui (maior →
  // menor); sem lançamento ainda vai pro fim, nunca empata com "reportou
  // zero".
  const sortedProducts = useMemo(
    () => [...products].sort((a, b) => byValueDesc(productValue(a.id), productValue(b.id))),
    [products, productValue],
  )
  const sortedEditionsFor = useCallback(
    (productId: string | null) =>
      editions
        .filter((edition) => edition.product_id === productId)
        .sort((a, b) => byValueDesc(editionValue(a.id), editionValue(b.id))),
    [editions, editionValue],
  )

  const activeProduct = useMemo(() => products.find((item) => item.id === activeId) ?? null, [products, activeId])
  const activeEditions = useMemo(() => sortedEditionsFor(activeId), [sortedEditionsFor, activeId])

  // -------------------------------------------------------------- produto
  const openCreate = () => {
    setForm(blankForm)
    setError('')
    setModal({ editing: null })
  }
  const openEdit = (product: Product) => {
    setForm({ name: product.name, description: product.description ?? '', is_active: product.is_active })
    setError('')
    setModal({ editing: product })
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!form.name.trim()) {
      setError('Dê um nome ao produto.')
      return
    }
    setError('')
    setBusy(true)
    const editing = modal?.editing ?? null
    const result = editing
      ? await supabase.from('products').update({ name: form.name.trim(), description: form.description.trim() || null, is_active: form.is_active }).eq('id', editing.id)
      : await supabase.from('products').insert({
          company_id: company.id,
          name: form.name.trim(),
          description: form.description.trim() || null,
          color: COMPANY_PALETTE[products.length % COMPANY_PALETTE.length],
          display_order: products.length,
        })
    setBusy(false)
    if (result.error) {
      setError(
        result.error.code === '23505' ? 'Já existe um produto com esse nome nesta empresa.' : result.error.message,
      )
      return
    }
    notify(editing ? 'Produto atualizado.' : 'Produto criado.')
    setModal(null)
    await load()
  }

  const productDelete = useConfirmDelete<Product>(async (product) => {
    const { error: deleteError } = await supabase.from('products').delete().eq('id', product.id)
    if (deleteError) {
      notify(deleteError.message, 'error')
      return
    }
    notify('Produto excluído.')
    if (activeId === product.id) setActiveId(null)
    await load()
  })

  // -------------------------------------------------------------- edições
  const addEdition = async () => {
    if (!activeId || !editionForm.name.trim()) {
      notify('Dê um nome à edição (ex.: "Turma 12", "2027.1").', 'error')
      return
    }
    const { error: insertError } = await supabase.from('product_editions').insert({
      product_id: activeId,
      company_id: company.id,
      name: editionForm.name.trim(),
      start_date: editionForm.start_date || null,
      end_date: editionForm.end_date || null,
    })
    if (insertError) {
      notify(insertError.message, 'error')
      return
    }
    setEditionForm(blankEditionForm)
    await load()
  }

  const startEditEdition = (edition: ProductEdition) => {
    setEditingEdition(edition)
    setEditionForm({
      name: edition.name,
      start_date: edition.start_date ?? '',
      end_date: edition.end_date ?? '',
    })
  }

  const cancelEditEdition = () => {
    setEditingEdition(null)
    setEditionForm(blankEditionForm)
  }

  const updateEdition = async () => {
    if (!editingEdition || !editionForm.name.trim()) {
      notify('Dê um nome à edição (ex.: "Turma 12", "2027.1").', 'error')
      return
    }
    const { error: updateError } = await supabase
      .from('product_editions')
      .update({
        name: editionForm.name.trim(),
        start_date: editionForm.start_date || null,
        end_date: editionForm.end_date || null,
      })
      .eq('id', editingEdition.id)
    if (updateError) {
      notify(
        updateError.code === '23505' ? 'Já existe uma edição com esse nome.' : updateError.message,
        'error',
      )
      return
    }
    notify('Edição atualizada.')
    cancelEditEdition()
    await load()
  }

  const setEditionStatus = async (edition: ProductEdition, status: ProductEditionStatus) => {
    setEditions((current) => current.map((item) => (item.id === edition.id ? { ...item, status } : item)))
    const { error: updateError } = await supabase.from('product_editions').update({ status }).eq('id', edition.id)
    if (updateError) notify(updateError.message, 'error')
  }

  const editionDelete = useConfirmDelete<ProductEdition>(async (edition) => {
    const { error: deleteError } = await supabase.from('product_editions').delete().eq('id', edition.id)
    if (deleteError) {
      notify(deleteError.message, 'error')
      return
    }
    if (editingEdition?.id === edition.id) cancelEditEdition()
    await load()
  })

  if (loading) return <Loading />

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={`Produtos · ${company.name}`}
        subtitle="As frentes de produto ou serviço desta empresa, o valor de cada uma e, pra quem roda em turmas, o valor de cada edição."
        actions={
          canWrite && (
            <button type="button" className="btn-primary" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Novo produto
            </button>
          )
        }
      />

      {products.length === 0 ? (
        <EmptyState
          title="Nenhum produto cadastrado"
          description='Cadastre as frentes que a empresa toca — ex.: "Entre Donos", "Imersão", "Mentoria" — pra acompanhar o valor de cada uma separadamente.'
          action={
            canWrite && (
              <button type="button" className="btn-primary" onClick={openCreate}>
                <Plus className="h-4 w-4" /> Criar produto
              </button>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sortedProducts.map((product) => {
            const stats = statsByProduct.get(product.id)
            const productEditions = editions.filter((edition) => edition.product_id === product.id)
            return (
              <button
                key={product.id}
                type="button"
                onClick={() => setActiveId(product.id)}
                className={`card min-w-0 p-4 text-left transition hover:border-brand-500 ${
                  product.is_active ? '' : 'opacity-60'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: product.color ?? '#94A3B8' }}
                    />
                    <p className="min-w-0 truncate text-sm font-semibold text-content">{product.name}</p>
                  </div>
                  {!product.is_active && <Badge tone="slate">inativo</Badge>}
                </div>
                {product.description && (
                  <p className="mt-1.5 line-clamp-2 text-xs text-content-soft">{product.description}</p>
                )}
                <div className="mt-2 flex items-center gap-3 text-xs text-content-faint">
                  {productEditions.length > 0 && (
                    <span className="flex items-center gap-1">
                      <CalendarRange className="h-3.5 w-3.5" /> {productEditions.length} edição(ões)
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <ClipboardList className="h-3.5 w-3.5" /> {stats?.open ?? 0} tarefa(s)
                  </span>
                </div>
                {stats && stats.indicators.length > 0 && (
                  <div className="mt-3 space-y-2.5">
                    {stats.indicators.slice(0, 2).map((row) => (
                      <IndicatorLine
                        key={row.kpi_id}
                        row={row}
                        value={effectiveValue(row.kpi_id)}
                        contribution={contributionFor(row)}
                        size="xs"
                      />
                    ))}
                    {stats.indicators.length > 2 && (
                      <p className="text-[11px] text-content-faint">
                        + {stats.indicators.length - 2} meta{stats.indicators.length - 2 > 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* --------------------------------------------------------- edições
          Declarado ANTES do form de produto de propósito: os dois usam o
          mesmo z-index (Modal é sempre z-50), e com dois abertos ao mesmo
          tempo (edita o produto de dentro da tela de edições) quem vem
          depois no JSX é que fica por cima — o form de edição precisa
          aparecer sobre esta tela, não o contrário. */}
      <Modal
        open={Boolean(activeProduct)}
        title={activeProduct ? activeProduct.name : ''}
        onClose={() => {
          setActiveId(null)
          cancelEditEdition()
        }}
        width="max-w-2xl"
      >
        {activeProduct && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-content-soft">
                {activeProduct.description || 'Sem descrição.'}
              </p>
              {canWrite && (
                <div className="flex shrink-0 gap-2">
                  <button type="button" className="btn-ghost" onClick={() => openEdit(activeProduct)}>
                    <Pencil className="h-3.5 w-3.5" /> Editar produto
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-rose-600 dark:text-rose-400"
                    onClick={() => productDelete.ask(activeProduct)}
                  >
                    <Trash2 className="h-4 w-4" /> Excluir
                  </button>
                </div>
              )}
            </div>

            <div>
              <p className="label">Metas que acompanham este produto</p>
              {/* Só leitura — nome + valor atual. Vincular uma meta nova
                  acontece pelo atalho no form de editar produto, ou de
                  dentro do cartão dela na tela de Metas. */}
              {(statsByProduct.get(activeProduct.id)?.indicators ?? []).length === 0 ? (
                <p className="mt-1 text-sm text-content-soft">Nenhuma meta acompanha este produto ainda.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {(statsByProduct.get(activeProduct.id)?.indicators ?? []).map((row) => {
                    const rowValue = effectiveValue(row.kpi_id)
                    return (
                      <li key={row.kpi_id} className="rounded-lg border border-line p-2.5">
                        {/* aria-label explícito: sem isso, o nome acessível do
                            link vira nome+valor+contribuição concatenados —
                            e "X% de {nome de outra meta}" na contribuição pode
                            criar falso-positivo em busca por texto/regex. */}
                        <Link
                          to={`/empresa/${company.id}/kpis/${row.kpi_id}`}
                          className="block"
                          aria-label={`${row.name}, ${rowValue !== null ? formatValue(rowValue, row.unit) : 'sem lançamento ainda'}`}
                        >
                          <IndicatorLine row={row} value={rowValue} contribution={contributionFor(row)} />
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <div>
              <p className="label">
                Edições — pra frentes que rodam em turma ou encontro (deixe vazio se a frente roda contínuo)
              </p>
              {activeEditions.length === 0 ? (
                <p className="mt-1 text-sm text-content-soft">Nenhuma edição cadastrada ainda.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {activeEditions.map((edition) => {
                    const editionIndicators = indicatorsByEdition.get(edition.id) ?? []
                    return (
                      <li key={edition.id} className="rounded-lg border border-line p-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-content">{edition.name}</p>
                            {(edition.start_date || edition.end_date) && (
                              <p className="text-xs text-content-faint">
                                {edition.start_date ? formatDate(edition.start_date) : '—'} a{' '}
                                {edition.end_date ? formatDate(edition.end_date) : '—'}
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {canWrite ? (
                              <select
                                className="rounded border border-line bg-surface px-1.5 py-1 text-base sm:text-xs"
                                value={edition.status}
                                onChange={(event) =>
                                  void setEditionStatus(edition, event.target.value as ProductEditionStatus)
                                }
                              >
                                {EDITION_STATUSES.map((status) => (
                                  <option key={status} value={status}>
                                    {PRODUCT_EDITION_STATUS_LABEL[status]}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <Badge tone={EDITION_STATUS_TONE[edition.status]}>
                                {PRODUCT_EDITION_STATUS_LABEL[edition.status]}
                              </Badge>
                            )}
                            {canWrite && (
                              <button
                                type="button"
                                className="rounded p-1 text-content-faint hover:bg-hover hover:text-content"
                                onClick={() => startEditEdition(edition)}
                                aria-label="Editar edição"
                                title="Editar"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {canWrite && (
                              <button
                                type="button"
                                className="rounded p-1 text-content-faint hover:bg-hover hover:text-content"
                                onClick={() => setAttachEditionFor(edition)}
                                aria-label="Metas desta turma"
                                title="Metas"
                              >
                                <Target className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {canWrite && (
                              <button
                                type="button"
                                className="rounded p-1 text-content-faint hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400"
                                onClick={() => editionDelete.ask(edition)}
                                aria-label="Remover edição"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="mt-2 border-t border-line pt-2">
                          {editionIndicators.length === 0 ? (
                            <p className="text-xs text-content-faint">Nenhuma meta acompanha esta turma ainda.</p>
                          ) : (
                            <ul className="space-y-2">
                              {editionIndicators.map((row) => {
                                const rowValue = effectiveValue(row.kpi_id)
                                return (
                                  <li key={row.kpi_id}>
                                    {/* Ver comentário equivalente acima — aria-label
                                        evita que a contribuição ("X% de {outro
                                        nome}") vaze pro nome acessível do link. */}
                                    <Link
                                      to={`/empresa/${company.id}/kpis/${row.kpi_id}`}
                                      className="block rounded-md py-0.5 transition hover:bg-hover"
                                      aria-label={`${row.name}, ${rowValue !== null ? formatValue(rowValue, row.unit) : 'sem lançamento ainda'}`}
                                    >
                                      <IndicatorLine row={row} value={rowValue} contribution={contributionFor(row)} size="xs" />
                                    </Link>
                                  </li>
                                )
                              })}
                            </ul>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}

              {canWrite && (
                <div className="mt-4 grid grid-cols-1 gap-2 rounded-lg border border-dashed border-line-strong p-3 sm:grid-cols-4">
                  {editingEdition && (
                    <p className="text-xs font-medium text-content-faint sm:col-span-4">
                      Editando "{editingEdition.name}"
                    </p>
                  )}
                  <input
                    className="input sm:col-span-2"
                    placeholder="Nome da edição (ex.: Turma 12)"
                    value={editionForm.name}
                    onChange={(event) => setEditionForm((c) => ({ ...c, name: event.target.value }))}
                  />
                  <input
                    className="input"
                    type="date"
                    value={editionForm.start_date}
                    onChange={(event) => setEditionForm((c) => ({ ...c, start_date: event.target.value }))}
                  />
                  <input
                    className="input"
                    type="date"
                    value={editionForm.end_date}
                    onChange={(event) => setEditionForm((c) => ({ ...c, end_date: event.target.value }))}
                  />
                  <div className="flex gap-2 sm:col-span-4">
                    <button
                      type="button"
                      className="btn-primary flex-1"
                      onClick={() => void (editingEdition ? updateEdition() : addEdition())}
                    >
                      {editingEdition ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                      {editingEdition ? 'Salvar edição' : 'Adicionar edição'}
                    </button>
                    {editingEdition && (
                      <button type="button" className="btn-ghost" onClick={cancelEditEdition}>
                        Cancelar
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ------------------------------------------------------- form de produto
          Declarado DEPOIS da tela de edições — ver comentário lá em cima. */}
      <Modal
        open={Boolean(modal)}
        title={modal?.editing ? `Editar ${modal.editing.name}` : 'Novo produto'}
        onClose={() => setModal(null)}
        width="max-w-md"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setModal(null)}>
              Cancelar
            </button>
            <button type="submit" form="product-form" className="btn-primary" disabled={busy}>
              {busy && <Spinner />}
              {modal?.editing ? 'Salvar' : 'Criar produto'}
            </button>
          </>
        }
      >
        <form id="product-form" onSubmit={submit} className="space-y-4">
          <Field label="Nome do produto">
            <input
              className="input"
              required
              autoFocus
              placeholder="Entre Donos, Imersão, Mentoria…"
              value={form.name}
              onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))}
            />
          </Field>
          <Field label="Descrição" hint="Opcional.">
            <textarea
              className="input min-h-16"
              value={form.description}
              onChange={(event) => setForm((c) => ({ ...c, description: event.target.value }))}
            />
          </Field>
          {modal?.editing && (
            <label className="flex items-center gap-2 text-sm text-content-muted">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(event) => setForm((c) => ({ ...c, is_active: event.target.checked }))}
              />
              Produto ativo
            </label>
          )}
          {error && <ErrorText>{error}</ErrorText>}
        </form>

        {/* Vincular este produto a uma ou várias metas de uma vez — só
            existe editando um produto já cadastrado (precisa de um id de
            verdade). Criar o produto primeiro, vincular depois. */}
        {modal?.editing && (
          <div className="mt-5 border-t border-line pt-4">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-content">
              <Target className="h-4 w-4 text-content-faint" /> Vincular a metas
            </p>
            <AttachIndicatorsSection
              companyId={company.id}
              productId={modal.editing.id}
              productEditionId={null}
              targetLabel={modal.editing.name}
              allRootKpis={rootKpis}
              existingChildren={kpiDefs.filter(
                (kpi) => kpi.product_id === modal.editing!.id && kpi.product_edition_id === null,
              )}
              onLinked={load}
            />
          </div>
        )}
      </Modal>

      {attachEditionFor && activeProduct && (
        <AttachEditionIndicatorsModal
          companyId={company.id}
          product={activeProduct}
          edition={attachEditionFor}
          allRootKpis={rootKpis}
          existingChildren={kpiDefs.filter((kpi) => kpi.product_edition_id === attachEditionFor.id)}
          onClose={() => setAttachEditionFor(null)}
          onLinked={load}
        />
      )}

      <ConfirmDialog
        open={productDelete.target !== null}
        title="Excluir produto?"
        danger
        busy={productDelete.busy}
        confirmLabel="Excluir"
        message={
          <>
            Excluir <strong>{productDelete.target?.name}</strong> apaga também as edições dele. Metas, tarefas e
            orçamentos ligados a ele continuam existindo, só perdem o vínculo com o produto. Não dá pra desfazer.
          </>
        }
        onConfirm={() => void productDelete.confirm()}
        onCancel={productDelete.cancel}
      />

      <ConfirmDialog
        open={editionDelete.target !== null}
        title="Excluir edição?"
        danger
        busy={editionDelete.busy}
        confirmLabel="Excluir"
        message={`Isso remove "${editionDelete.target?.name}" do produto. Não dá pra desfazer.`}
        onConfirm={() => void editionDelete.confirm()}
        onCancel={editionDelete.cancel}
      />
    </div>
  )
}

/** Nome da meta + valor atual — linha compacta de só leitura, usada nesta
 *  tela de cadastro. Produto e turma também podem ter alvo agora (ver tela
 *  de Metas); aqui fica só o valor de propósito, pra manter esta lista
 *  enxuta — já com a soma dos filhos incluída quando a meta tiver
 *  sub-produtos. */
function IndicatorLine({
  row,
  value,
  contribution,
  size = 'sm',
}: {
  row: ProductKpiRow
  value: number | null
  /** Quanto esta meta representa da meta-mãe dela — omitido quando não há pai. */
  contribution?: { ratio: number | null; parentName: string | null }
  size?: 'sm' | 'xs'
}) {
  const textSize = size === 'xs' ? 'text-[11px]' : 'text-xs'
  const pct = contribution?.ratio != null ? Math.round(contribution.ratio * 100) : null
  return (
    <div>
      <p className={`truncate font-medium text-content-soft ${textSize}`}>{row.name}</p>
      <p className={`mt-0.5 flex flex-wrap items-center gap-1.5 text-content-faint ${textSize}`}>
        <span>{value === null ? 'sem lançamento ainda' : formatValue(value, row.unit)}</span>
        {pct !== null && (
          <span className="rounded-full bg-hover px-1.5 py-0.5 text-[10px] font-medium text-content-soft">
            {pct}%{contribution?.parentName ? ` de ${contribution.parentName}` : ''}
          </span>
        )}
      </p>
    </div>
  )
}

// --------------------------------------------------- vincular em lote
// Atalho pra vincular um produto/turma a várias metas de uma vez, em vez
// de ir uma por uma no cartão de cada meta. A lista de metas existentes é
// sempre recalculada a partir do que já está em uso (allRootKpis) — nunca
// fixa — e dá pra criar uma meta nova ali mesmo, do catálogo ou com nome
// livre, exatamente como o modal "Nova Meta" já faz.
//
// A lógica mora num hook (`useAttachIndicators`) separado da UI: usagem A
// (inline no form de editar produto) renderiza tudo — inclusive o botão —
// no corpo do modal do produto, que já tem o "Salvar" dele; usagem B (modal
// próprio "Metas de <turma>") usa o mesmo hook mas põe o botão no `footer`
// do `Modal`, igual o `AttachProductModal` de Metas.
type AttachIndicatorsProps = {
  companyId: string
  productId: string
  productEditionId: string | null
  targetLabel: string
  allRootKpis: Kpi[]
  existingChildren: Kpi[]
  onLinked: () => Promise<void>
}

function useAttachIndicators({
  companyId,
  productId,
  productEditionId,
  targetLabel,
  allRootKpis,
  existingChildren,
  onLinked,
}: AttachIndicatorsProps) {
  const { notify } = useToast()
  const alreadyLinkedRootIds = new Set(
    existingChildren.map((kpi) => kpi.parent_kpi_id).filter((id): id is string => Boolean(id)),
  )
  const available = allRootKpis.filter((kpi) => !alreadyLinkedRootIds.has(kpi.id))

  const [checked, setChecked] = useState<Set<string>>(new Set())
  const toggleChecked = (id: string) =>
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const [showCreateNew, setShowCreateNew] = useState(false)
  const [chosenTemplates, setChosenTemplates] = useState<KpiTemplate[]>([])
  const toggleTemplate = (template: KpiTemplate) =>
    setChosenTemplates((current) =>
      current.some((item) => item.name === template.name)
        ? current.filter((item) => item.name !== template.name)
        : [...current, template],
    )
  const [customName, setCustomName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const totalSelected = checked.size + chosenTemplates.length + (customName.trim() ? 1 : 0)

  const submit = async () => {
    if (totalSelected === 0) {
      setError('Selecione ao menos uma meta.')
      return
    }
    setError('')
    setBusy(true)

    // Passo 1: metas novas (do catálogo ou nome livre) primeiro viram
    // linhas raiz novas em `kpis`.
    const newRootPayloads = [
      ...chosenTemplates.map((template) => ({
        company_id: companyId,
        name: template.name,
        description: template.description,
        category: template.category,
        unit: template.unit,
        direction: template.direction,
        frequency: template.frequency,
        display_order: allRootKpis.length,
      })),
      ...(customName.trim()
        ? [
            {
              company_id: companyId,
              name: customName.trim(),
              unit: 'number' as KpiUnit,
              direction: 'up' as KpiDirection,
              frequency: 'monthly' as KpiFrequency,
              display_order: allRootKpis.length,
            },
          ]
        : []),
    ]

    let newRoots: Kpi[] = []
    if (newRootPayloads.length > 0) {
      const { data, error: rootError } = await supabase.from('kpis').insert(newRootPayloads).select('*')
      if (rootError) {
        setBusy(false)
        setError(rootError.code === '23505' ? 'Já existe uma meta com esse nome.' : rootError.message)
        return
      }
      newRoots = (data as Kpi[]) ?? []
    }

    // Passo 2: um vínculo por meta selecionada/criada — um insert em lote
    // só, atômico, sem estado parcial se algo falhar no meio.
    const targets = [...available.filter((kpi) => checked.has(kpi.id)), ...newRoots]
    const childPayloads = targets.map((root) => ({
      company_id: companyId,
      name: `${root.name} · ${targetLabel}`,
      category: root.category,
      unit: root.unit,
      direction: root.direction,
      frequency: root.frequency,
      product_id: productId,
      product_edition_id: productEditionId,
      parent_kpi_id: root.id,
      is_active: true,
    }))
    const { error: linkError } = await supabase.from('kpis').insert(childPayloads)
    setBusy(false)
    if (linkError) {
      setError(
        linkError.code === '23505' ? 'Um dos vínculos já existe — tente de novo em instantes.' : linkError.message,
      )
      return
    }
    notify(targets.length === 1 ? 'Meta vinculada.' : `${targets.length} metas vinculadas.`)
    setChecked(new Set())
    setChosenTemplates([])
    setCustomName('')
    setShowCreateNew(false)
    await onLinked()
  }

  return {
    available,
    checked,
    toggleChecked,
    showCreateNew,
    setShowCreateNew,
    chosenTemplates,
    toggleTemplate,
    customName,
    setCustomName,
    error,
    busy,
    totalSelected,
    submit,
  }
}

type AttachIndicatorsState = ReturnType<typeof useAttachIndicators>

// Lista de metas existentes + fluxo de criar meta nova — sem botão de
// submeter, quem chama decide onde o botão mora (inline ou no footer de um
// Modal).
function AttachIndicatorsBody({ state, allRootKpis }: { state: AttachIndicatorsState; allRootKpis: Kpi[] }) {
  const {
    available,
    checked,
    toggleChecked,
    showCreateNew,
    setShowCreateNew,
    chosenTemplates,
    toggleTemplate,
    customName,
    setCustomName,
    error,
  } = state

  return (
    <div className="space-y-4">
      {available.length > 0 ? (
        <div>
          <p className="mb-1.5 text-xs font-medium text-content-faint">Metas existentes</p>
          <ul className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border border-line p-2.5">
            {available.map((kpi) => (
              <li key={kpi.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={checked.has(kpi.id)} onChange={() => toggleChecked(kpi.id)} />
                  {kpi.name}
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        !showCreateNew && (
          <p className="text-xs text-content-faint">Nenhuma outra meta cadastrada ainda pra vincular.</p>
        )
      )}

      {!showCreateNew ? (
        <button type="button" className="btn-ghost text-sm" onClick={() => setShowCreateNew(true)}>
          <Plus className="h-3.5 w-3.5" /> Criar uma meta nova
        </button>
      ) : (
        <div className="space-y-3 rounded-lg border border-dashed border-line-strong p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-content-faint">Meta nova</p>
            <button
              type="button"
              className="text-xs text-content-faint hover:underline"
              onClick={() => setShowCreateNew(false)}
            >
              Cancelar
            </button>
          </div>
          <KpiSuggestions
            existingNames={allRootKpis.map((kpi) => kpi.name)}
            selected={chosenTemplates.map((template) => template.name)}
            onToggle={toggleTemplate}
          />
          <Field label="Ou nome livre" hint="Opcional — se nenhuma sugestão servir.">
            <input
              className="input"
              placeholder="Nome da meta"
              value={customName}
              onChange={(event) => setCustomName(event.target.value)}
            />
          </Field>
        </div>
      )}

      {error && <ErrorText>{error}</ErrorText>}
    </div>
  )
}

// Usagem A: inline no corpo do modal de editar produto. O form do produto
// já tem o "Salvar" dele no footer — este botão é uma ação secundária,
// contida na própria seção, pra não competir visualmente com ele.
function AttachIndicatorsSection(props: AttachIndicatorsProps) {
  const state = useAttachIndicators(props)
  return (
    <div className="space-y-4">
      <AttachIndicatorsBody state={state} allRootKpis={props.allRootKpis} />
      {(state.available.length > 0 || state.showCreateNew) && (
        <button
          type="button"
          className="btn-ghost text-sm"
          disabled={state.busy || state.totalSelected === 0}
          onClick={() => void state.submit()}
        >
          {state.busy && <Spinner />}
          Vincular{state.totalSelected > 1 ? ` (${state.totalSelected})` : ''}
        </button>
      )}
    </div>
  )
}

// Usagem B: modal próprio "Metas de <turma>" — igual o `AttachProductModal`
// de Metas, o botão de submeter mora no footer do Modal, e o footer some
// inteiro quando não há nada pra vincular ainda.
function AttachEditionIndicatorsModal({
  companyId,
  product,
  edition,
  allRootKpis,
  existingChildren,
  onClose,
  onLinked,
}: {
  companyId: string
  product: Product
  edition: ProductEdition
  allRootKpis: Kpi[]
  existingChildren: Kpi[]
  onClose: () => void
  onLinked: () => Promise<void>
}) {
  const state = useAttachIndicators({
    companyId,
    productId: product.id,
    productEditionId: edition.id,
    targetLabel: `${product.name} · ${edition.name}`,
    allRootKpis,
    existingChildren,
    onLinked,
  })

  return (
    <Modal
      open
      title={`Metas de ${edition.name}`}
      onClose={onClose}
      width="max-w-md"
      footer={
        (state.available.length > 0 || state.showCreateNew) && (
          <>
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={state.busy || state.totalSelected === 0}
              onClick={() => void state.submit()}
            >
              {state.busy && <Spinner />}
              Vincular{state.totalSelected > 1 ? ` (${state.totalSelected})` : ''}
            </button>
          </>
        )
      }
    >
      <AttachIndicatorsBody state={state} allRootKpis={allRootKpis} />
    </Modal>
  )
}
