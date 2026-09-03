// Produtos: as frentes de produto/serviço dentro de uma empresa — caso real
// que motivou este módulo: a MDD (Mesa dos Donos) controla "Entre Donos",
// "Imersão", "Mentoria" e "Club" ao mesmo tempo. Frente recorrente (Entre
// Donos, Imersão) cadastra uma edição por turma/encontro; frente contínua
// (Mentoria, Club) pode não ter edição nenhuma — funciona sozinha.
//
// Produto e edição são medição pura — nenhum dos dois tem alvo próprio (o
// alvo de verdade vive só na meta de empresa inteira, na tela Metas). O
// que esta tela mostra é o valor de cada meta ligada ao produto/edição, já
// com a soma dos filhos incluída quando ela tiver sub-produtos (a cadeia
// turma → produto → empresa via "Contribui para" continua igual, ver
// `kpiRollup.ts`) — cadastro da meta e acompanhamento do valor na mesma
// tela, e um lápis em cada linha pra editar sem sair daqui.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { CalendarRange, ClipboardList, Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../core/lib/supabase'
import { formatDate, formatValue } from '../../core/lib/format'
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
  Spinner,
  useConfirmDelete,
  useToast,
} from '../../core/ui'
import { COMPANY_PALETTE } from '../companies/CompanyFields'
import {
  PRODUCT_EDITION_STATUS_LABEL,
  type Kpi,
  type KpiDirection,
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
                {stats && stats.indicators.length > 0 && (
                  <div className="mt-3 space-y-2.5">
                    {stats.indicators.slice(0, 2).map((row) => (
                      <IndicatorLine key={row.kpi_id} row={row} value={effectiveValue(row.kpi_id)} size="xs" />
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
                    <Plus className="h-3.5 w-3.5" /> Meta
                  </Link>
                )}
              </div>
              {(statsByProduct.get(activeProduct.id)?.indicators ?? []).length === 0 ? (
                <p className="mt-1 text-sm text-content-soft">Nenhuma meta própria deste produto ainda.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {(statsByProduct.get(activeProduct.id)?.indicators ?? []).map((row) => (
                    <li
                      key={row.kpi_id}
                      className="flex items-center gap-1.5 rounded-lg border border-line p-2.5 transition hover:border-line-strong hover:bg-hover"
                    >
                      <Link to={`/empresa/${company.id}/kpis?kpi=${row.kpi_id}`} className="min-w-0 flex-1">
                        <IndicatorLine row={row} value={effectiveValue(row.kpi_id)} />
                      </Link>
                      {canWrite && (
                        <Link
                          to={`/empresa/${company.id}/kpis?kpi=${row.kpi_id}&editar=1`}
                          className="shrink-0 rounded-md p-1.5 text-content-faint hover:bg-hover hover:text-content"
                          aria-label="Editar meta"
                          title="Editar"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Link>
                      )}
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
                              {editionIndicators.map((row) => (
                                <li key={row.kpi_id} className="flex items-center gap-1 -mx-1 px-1">
                                  <Link
                                    to={`/empresa/${company.id}/kpis?kpi=${row.kpi_id}`}
                                    className="min-w-0 flex-1 rounded-md py-0.5 transition hover:bg-hover"
                                  >
                                    <IndicatorLine row={row} value={effectiveValue(row.kpi_id)} size="xs" />
                                  </Link>
                                  {canWrite && (
                                    <Link
                                      to={`/empresa/${company.id}/kpis?kpi=${row.kpi_id}&editar=1`}
                                      className="shrink-0 rounded-md p-1 text-content-faint hover:bg-hover hover:text-content"
                                      aria-label="Editar meta"
                                      title="Editar"
                                    >
                                      <Pencil className="h-3 w-3" />
                                    </Link>
                                  )}
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

/** Nome da meta + valor atual — produto e turma são medição pura (o alvo
 *  de verdade vive só na meta de empresa inteira), então aqui não tem
 *  alvo, nem ratio, nem barra: só o valor, já com a soma dos filhos
 *  incluída quando a meta tiver sub-produtos. */
function IndicatorLine({
  row,
  value,
  size = 'sm',
}: {
  row: ProductKpiRow
  value: number | null
  size?: 'sm' | 'xs'
}) {
  const textSize = size === 'xs' ? 'text-[11px]' : 'text-xs'
  return (
    <div>
      <p className={`truncate font-medium text-content-soft ${textSize}`}>{row.name}</p>
      <p className={`mt-0.5 text-content-faint ${textSize}`}>
        {value === null ? 'sem lançamento ainda' : formatValue(value, row.unit)}
      </p>
    </div>
  )
}
