// Financeiro: livro de lançamentos — Fase 3 do plano de virar um sistema de
// gestão completo por empresa. Diferente de Orçamentos (previsto x
// realizado de UM evento/projeto por vez), aqui é o dia a dia: receita e
// despesa avulsa da empresa, sem precisar amarrar a um orçamento —
// indicador, tarefa e orçamento já tinham esse tipo de vínculo opcional
// com área/produto/turma; lançamento financeiro segue o mesmo padrão.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../../core/auth/AuthProvider'
import { supabase } from '../../core/lib/supabase'
import { useCompany } from '../../core/company/CompanyProvider'
import { formatDate, formatValue } from '../../core/lib/format'
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
  SectionTabs,
  Spinner,
  useConfirmDelete,
  useToast,
} from '../../core/ui'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type {
  BudgetItemKind,
  Company,
  Department,
  FinancialEntry,
  Product,
  ProductEdition,
} from '../../core/types'

const KIND_LABEL: Record<BudgetItemKind, string> = { receita: 'Receita', despesa: 'Despesa' }

// Soma em centavos e só volta pra reais no final — mesmo cuidado de
// BudgetsPage.tsx (evita que uma sequência de somas em ponto flutuante
// derive o total em um centavo).
const round2 = (value: number) => Math.round(value * 100) / 100

const monthLabel = (yearMonth: string) => {
  const [year, month] = yearMonth.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })
}

type EntryForm = {
  kind: BudgetItemKind
  description: string
  category: string
  amount: number | null
  occurred_at: string
  department_id: string
  product_id: string
  product_edition_id: string
}

const blankForm = (): EntryForm => ({
  kind: 'despesa',
  description: '',
  category: '',
  amount: null,
  occurred_at: new Date().toISOString().slice(0, 10),
  department_id: '',
  product_id: '',
  product_edition_id: '',
})

function FinancialsBoard({
  company,
  canWrite,
  basePath,
}: {
  company: Company
  canWrite: boolean
  basePath: string
}) {
  const { profile } = useAuth()
  const { notify } = useToast()

  const [entries, setEntries] = useState<FinancialEntry[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [editions, setEditions] = useState<ProductEdition[]>([])
  const [loading, setLoading] = useState(true)

  const [modal, setModal] = useState<{ editing: FinancialEntry | null } | null>(null)
  const [form, setForm] = useState<EntryForm>(blankForm())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: entryRows }, { data: departmentRows }, { data: productRows }, { data: editionRows }] =
      await Promise.all([
        supabase
          .from('financial_entries')
          .select('*')
          .eq('company_id', company.id)
          .order('occurred_at', { ascending: false }),
        supabase.from('departments').select('*').eq('company_id', company.id).eq('is_active', true).order('display_order'),
        supabase.from('products').select('*').eq('company_id', company.id).eq('is_active', true).order('display_order'),
        supabase.from('product_editions').select('*').eq('company_id', company.id).is('archived_at', null),
      ])
    setEntries((entryRows as FinancialEntry[]) ?? [])
    setDepartments((departmentRows as Department[]) ?? [])
    setProducts((productRows as Product[]) ?? [])
    setEditions((editionRows as ProductEdition[]) ?? [])
    setLoading(false)
  }, [company.id])

  useEffect(() => {
    void load()
  }, [load])

  const editionsForProduct = useMemo(
    () => editions.filter((edition) => edition.product_id === form.product_id),
    [editions, form.product_id],
  )
  const departmentName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? null
  const productName = (id: string | null) => products.find((p) => p.id === id)?.name ?? null
  const editionName = (id: string | null) => editions.find((e) => e.id === id)?.name ?? null

  // ------------------------------------------------------------- totais
  const totals = useMemo(() => {
    const sum = (kind: BudgetItemKind) =>
      round2(entries.filter((e) => e.kind === kind).reduce((acc, e) => acc + Number(e.amount), 0))
    const revenue = sum('receita')
    const expense = sum('despesa')
    return { revenue, expense, balance: round2(revenue - expense) }
  }, [entries])

  const thisMonth = new Date().toISOString().slice(0, 7)
  const monthTotals = useMemo(() => {
    const inMonth = entries.filter((e) => e.occurred_at.slice(0, 7) === thisMonth)
    const sum = (kind: BudgetItemKind) =>
      round2(inMonth.filter((e) => e.kind === kind).reduce((acc, e) => acc + Number(e.amount), 0))
    const revenue = sum('receita')
    const expense = sum('despesa')
    return { revenue, expense, balance: round2(revenue - expense) }
  }, [entries, thisMonth])

  // Fluxo de caixa por mês — mesmo padrão de BudgetsPage.tsx, sem a coluna
  // de "previsto" (aqui não tem cotação, é o que realmente aconteceu).
  const cashflow = useMemo(() => {
    const byMonth = new Map<string, { revenue: number; expense: number }>()
    for (const entry of entries) {
      const month = entry.occurred_at.slice(0, 7)
      const bucket = byMonth.get(month) ?? { revenue: 0, expense: 0 }
      if (entry.kind === 'receita') bucket.revenue += Number(entry.amount)
      else bucket.expense += Number(entry.amount)
      byMonth.set(month, bucket)
    }
    const months = [...byMonth.keys()].sort()
    let cumulative = 0
    return months.map((month) => {
      const bucket = byMonth.get(month)!
      const balance = round2(bucket.revenue - bucket.expense)
      cumulative = round2(cumulative + balance)
      return { month, revenue: round2(bucket.revenue), expense: round2(bucket.expense), balance, cumulative }
    })
  }, [entries])

  // ------------------------------------------------------------ lançamento
  const openCreate = () => {
    setForm(blankForm())
    setError('')
    setModal({ editing: null })
  }
  const openEdit = (entry: FinancialEntry) => {
    setForm({
      kind: entry.kind,
      description: entry.description,
      category: entry.category,
      amount: Number(entry.amount),
      occurred_at: entry.occurred_at,
      department_id: entry.department_id ?? '',
      product_id: entry.product_id ?? '',
      product_edition_id: entry.product_edition_id ?? '',
    })
    setError('')
    setModal({ editing: entry })
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!form.description.trim() || form.amount === null || form.amount <= 0) {
      setError('Informe a descrição e um valor maior que zero.')
      return
    }
    setError('')
    setBusy(true)
    const payload = {
      company_id: company.id,
      kind: form.kind,
      description: form.description.trim(),
      category: form.category.trim() || 'Geral',
      amount: form.amount,
      occurred_at: form.occurred_at,
      department_id: form.department_id || null,
      product_id: form.product_id || null,
      product_edition_id: form.product_edition_id || null,
    }
    const editing = modal?.editing ?? null
    const result = editing
      ? await supabase.from('financial_entries').update(payload).eq('id', editing.id)
      : await supabase.from('financial_entries').insert({ ...payload, created_by: profile?.id ?? null })
    setBusy(false)
    if (result.error) {
      setError(result.error.message)
      return
    }
    notify(editing ? 'Lançamento atualizado.' : 'Lançamento criado.')
    setModal(null)
    await load()
  }

  const entryDelete = useConfirmDelete<FinancialEntry>(async (entry) => {
    const { error } = await supabase.from('financial_entries').delete().eq('id', entry.id)
    if (error) {
      notify(error.message, 'error')
      return
    }
    notify('Lançamento excluído.')
    await load()
  })

  if (loading) return <Loading />

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <SectionTabs
        items={[
          { to: `${basePath}/orcamentos`, label: 'Orçamentos' },
          { to: `${basePath}/financeiro`, label: 'Financeiro' },
        ]}
      />
      <PageHeader
        title={`Financeiro · ${company.name}`}
        subtitle="O livro de lançamentos da empresa: receita e despesa do dia a dia, sem precisar de um orçamento de evento."
        actions={
          canWrite && (
            <button type="button" className="btn-primary" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Novo lançamento
            </button>
          )
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-content-soft">Receita no mês</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
            {formatValue(monthTotals.revenue, 'currency')}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-content-soft">Despesa no mês</p>
          <p className="mt-2 text-2xl font-semibold text-rose-600 dark:text-rose-400">
            {formatValue(monthTotals.expense, 'currency')}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-content-soft">Saldo no mês</p>
          <p
            className={`mt-2 text-2xl font-semibold ${monthTotals.balance < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-content'}`}
          >
            {formatValue(monthTotals.balance, 'currency')}
          </p>
          <p className="mt-0.5 text-xs text-content-faint">saldo geral: {formatValue(totals.balance, 'currency')}</p>
        </div>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          title="Nenhum lançamento ainda"
          description="Registre a primeira receita ou despesa pra começar o livro-caixa desta empresa."
          action={
            canWrite && (
              <button type="button" className="btn-primary" onClick={openCreate}>
                <Plus className="h-4 w-4" /> Criar lançamento
              </button>
            )
          }
        />
      ) : (
        <>
          <Card title="Lançamentos" description="Mais recentes primeiro.">
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-content-faint">
                    <th className="py-2 pr-2">Data</th>
                    <th className="py-2 pr-2">Tipo</th>
                    <th className="py-2 pr-2">Descrição</th>
                    <th className="py-2 pr-2">Categoria</th>
                    <th className="py-2 pr-2">Vínculo</th>
                    <th className="py-2 pr-2">Valor</th>
                    {canWrite && <th className="py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const link = [productName(entry.product_id), editionName(entry.product_edition_id)]
                      .filter(Boolean)
                      .join(' · ')
                    return (
                      <tr key={entry.id} className="border-b border-line align-top">
                        <td className="py-2 pr-2 whitespace-nowrap">{formatDate(entry.occurred_at)}</td>
                        <td className="py-2 pr-2">
                          <Badge tone={entry.kind === 'receita' ? 'green' : 'red'}>{KIND_LABEL[entry.kind]}</Badge>
                        </td>
                        <td className="py-2 pr-2">{entry.description}</td>
                        <td className="py-2 pr-2 text-content-soft">{entry.category}</td>
                        <td className="py-2 pr-2 text-xs text-content-faint">
                          {[departmentName(entry.department_id), link].filter(Boolean).join(' · ') || '—'}
                        </td>
                        <td
                          className={`py-2 pr-2 font-medium whitespace-nowrap ${
                            entry.kind === 'receita' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {entry.kind === 'despesa' && '-'}
                          {formatValue(Number(entry.amount), 'currency')}
                        </td>
                        {canWrite && (
                          <td className="py-2">
                            <div className="flex shrink-0 gap-1">
                              <button
                                type="button"
                                className="rounded p-1 text-content-faint hover:bg-hover hover:text-content"
                                onClick={() => openEdit(entry)}
                                aria-label="Editar lançamento"
                                title="Editar"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                className="rounded p-1 text-content-faint hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400"
                                onClick={() => entryDelete.ask(entry)}
                                aria-label="Excluir lançamento"
                                title="Excluir"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {cashflow.length > 1 && (
            <Card title="Fluxo de caixa por mês" description="Receita, despesa e saldo acumulado, mês a mês.">
              <div className="-mx-1 overflow-x-auto px-1">
                <table className="w-full min-w-[32rem] text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase tracking-wide text-content-faint">
                      <th className="py-2 pr-2">Mês</th>
                      <th className="py-2 pr-2">Receita</th>
                      <th className="py-2 pr-2">Despesa</th>
                      <th className="py-2 pr-2">Saldo do mês</th>
                      <th className="py-2">Saldo acumulado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashflow.map((row) => (
                      <tr key={row.month} className="border-b border-line">
                        <td className="py-2 pr-2 capitalize">{monthLabel(row.month)}</td>
                        <td className="py-2 pr-2 text-emerald-600 dark:text-emerald-400">
                          {formatValue(row.revenue, 'currency')}
                        </td>
                        <td className="py-2 pr-2 text-rose-600 dark:text-rose-400">
                          {formatValue(row.expense, 'currency')}
                        </td>
                        <td className={`py-2 pr-2 ${row.balance < 0 ? 'text-rose-600 dark:text-rose-400' : ''}`}>
                          {formatValue(row.balance, 'currency')}
                        </td>
                        <td className={`py-2 font-medium ${row.cumulative < 0 ? 'text-rose-600 dark:text-rose-400' : ''}`}>
                          {formatValue(row.cumulative, 'currency')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      <Modal
        open={Boolean(modal)}
        title={modal?.editing ? 'Editar lançamento' : 'Novo lançamento'}
        onClose={() => setModal(null)}
        width="max-w-lg"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setModal(null)}>
              Cancelar
            </button>
            <button type="submit" form="financial-entry-form" className="btn-primary" disabled={busy}>
              {busy && <Spinner />}
              {modal?.editing ? 'Salvar' : 'Criar lançamento'}
            </button>
          </>
        }
      >
        <form id="financial-entry-form" onSubmit={submit} className="space-y-4">
          <Field asGroup label="Tipo">
            <div className="grid grid-cols-2 gap-2">
              {(['despesa', 'receita'] as BudgetItemKind[]).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setForm((c) => ({ ...c, kind }))}
                  className={`rounded-lg border px-3 py-2 text-sm transition ${
                    form.kind === kind
                      ? 'border-brand-500 bg-brand/10 font-medium text-brand-text'
                      : 'border-line-strong text-content-muted hover:bg-hover'
                  }`}
                >
                  {KIND_LABEL[kind]}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Descrição">
            <input
              className="input"
              required
              autoFocus
              placeholder="Ex.: Pagamento de fornecedor, recebimento de cliente…"
              value={form.description}
              onChange={(event) => setForm((c) => ({ ...c, description: event.target.value }))}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Valor">
              <NumberInput
                unit="currency"
                value={form.amount}
                onChange={(value) => setForm((c) => ({ ...c, amount: value }))}
              />
            </Field>
            <Field label="Data">
              <input
                className="input"
                type="date"
                value={form.occurred_at}
                onChange={(event) => setForm((c) => ({ ...c, occurred_at: event.target.value }))}
              />
            </Field>
          </div>

          <Field label="Categoria" hint="Opcional — livre, ex.: Fornecedores, Impostos, Vendas.">
            <input
              className="input"
              placeholder="Geral"
              value={form.category}
              onChange={(event) => setForm((c) => ({ ...c, category: event.target.value }))}
            />
          </Field>

          {departments.length > 0 && (
            <Field label="Área" hint="Opcional — organiza este lançamento junto com os indicadores e tarefas da mesma área.">
              <select
                className="input"
                value={form.department_id}
                onChange={(event) => setForm((c) => ({ ...c, department_id: event.target.value }))}
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

          {products.length > 0 && (
            <Field label="Produto" hint="Opcional — deixe em branco se for um lançamento geral da empresa.">
              <select
                className="input"
                value={form.product_id}
                onChange={(event) =>
                  setForm((c) => ({ ...c, product_id: event.target.value, product_edition_id: '' }))
                }
              >
                <option value="">Nenhum — lançamento da empresa toda</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {form.product_id && editionsForProduct.length > 0 && (
            <Field label="Turma" hint="Opcional — deixe em branco se for do produto inteiro.">
              <select
                className="input"
                value={form.product_edition_id}
                onChange={(event) => setForm((c) => ({ ...c, product_edition_id: event.target.value }))}
              >
                <option value="">Nenhuma — lançamento do produto inteiro</option>
                {editionsForProduct.map((edition) => (
                  <option key={edition.id} value={edition.id}>
                    {edition.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {error && <ErrorText>{error}</ErrorText>}
        </form>
      </Modal>

      <ConfirmDialog
        open={entryDelete.target !== null}
        title="Excluir lançamento?"
        danger
        busy={entryDelete.busy}
        confirmLabel="Excluir"
        message={`Isso remove "${entryDelete.target?.description}" do livro-caixa. Não dá pra desfazer.`}
        onConfirm={() => void entryDelete.confirm()}
        onCancel={entryDelete.cancel}
      />
    </div>
  )
}

// O financeiro da holding é o financeiro da empresa controladora — mesma
// tabela, mesma RLS, mesmo critério já usado por orçamentos/notas/tarefas.
function CompanyFinancials() {
  const { company, canWrite } = useCompany()
  return <FinancialsBoard company={company} canWrite={canWrite} basePath={`/empresa/${company.id}`} />
}

function HoldingFinancials() {
  const { memberships, isSuperAdmin } = useAuth()
  const holding = memberships.find((item) => item.company.is_holding)?.company

  if (!holding) {
    return (
      <EmptyState
        title="Empresa controladora não encontrada"
        description="Cadastre a empresa marcada como holding para usar o financeiro do grupo."
      />
    )
  }

  return <FinancialsBoard company={holding} canWrite={isSuperAdmin} basePath="/holding" />
}

export default function FinancialsPage({ scope = 'company' }: { scope?: 'company' | 'holding' }) {
  return scope === 'holding' ? <HoldingFinancials /> : <CompanyFinancials />
}
