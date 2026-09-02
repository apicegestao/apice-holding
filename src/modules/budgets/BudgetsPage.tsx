// Orçamentos: um por evento ou projeto (a mesa dos donos monta um pra cada
// evento que organiza). Dentro dele, linhas de receita e despesa — cada uma
// nasce como cotação, vira aprovada e por fim é paga/recebida — com valor
// previsto e valor realizado lado a lado, e uma projeção de caixa por mês
// calculada sempre na hora, a partir das linhas de verdade.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { CalendarRange, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../core/lib/supabase'
import { useAuth } from '../../core/auth/AuthProvider'
import { useCompany } from '../../core/company/CompanyProvider'
import { formatDate, formatValue } from '../../core/lib/format'
import {
  Badge,
  Card,
  ConfirmDialog,
  EmptyState,
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
import {
  BUDGET_ITEM_STATUS_LABEL,
  BUDGET_STATUS_LABEL,
  type Budget,
  type BudgetItem,
  type BudgetItemKind,
  type BudgetItemStatus,
  type BudgetStatus,
  type Company,
} from '../../core/types'

const BUDGET_STATUSES: BudgetStatus[] = ['planejamento', 'aprovado', 'em_andamento', 'encerrado']
const ITEM_STATUSES: BudgetItemStatus[] = ['previsto', 'cotado', 'aprovado', 'pago', 'cancelado']
const STATUS_TONE: Record<BudgetStatus, 'slate' | 'blue' | 'amber' | 'green'> = {
  planejamento: 'slate',
  aprovado: 'blue',
  em_andamento: 'amber',
  encerrado: 'green',
}

// Soma em centavos e só volta pra reais no final — evita que uma sequência
// de somas em ponto flutuante (0,1 + 0,2 …) derive o total em um centavo.
const round2 = (value: number) => Math.round(value * 100) / 100

const monthLabel = (yearMonth: string) => {
  const [year, month] = yearMonth.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })
}

type BudgetForm = { title: string; description: string; event_date: string }
const blankBudgetForm: BudgetForm = { title: '', description: '', event_date: '' }

function BudgetsBoard({ company, canWrite }: { company: Company; canWrite: boolean }) {
  const { profile } = useAuth()
  const { notify } = useToast()

  const [budgets, setBudgets] = useState<Budget[]>([])
  const [loading, setLoading] = useState(true)
  const [activeBudgetId, setActiveBudgetId] = useState<string | null>(null)
  const [items, setItems] = useState<BudgetItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)

  // Versão enxuta de todo item da empresa, só pra somar previsto x realizado
  // por orçamento — a barra de execução no card da lista precisa disso sem
  // esperar a pessoa abrir cada orçamento um por um.
  const [itemTotalsRaw, setItemTotalsRaw] = useState<
    Pick<BudgetItem, 'budget_id' | 'kind' | 'planned_amount' | 'actual_amount' | 'status'>[]
  >([])

  const [budgetModal, setBudgetModal] = useState<{ editing: Budget | null } | null>(null)
  const [budgetForm, setBudgetForm] = useState<BudgetForm>(blankBudgetForm)
  const [busy, setBusy] = useState(false)

  const loadBudgets = useCallback(async () => {
    const { data } = await supabase
      .from('budgets')
      .select('*')
      .eq('company_id', company.id)
      .order('event_date', { ascending: true, nullsFirst: false })
    setBudgets((data as Budget[]) ?? [])
    setLoading(false)
  }, [company.id])

  const loadItemTotals = useCallback(async () => {
    const { data } = await supabase
      .from('budget_items')
      .select('budget_id, kind, planned_amount, actual_amount, status')
      .eq('company_id', company.id)
    setItemTotalsRaw(data ?? [])
  }, [company.id])

  useEffect(() => {
    setLoading(true)
    void loadBudgets()
    void loadItemTotals()
  }, [loadBudgets, loadItemTotals])

  // Só a execução de despesa interessa aqui — receita é outra história (não
  // tem "estourar"), e cancelado não conta, mesma regra dos totais do
  // orçamento aberto.
  const executionByBudget = useMemo(() => {
    const map = new Map<string, { planned: number; actual: number }>()
    for (const item of itemTotalsRaw) {
      if (item.kind !== 'despesa' || item.status === 'cancelado') continue
      const entry = map.get(item.budget_id) ?? { planned: 0, actual: 0 }
      entry.planned += Number(item.planned_amount)
      if (item.actual_amount !== null) entry.actual += Number(item.actual_amount)
      map.set(item.budget_id, entry)
    }
    return map
  }, [itemTotalsRaw])

  const loadItems = useCallback(async (budgetId: string) => {
    setItemsLoading(true)
    const { data } = await supabase
      .from('budget_items')
      .select('*')
      .eq('budget_id', budgetId)
      .order('due_date', { ascending: true, nullsFirst: false })
    setItems((data as BudgetItem[]) ?? [])
    setItemsLoading(false)
  }, [])

  useEffect(() => {
    if (activeBudgetId) void loadItems(activeBudgetId)
    else setItems([])
  }, [activeBudgetId, loadItems])

  const activeBudget = useMemo(
    () => budgets.find((item) => item.id === activeBudgetId) ?? null,
    [budgets, activeBudgetId],
  )

  // ------------------------------------------------------------- orçamento
  const openCreateBudget = () => {
    setBudgetForm(blankBudgetForm)
    setBudgetModal({ editing: null })
  }
  const openEditBudget = (budget: Budget) => {
    setBudgetForm({
      title: budget.title,
      description: budget.description ?? '',
      event_date: budget.event_date ?? '',
    })
    setBudgetModal({ editing: budget })
  }

  const submitBudget = async (event: FormEvent) => {
    event.preventDefault()
    if (!budgetForm.title.trim()) return

    const payload = {
      company_id: company.id,
      title: budgetForm.title.trim(),
      description: budgetForm.description.trim() || null,
      event_date: budgetForm.event_date || null,
    }

    setBusy(true)
    const editing = budgetModal?.editing ?? null
    const result = editing
      ? await supabase.from('budgets').update(payload).eq('id', editing.id).select().single()
      : await supabase
          .from('budgets')
          .insert({ ...payload, owner_id: profile?.id ?? null, created_by: profile?.id ?? null })
          .select()
          .single()
    setBusy(false)

    if (result.error || !result.data) {
      notify(result.error?.message ?? 'Não foi possível salvar o orçamento.', 'error')
      return
    }

    notify(editing ? 'Orçamento atualizado.' : 'Orçamento criado.')
    setBudgetModal(null)
    await loadBudgets()
    if (!editing) setActiveBudgetId(result.data.id as string)
  }

  const setBudgetStatus = async (budget: Budget, status: BudgetStatus) => {
    setBudgets((current) => current.map((item) => (item.id === budget.id ? { ...item, status } : item)))
    const { error } = await supabase.from('budgets').update({ status }).eq('id', budget.id)
    if (error) notify(error.message, 'error')
  }

  const budgetDelete = useConfirmDelete<Budget>(async (budget) => {
    const { error } = await supabase.from('budgets').delete().eq('id', budget.id)
    if (error) {
      notify(error.message, 'error')
      return
    }
    notify('Orçamento excluído.')
    if (activeBudgetId === budget.id) setActiveBudgetId(null)
    await loadBudgets()
  })

  // ------------------------------------------------------------------ itens
  const [itemForm, setItemForm] = useState<{
    kind: BudgetItemKind
    category: string
    title: string
    vendor: string
    planned_amount: number | null
    due_date: string
  }>({ kind: 'despesa', category: '', title: '', vendor: '', planned_amount: null, due_date: '' })

  const addItem = async () => {
    if (!activeBudgetId || !itemForm.title.trim() || itemForm.planned_amount === null) {
      notify('Informe pelo menos o título e o valor previsto.', 'error')
      return
    }
    const { error } = await supabase.from('budget_items').insert({
      budget_id: activeBudgetId,
      company_id: company.id,
      kind: itemForm.kind,
      category: itemForm.category.trim() || 'Geral',
      title: itemForm.title.trim(),
      vendor: itemForm.vendor.trim() || null,
      planned_amount: itemForm.planned_amount,
      due_date: itemForm.due_date || null,
      created_by: profile?.id ?? null,
    })
    if (error) {
      notify(error.message, 'error')
      return
    }
    setItemForm({ kind: itemForm.kind, category: '', title: '', vendor: '', planned_amount: null, due_date: '' })
    await loadItems(activeBudgetId)
    void loadItemTotals()
  }

  const patchItem = async (id: string, patch: Partial<BudgetItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
    const { error } = await supabase.from('budget_items').update(patch).eq('id', id)
    if (error) notify(error.message, 'error')
    else void loadItemTotals()
  }

  const itemDelete = useConfirmDelete<BudgetItem>(async (item) => {
    const { error } = await supabase.from('budget_items').delete().eq('id', item.id)
    if (error) {
      notify(error.message, 'error')
      return
    }
    if (activeBudgetId) await loadItems(activeBudgetId)
    void loadItemTotals()
  })

  // -------------------------------------------------------------- cálculos
  // Cancelado não entra em nenhuma conta — é como se a linha não existisse
  // mais, só fica visível pro histórico de que a cotação não vingou.
  const live = useMemo(() => items.filter((item) => item.status !== 'cancelado'), [items])

  const totals = useMemo(() => {
    const sum = (kind: BudgetItemKind, actual: boolean) =>
      round2(
        live
          .filter((item) => item.kind === kind && (!actual || item.actual_amount !== null))
          .reduce((acc, item) => acc + Number(actual ? item.actual_amount : item.planned_amount), 0),
      )
    const plannedRevenue = sum('receita', false)
    const plannedExpense = sum('despesa', false)
    const actualRevenue = sum('receita', true)
    const actualExpense = sum('despesa', true)
    return {
      plannedRevenue,
      plannedExpense,
      plannedBalance: round2(plannedRevenue - plannedExpense),
      actualRevenue,
      actualExpense,
      actualBalance: round2(actualRevenue - actualExpense),
    }
  }, [live])

  // Projeção de caixa por mês: só entram itens com data prevista — sem data
  // não dá pra saber em que mês o dinheiro entra ou sai.
  const cashflow = useMemo(() => {
    const byMonth = new Map<string, { planned: number; actual: number }>()
    for (const item of live) {
      if (!item.due_date) continue
      const month = item.due_date.slice(0, 7)
      const sign = item.kind === 'receita' ? 1 : -1
      const entry = byMonth.get(month) ?? { planned: 0, actual: 0 }
      entry.planned += sign * Number(item.planned_amount)
      if (item.actual_amount !== null) entry.actual += sign * Number(item.actual_amount)
      byMonth.set(month, entry)
    }
    const months = [...byMonth.keys()].sort()
    let cumPlanned = 0
    let cumActual = 0
    return months.map((month) => {
      const entry = byMonth.get(month)!
      cumPlanned = round2(cumPlanned + entry.planned)
      cumActual = round2(cumActual + entry.actual)
      return {
        month,
        planned: round2(entry.planned),
        actual: round2(entry.actual),
        cumPlanned,
        cumActual,
      }
    })
  }, [live])

  const withoutDate = live.length - live.filter((item) => item.due_date).length

  if (loading) return <Loading />

  return (
    <div className="mx-auto flex max-w-6xl flex-col">
      <PageHeader
        title={`Orçamentos · ${company.name}`}
        subtitle="Um orçamento por evento ou projeto: cotações, despesas e a projeção de caixa, tudo num lugar."
        actions={
          canWrite && (
            <button type="button" className="btn-primary" onClick={openCreateBudget}>
              <Plus className="h-4 w-4" /> Novo orçamento
            </button>
          )
        }
      />

      {budgets.length === 0 ? (
        <EmptyState
          title="Nenhum orçamento ainda"
          description="Crie um orçamento pra cada evento ou projeto — cotações, despesas e projeção de caixa organizados nele."
          action={
            canWrite && (
              <button type="button" className="btn-primary" onClick={openCreateBudget}>
                <Plus className="h-4 w-4" /> Criar orçamento
              </button>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {budgets.map((budget) => {
            const execution = executionByBudget.get(budget.id)
            const ratio = execution && execution.planned > 0 ? execution.actual / execution.planned : null
            return (
              <button
                key={budget.id}
                type="button"
                onClick={() => setActiveBudgetId(budget.id)}
                className="card min-w-0 p-4 text-left transition hover:border-brand-500"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-semibold text-content">{budget.title}</p>
                  <Badge tone={STATUS_TONE[budget.status]}>{BUDGET_STATUS_LABEL[budget.status]}</Badge>
                </div>
                {budget.event_date && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-content-soft">
                    <CalendarRange className="h-3.5 w-3.5" /> {formatDate(budget.event_date)}
                  </p>
                )}
                {budget.description && (
                  <p className="mt-2 line-clamp-2 text-xs text-content-soft">{budget.description}</p>
                )}
                {ratio !== null && execution && (
                  <div className="mt-3">
                    <ProgressBar
                      ratio={ratio}
                      label="Despesa executada"
                      variant="spend"
                      caption={`${formatValue(execution.actual, 'currency')} de ${formatValue(execution.planned, 'currency')} previstos`}
                    />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* --------------------------------------------------- novo/editar */}
      <Modal
        open={Boolean(budgetModal)}
        title={budgetModal?.editing ? 'Editar orçamento' : 'Novo orçamento'}
        onClose={() => setBudgetModal(null)}
        width="max-w-md"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setBudgetModal(null)}>
              Cancelar
            </button>
            <button type="submit" form="budget-form" className="btn-primary" disabled={busy}>
              {busy && <Spinner />}
              {budgetModal?.editing ? 'Salvar' : 'Criar'}
            </button>
          </>
        }
      >
        <form id="budget-form" onSubmit={submitBudget} className="space-y-4">
          <Field label="Nome do evento ou projeto">
            <input
              className="input"
              required
              autoFocus
              value={budgetForm.title}
              onChange={(event) => setBudgetForm((c) => ({ ...c, title: event.target.value }))}
              placeholder="Imersão 2027, Confraternização de fim de ano…"
            />
          </Field>
          <Field label="Descrição" hint="Opcional.">
            <textarea
              className="input min-h-16"
              value={budgetForm.description}
              onChange={(event) => setBudgetForm((c) => ({ ...c, description: event.target.value }))}
            />
          </Field>
          <Field label="Data do evento" hint="Opcional — deixe em branco se ainda não tem data.">
            <input
              className="input"
              type="date"
              value={budgetForm.event_date}
              onChange={(event) => setBudgetForm((c) => ({ ...c, event_date: event.target.value }))}
            />
          </Field>
        </form>
      </Modal>

      {/* ------------------------------------------------------- detalhe */}
      <Modal
        open={Boolean(activeBudget)}
        title={activeBudget?.title ?? ''}
        onClose={() => setActiveBudgetId(null)}
        width="max-w-3xl"
      >
        {activeBudget && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Field asGroup label="Situação" className="min-w-0">
                <select
                  className="input w-auto"
                  disabled={!canWrite}
                  value={activeBudget.status}
                  onChange={(event) => void setBudgetStatus(activeBudget, event.target.value as BudgetStatus)}
                >
                  {BUDGET_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {BUDGET_STATUS_LABEL[status]}
                    </option>
                  ))}
                </select>
              </Field>
              {canWrite && (
                <div className="flex gap-2">
                  <button type="button" className="btn-ghost" onClick={() => openEditBudget(activeBudget)}>
                    Editar
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-rose-600 dark:text-rose-400"
                    onClick={() => budgetDelete.ask(activeBudget)}
                  >
                    <Trash2 className="h-4 w-4" /> Excluir
                  </button>
                </div>
              )}
            </div>

            {/* ------------------------------------------------ totais */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Card title="Receita prevista">
                <p className="text-lg font-semibold text-content">{formatValue(totals.plannedRevenue, 'currency')}</p>
              </Card>
              <Card title="Despesa prevista">
                <p className="text-lg font-semibold text-content">{formatValue(totals.plannedExpense, 'currency')}</p>
              </Card>
              <Card title="Saldo previsto">
                <p
                  className={`text-lg font-semibold ${totals.plannedBalance < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-content'}`}
                >
                  {formatValue(totals.plannedBalance, 'currency')}
                </p>
              </Card>
              <Card title="Receita realizada">
                <p className="text-lg font-semibold text-content">{formatValue(totals.actualRevenue, 'currency')}</p>
              </Card>
              <Card title="Despesa realizada">
                <p className="text-lg font-semibold text-content">{formatValue(totals.actualExpense, 'currency')}</p>
              </Card>
              <Card title="Saldo realizado">
                <p
                  className={`text-lg font-semibold ${totals.actualBalance < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-content'}`}
                >
                  {formatValue(totals.actualBalance, 'currency')}
                </p>
              </Card>
            </div>

            {/* -------------------------------------------------- itens */}
            {itemsLoading ? (
              <Loading />
            ) : (
              <div>
                <p className="label">Cotações e lançamentos</p>
                {items.length === 0 ? (
                  <p className="mt-1 text-sm text-content-soft">Nenhum item lançado ainda.</p>
                ) : (
                  <div className="-mx-1 mt-2 overflow-x-auto px-1">
                    <table className="w-full min-w-[42rem] text-left text-sm">
                      <thead>
                        <tr className="border-b border-line text-xs uppercase tracking-wide text-content-faint">
                          <th className="py-2 pr-2">Item</th>
                          <th className="py-2 pr-2">Categoria</th>
                          <th className="py-2 pr-2">Situação</th>
                          <th className="py-2 pr-2">Previsto</th>
                          <th className="py-2 pr-2">Realizado</th>
                          <th className="py-2 pr-2">Data</th>
                          {canWrite && <th className="py-2" />}
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item) => (
                          <tr key={item.id} className="border-b border-line align-top">
                            <td className="max-w-[12rem] py-2 pr-2">
                              <p className="truncate font-medium text-content">{item.title}</p>
                              {item.vendor && <p className="truncate text-xs text-content-soft">{item.vendor}</p>}
                            </td>
                            <td className="py-2 pr-2 text-xs text-content-soft">{item.category}</td>
                            <td className="py-2 pr-2">
                              <select
                                className="input py-1 text-base sm:text-xs"
                                disabled={!canWrite}
                                value={item.status}
                                onChange={(event) => void patchItem(item.id, { status: event.target.value as BudgetItemStatus })}
                              >
                                {ITEM_STATUSES.map((status) => (
                                  <option key={status} value={status}>
                                    {BUDGET_ITEM_STATUS_LABEL[item.kind][status]}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td
                              className={`py-2 pr-2 font-medium ${item.kind === 'receita' ? 'text-emerald-600 dark:text-emerald-400' : 'text-content'}`}
                            >
                              {item.kind === 'despesa' ? '-' : ''}
                              {formatValue(Number(item.planned_amount), 'currency')}
                            </td>
                            <td className="py-2 pr-2">
                              <NumberInput
                                className="w-28"
                                unit="currency"
                                value={item.actual_amount === null ? null : Number(item.actual_amount)}
                                onChange={(value) => void patchItem(item.id, { actual_amount: value })}
                              />
                            </td>
                            <td className="py-2 pr-2 text-xs text-content-soft">
                              {item.due_date ? formatDate(item.due_date) : '—'}
                            </td>
                            {canWrite && (
                              <td className="py-2 text-right">
                                <button
                                  type="button"
                                  className="rounded p-1 text-content-faint hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400"
                                  onClick={() => itemDelete.ask(item)}
                                  aria-label="Remover item"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {canWrite && (
                  <div className="mt-4 space-y-3 rounded-lg border border-dashed border-line-strong p-3">
                    <p className="label">Adicionar item</p>
                    <div className="grid grid-cols-2 gap-2">
                      {(['despesa', 'receita'] as BudgetItemKind[]).map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          onClick={() => setItemForm((c) => ({ ...c, kind }))}
                          className={`rounded-lg border px-3 py-2 text-sm transition ${
                            itemForm.kind === kind
                              ? 'border-brand-500 bg-brand/10 font-medium text-brand-text'
                              : 'border-line-strong text-content-muted hover:bg-hover'
                          }`}
                        >
                          {kind === 'despesa' ? 'Despesa' : 'Receita'}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <input
                        className="input"
                        placeholder="Título (ex.: Buffet, Ingressos…)"
                        value={itemForm.title}
                        onChange={(event) => setItemForm((c) => ({ ...c, title: event.target.value }))}
                      />
                      <input
                        className="input"
                        placeholder="Categoria (ex.: Alimentação)"
                        value={itemForm.category}
                        onChange={(event) => setItemForm((c) => ({ ...c, category: event.target.value }))}
                      />
                      <input
                        className="input"
                        placeholder="Fornecedor (opcional)"
                        value={itemForm.vendor}
                        onChange={(event) => setItemForm((c) => ({ ...c, vendor: event.target.value }))}
                      />
                      <NumberInput
                        unit="currency"
                        placeholder="Valor previsto"
                        value={itemForm.planned_amount}
                        onChange={(value) => setItemForm((c) => ({ ...c, planned_amount: value }))}
                      />
                      <input
                        className="input"
                        type="date"
                        value={itemForm.due_date}
                        onChange={(event) => setItemForm((c) => ({ ...c, due_date: event.target.value }))}
                      />
                    </div>
                    <button type="button" className="btn-primary w-full sm:w-auto" onClick={() => void addItem()}>
                      <Plus className="h-4 w-4" /> Adicionar
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ---------------------------------------------- fluxo de caixa */}
            {cashflow.length > 0 && (
              <div>
                <p className="label">Projeção de caixa por mês</p>
                {withoutDate > 0 && (
                  <p className="mt-1 text-xs text-content-faint">
                    {withoutDate} item(ns) sem data prevista entram nos totais acima, mas não aparecem aqui.
                  </p>
                )}
                <div className="-mx-1 mt-2 overflow-x-auto px-1">
                  <table className="w-full min-w-[32rem] text-left text-sm">
                    <thead>
                      <tr className="border-b border-line text-xs uppercase tracking-wide text-content-faint">
                        <th className="py-2 pr-2">Mês</th>
                        <th className="py-2 pr-2">Previsto no mês</th>
                        <th className="py-2 pr-2">Saldo acumulado (previsto)</th>
                        <th className="py-2 pr-2">Realizado no mês</th>
                        <th className="py-2">Saldo acumulado (realizado)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cashflow.map((row) => (
                        <tr key={row.month} className="border-b border-line">
                          <td className="py-2 pr-2 capitalize">{monthLabel(row.month)}</td>
                          <td className={`py-2 pr-2 ${row.planned < 0 ? 'text-rose-600 dark:text-rose-400' : ''}`}>
                            {formatValue(row.planned, 'currency')}
                          </td>
                          <td className={`py-2 pr-2 font-medium ${row.cumPlanned < 0 ? 'text-rose-600 dark:text-rose-400' : ''}`}>
                            {formatValue(row.cumPlanned, 'currency')}
                          </td>
                          <td className={`py-2 pr-2 ${row.actual < 0 ? 'text-rose-600 dark:text-rose-400' : ''}`}>
                            {formatValue(row.actual, 'currency')}
                          </td>
                          <td className={`py-2 font-medium ${row.cumActual < 0 ? 'text-rose-600 dark:text-rose-400' : ''}`}>
                            {formatValue(row.cumActual, 'currency')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={budgetDelete.target !== null}
        title="Excluir orçamento?"
        message={
          <>
            Excluir <strong>{budgetDelete.target?.title}</strong> apaga também todos os itens lançados nele. Não
            dá pra desfazer.
          </>
        }
        confirmLabel="Excluir"
        danger
        busy={budgetDelete.busy}
        onConfirm={() => void budgetDelete.confirm()}
        onCancel={budgetDelete.cancel}
      />

      <ConfirmDialog
        open={itemDelete.target !== null}
        title="Excluir item?"
        message={`Isso remove "${itemDelete.target?.title}" do orçamento. Não dá pra desfazer.`}
        confirmLabel="Excluir"
        danger
        busy={itemDelete.busy}
        onConfirm={() => void itemDelete.confirm()}
        onCancel={itemDelete.cancel}
      />
    </div>
  )
}

// O orçamento da holding é o orçamento da empresa controladora: mesma
// tabela, mesma RLS — igual ao mapa mental e às tarefas da holding.
function CompanyBudgets() {
  const { company, canWrite } = useCompany()
  return <BudgetsBoard company={company} canWrite={canWrite} />
}

function HoldingBudgets() {
  const { memberships, isSuperAdmin } = useAuth()
  const holding = memberships.find((item) => item.company.is_holding)?.company

  if (!holding) {
    return (
      <EmptyState
        title="Empresa controladora não encontrada"
        description="Cadastre a empresa marcada como holding para usar os orçamentos do grupo."
      />
    )
  }

  return <BudgetsBoard company={holding} canWrite={isSuperAdmin} />
}

export default function BudgetsPage({ scope = 'company' }: { scope?: 'company' | 'holding' }) {
  return scope === 'holding' ? <HoldingBudgets /> : <CompanyBudgets />
}
