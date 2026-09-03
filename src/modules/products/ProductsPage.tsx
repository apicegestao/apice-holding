// Produtos: as frentes de produto/serviço dentro de uma empresa — caso real
// que motivou este módulo: a MDD (Mesa dos Donos) controla "Entre Donos",
// "Imersão", "Mentoria" e "Club" ao mesmo tempo, cada uma com sua própria
// saúde. Frente recorrente (Entre Donos, Imersão) cadastra uma edição por
// turma/encontro; frente contínua (Mentoria, Club) pode não ter edição
// nenhuma — funciona sozinha.
//
// A meta é o que mais gerava confusão aqui: cadastrar produto e edição não
// bastava, porque não existia nenhum jeito de definir (nem de ver) uma
// meta a partir desta tela — era preciso ir pra KPIs, lembrar de escolher o
// produto certo lá, e só então a meta "aparecia" de volta aqui. Agora o
// produto e cada edição mostram a própria meta direto aqui, com um atalho
// "+ Meta" que já leva pro formulário de KPI com produto/edição
// preenchidos — cadastro e acompanhamento na mesma tela.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { CalendarRange, ClipboardList, Pencil, Plus, Target, Trash2 } from 'lucide-react'
import { supabase } from '../../core/lib/supabase'
import { attainmentRatio, formatDate, formatValue } from '../../core/lib/format'
import { buildChildrenByParent, effectiveKpiValue } from '../../core/lib/kpiRollup'
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
  ProgressBar,
  Spinner,
  useConfirmDelete,
  useToast,
} from '../../core/ui'
import { COMPANY_PALETTE } from '../companies/CompanyFields'
import {
  PRODUCT_EDITION_STATUS_LABEL,
  type GoalStatus,
  type Kpi,
  type KpiDirection,
  type KpiLatestValue,
  type KpiUnit,
  type Meta,
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

// Tarefa enxuta só com o que esta tela precisa contar — nada de trazer
// título/descrição de toda tarefa da empresa à toa.
type TaskCount = { id: string; product_id: string | null; status: string }

// Um KPI (indicador) ativo entra aqui com lançamento ou não — um indicador
// que só soma os filhos (ex. o do produto, que nunca lança direto) não pode
// sumir da tela por nunca ter uma linha própria em kpi_values. Só medição:
// meta é outra coisa, ver `ProductMetaRow`.
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

// Uma meta, já com o nome/unidade/direção do indicador que ela mede e o
// valor de verdade dele (effectiveValue — soma incluída). O mesmo kpi_id
// pode aparecer em mais de uma linha — um indicador pode ter mais de uma
// meta ao mesmo tempo.
type ProductMetaRow = {
  meta_id: string
  kpi_id: string
  name: string
  unit: KpiUnit
  direction: KpiDirection
  product_id: string | null
  product_edition_id: string | null
  target_value: number | null
  status: GoalStatus
  value: number | null
}

export default function ProductsPage() {
  const { company, canWrite } = useCompany()
  const { notify } = useToast()

  const [products, setProducts] = useState<Product[]>([])
  const [editions, setEditions] = useState<ProductEdition[]>([])
  const [kpiDefs, setKpiDefs] = useState<Kpi[]>([])
  const [kpiValues, setKpiValues] = useState<KpiLatestValue[]>([])
  const [metas, setMetas] = useState<Meta[]>([])
  const [tasks, setTasks] = useState<TaskCount[]>([])
  const [loading, setLoading] = useState(true)

  const [activeId, setActiveId] = useState<string | null>(null)
  const [modal, setModal] = useState<{ editing: Product | null } | null>(null)
  const [form, setForm] = useState<ProductForm>(blankForm)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editionForm, setEditionForm] = useState<EditionForm>(blankEditionForm)

  const load = useCallback(async () => {
    setLoading(true)
    const [
      { data: productRows },
      { data: editionRows },
      { data: kpiDefRows },
      { data: kpiValueRows },
      { data: metaRows },
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
      supabase.from('metas').select('*').eq('company_id', company.id).is('archived_at', null),
      supabase.from('tasks').select('id, product_id, status').eq('company_id', company.id),
    ])
    setProducts((productRows as Product[]) ?? [])
    setEditions((editionRows as ProductEdition[]) ?? [])
    setKpiDefs((kpiDefRows as Kpi[]) ?? [])
    setKpiValues((kpiValueRows as KpiLatestValue[]) ?? [])
    setMetas((metaRows as Meta[]) ?? [])
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

  // Soma em cadeia (turma → produto → empresa): um KPI com filhos nunca
  // lança direto, o valor dele é sempre a soma deles.
  const childrenByParent = useMemo(() => buildChildrenByParent(kpiRows), [kpiRows])
  const kpiRowById = useMemo(() => new Map(kpiRows.map((row) => [row.kpi_id, row])), [kpiRows])
  const effectiveValue = useCallback(
    (kpiId: string) => effectiveKpiValue(kpiId, childrenByParent, kpiRowById),
    [childrenByParent, kpiRowById],
  )

  // Cada meta ganha o nome/unidade/direção do indicador que ela mede e o
  // valor de verdade dele (soma incluída) — um indicador pode aparecer em
  // mais de uma linha aqui (uma por meta que ele tem).
  const metaRows = useMemo<ProductMetaRow[]>(
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
            status: meta.status,
            value: effectiveValue(meta.kpi_id),
          }
        })
        .filter((row): row is ProductMetaRow => row !== null),
    [metas, kpiRowById, effectiveValue],
  )

  // Metas "do produto como um todo" (sem edição) e as "de cada turma" —
  // separadas porque aparecem em lugares diferentes da tela.
  const metasByProduct = useMemo(() => {
    const map = new Map<string, ProductMetaRow[]>()
    for (const row of metaRows) {
      if (!row.product_id || row.product_edition_id) continue
      const list = map.get(row.product_id) ?? []
      list.push(row)
      map.set(row.product_id, list)
    }
    return map
  }, [metaRows])

  const metasByEdition = useMemo(() => {
    const map = new Map<string, ProductMetaRow[]>()
    for (const row of metaRows) {
      if (!row.product_edition_id) continue
      const list = map.get(row.product_edition_id) ?? []
      list.push(row)
      map.set(row.product_edition_id, list)
    }
    return map
  }, [metaRows])

  // Saúde de cada produto: mesma conta da saúde geral da empresa (média do
  // attainmentRatio das metas com alvo, usando o valor de verdade — soma
  // incluída), restrita às metas daquele produto — e tarefas abertas dele.
  // `metas` aqui é TODA meta do produto — a dele mesmo e a de cada edição —,
  // não só uma "de capa" escolhida a dedo: uma turma pode ter várias metas
  // ao mesmo tempo (vendas de ingresso, faturamento, cancelamentos…) e
  // todas precisam aparecer, não só a primeira que existir.
  const statsByProduct = useMemo(() => {
    const map = new Map<
      string,
      { ratio: number | null; open: number; metas: { meta: ProductMetaRow; editionName?: string }[] }
    >()
    for (const product of products) {
      const productLevel = metasByProduct.get(product.id) ?? []
      const productEditions = editions.filter((edition) => edition.product_id === product.id)
      const withTarget = metaRows.filter(
        (row) => row.product_id === product.id && row.target_value !== null && Number(row.target_value) !== 0,
      )
      const ratios = withTarget
        .map((row) => attainmentRatio(row.value, row.target_value, row.direction))
        .filter((ratio): ratio is number => ratio !== null)
      const open = tasks.filter(
        (task) => task.product_id === product.id && ['todo', 'doing', 'blocked'].includes(task.status),
      )
      const metasList = [
        ...productLevel.map((meta) => ({ meta })),
        ...productEditions.flatMap((edition) =>
          (metasByEdition.get(edition.id) ?? []).map((meta) => ({ meta, editionName: edition.name })),
        ),
      ]
      map.set(product.id, {
        ratio: ratios.length ? ratios.reduce((sum, r) => sum + r, 0) / ratios.length : null,
        open: open.length,
        metas: metasList,
      })
    }
    return map
  }, [products, metasByProduct, metasByEdition, editions, metaRows, tasks])

  const activeProduct = useMemo(() => products.find((item) => item.id === activeId) ?? null, [products, activeId])
  const activeEditions = useMemo(
    () =>
      editions
        .filter((edition) => edition.product_id === activeId)
        .sort((a, b) => (a.start_date ?? '') < (b.start_date ?? '') ? 1 : -1),
    [editions, activeId],
  )

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
    await load()
  })

  if (loading) return <Loading />

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={`Produtos · ${company.name}`}
        subtitle="As frentes de produto ou serviço desta empresa, a meta de cada uma e, pra quem roda em turmas, a meta de cada edição."
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
          description='Cadastre as frentes que a empresa toca — ex.: "Entre Donos", "Imersão", "Mentoria" — pra acompanhar a meta e a saúde de cada uma separadamente.'
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
          {products.map((product) => {
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
                {stats && stats.metas.length > 0 ? (
                  <div className="mt-3 space-y-2.5">
                    {stats.metas.slice(0, 2).map(({ meta, editionName }) => (
                      <MetaLine key={meta.meta_id} meta={meta} editionName={editionName} size="xs" />
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
                    <div className="mt-3">
                      <ProgressBar ratio={stats.ratio} label="Saúde da frente" />
                    </div>
                  )
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
        onClose={() => setActiveId(null)}
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
              <div className="flex items-center justify-between gap-2">
                <p className="label">Metas deste produto</p>
                {canWrite && (
                  <Link
                    to={`/empresa/${company.id}/kpis?novo=1&product_id=${activeProduct.id}`}
                    className="btn-ghost py-1 text-xs"
                  >
                    <Target className="h-3.5 w-3.5" /> Nova meta
                  </Link>
                )}
              </div>
              {(metasByProduct.get(activeProduct.id) ?? []).length === 0 ? (
                <p className="mt-1 text-sm text-content-soft">
                  Ainda sem meta própria — o produto como um todo não tem nenhuma meta definida.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {(metasByProduct.get(activeProduct.id) ?? []).map((meta) => (
                    <li key={meta.meta_id}>
                      <Link
                        to={`/empresa/${company.id}/kpis?kpi=${meta.kpi_id}`}
                        className="block rounded-lg border border-line p-2.5 transition hover:border-line-strong hover:bg-hover"
                      >
                        <MetaLine meta={meta} />
                      </Link>
                    </li>
                  ))}
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
                    const editionMetas = metasByEdition.get(edition.id) ?? []
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
                          {editionMetas.length === 0 ? (
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs text-content-faint">Sem meta própria ainda.</p>
                              {canWrite && (
                                <Link
                                  to={`/empresa/${company.id}/kpis?novo=1&product_id=${activeProduct.id}&product_edition_id=${edition.id}`}
                                  className="shrink-0 text-xs text-brand-text hover:underline"
                                >
                                  + Meta desta turma
                                </Link>
                              )}
                            </div>
                          ) : (
                            <ul className="space-y-2">
                              {editionMetas.map((meta) => (
                                <li key={meta.meta_id}>
                                  <Link
                                    to={`/empresa/${company.id}/kpis?kpi=${meta.kpi_id}`}
                                    className="block rounded-md -mx-1 px-1 py-0.5 transition hover:bg-hover"
                                  >
                                    <MetaLine meta={meta} size="xs" />
                                  </Link>
                                </li>
                              ))}
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
                  <button
                    type="button"
                    className="btn-primary sm:col-span-4"
                    onClick={() => void addEdition()}
                  >
                    <Plus className="h-4 w-4" /> Adicionar edição
                  </button>
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
      </Modal>

      <ConfirmDialog
        open={productDelete.target !== null}
        title="Excluir produto?"
        danger
        busy={productDelete.busy}
        confirmLabel="Excluir"
        message={
          <>
            Excluir <strong>{productDelete.target?.name}</strong> apaga também as edições dele. KPIs, tarefas e
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

/** Nome da meta + "valor de meta" + barrinha, quando dá pra calcular — o
 *  mesmo formato em todo lugar que uma meta de produto/edição aparece
 *  (cartão do produto, lista de metas do produto, linha da edição).
 *  `editionName` só entra quando o cartão do produto mistura metas de
 *  mais de uma turma na mesma lista — sem isso, "Faturamento" repetido
 *  duas vezes não diz de qual edição é cada um. */
function MetaLine({
  meta,
  editionName,
  size = 'sm',
}: {
  meta: ProductMetaRow
  editionName?: string
  size?: 'sm' | 'xs'
}) {
  const ratio = meta.value !== null ? attainmentRatio(meta.value, meta.target_value, meta.direction) : null
  const textSize = size === 'xs' ? 'text-[11px]' : 'text-xs'
  return (
    <div>
      <p className={`truncate font-medium text-content-soft ${textSize}`}>
        {meta.name}
        {editionName && <span className="font-normal text-content-faint"> · {editionName}</span>}
      </p>
      <p className={`mt-0.5 text-content-faint ${textSize}`}>
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
