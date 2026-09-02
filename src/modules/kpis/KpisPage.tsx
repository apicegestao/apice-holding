// KPIs e metas da empresa — a mesma coisa: cadastro, lançamento por período,
// histórico e, quando o indicador tem prazo, quem responde e como está indo.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarRange,
  History,
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
  type Profile,
} from '../../core/types'

const UNITS: KpiUnit[] = ['currency', 'percent', 'number', 'days', 'ratio']
const FREQUENCIES: KpiFrequency[] = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']
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
}

export default function KpisPage() {
  const { company, canWrite } = useCompany()
  const { notify } = useToast()
  const chart = useChartTheme()
  const [searchParams] = useSearchParams()

  const [kpis, setKpis] = useState<Kpi[]>([])
  const [values, setValues] = useState<KpiValue[]>([])
  const [people, setPeople] = useState<Profile[]>([])
  const [checkpoints, setCheckpoints] = useState<KpiCheckpoint[]>([])
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
    const [{ data: kpiRows }, { data: memberRows }] = await Promise.all([
      supabase
        .from('kpis')
        .select('*')
        .eq('company_id', company.id)
        .order('display_order')
        .order('name'),
      supabase.from('company_members').select('user_id').eq('company_id', company.id),
    ])

    const ids = (kpiRows ?? []).map((row) => row.id)
    const [{ data: valueRows }, { data: checkpointRows }] = await Promise.all([
      ids.length
        ? supabase.from('kpi_values').select('*').in('kpi_id', ids).order('period_start', { ascending: true })
        : Promise.resolve({ data: [] as KpiValue[] }),
      ids.length
        ? supabase.from('kpi_checkpoints').select('*').in('kpi_id', ids).order('seq', { ascending: true })
        : Promise.resolve({ data: [] as KpiCheckpoint[] }),
    ])

    const memberIds = (memberRows ?? []).map((row) => row.user_id)
    const { data: profileRows } = memberIds.length
      ? await supabase.from('profiles').select('*').in('id', memberIds)
      : { data: [] as Profile[] }

    setKpis((kpiRows as Kpi[]) ?? [])
    setValues((valueRows as KpiValue[]) ?? [])
    setCheckpoints((checkpointRows as KpiCheckpoint[]) ?? [])
    setPeople((profileRows as Profile[]) ?? [])
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

  const openCreate = () => {
    setKpiForm(emptyKpi)
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

  const ownerName = (id: string | null) =>
    id ? (people.find((person) => person.id === id)?.full_name ?? '—') : null

  const checkpointsByKpi = useMemo(() => {
    const map = new Map<string, KpiCheckpoint[]>()
    for (const checkpoint of checkpoints) {
      const list = map.get(checkpoint.kpi_id) ?? []
      list.push(checkpoint)
      map.set(checkpoint.kpi_id, list)
    }
    return map
  }, [checkpoints])

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={`KPIs e metas · ${company.name}`}
        subtitle="Indicadores desta empresa. Um KPI com prazo já é a meta — com responsável e andamento."
        actions={
          canWrite && (
            <button type="button" className="btn-primary" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Novo KPI
            </button>
          )
        }
      />

      {loading ? (
        <Loading />
      ) : kpis.length === 0 ? (
        <EmptyState
          title="Nenhum indicador ainda"
          description="Comece pelos números que você olharia primeiro se pudesse ver só três."
          action={
            canWrite && (
              <button type="button" className="btn-primary" onClick={openCreate}>
                <Plus className="h-4 w-4" /> Novo KPI
              </button>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {kpis.map((kpi) => {
            const series = seriesByKpi.get(kpi.id) ?? []
            const latest = series[series.length - 1]
            const previous = series[series.length - 2]
            const onTarget = latest ? isOnTarget(Number(latest.value), kpi.target_value, kpi.direction) : null
            const ratio = latest
              ? attainmentRatio(Number(latest.value), kpi.target_value, kpi.direction)
              : null
            const delta =
              latest && previous ? Number(latest.value) - Number(previous.value) : null
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
                    </p>
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
                      {latest ? formatValue(Number(latest.value), kpi.unit) : '—'}
                    </p>
                    <p className="text-xs text-content-soft">
                      {latest ? labelPeriod(latest.period_start, kpi.frequency) : 'sem lançamento'}
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
                  {canWrite && (
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
                onChange={(event) =>
                  setKpiForm((c) => ({ ...c, frequency: event.target.value as KpiFrequency }))
                }
              >
                {FREQUENCIES.map((item) => (
                  <option key={item} value={item}>
                    {FREQUENCY_LABEL[item]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
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
  onClose,
  onSaved,
}: {
  kpi: Kpi
  companyId: string
  existing: KpiValue[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { notify } = useToast()
  // A frequência do KPI já diz o tamanho do período — pedir início E fim
  // toda vez que alguém lança um valor é redundante (e ainda deixa abrir
  // brecha pra um intervalo que não bate com a frequência). Um único campo
  // de referência basta: a pessoa escolhe qualquer dia dentro do período
  // que quer lançar (hoje, por padrão) e o sistema calcula o intervalo
  // certo sozinho, do mesmo jeito que já calculava a data padrão antes.
  const [reference, setReference] = useState(() => new Date().toISOString().slice(0, 10))
  const [value, setValue] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const { start: periodStart, end: periodEnd } = useMemo(
    () => periodBounds(kpi.frequency, new Date(`${reference}T12:00:00`)),
    [kpi.frequency, reference],
  )

  // Se já existe lançamento no período escolhido, o formulário vira edição.
  useEffect(() => {
    const found = existing.find((item) => item.period_start === periodStart)
    setValue(found ? Number(found.value) : null)
    setNote(found?.note ?? '')
  }, [periodStart, existing])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (value === null) {
      setError('Informe o valor apurado.')
      return
    }

    setBusy(true)
    const { error: upsertError } = await supabase.from('kpi_values').upsert(
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
      description={`Medição ${FREQUENCY_LABEL[kpi.frequency].toLowerCase()}`}
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
          label={kpi.frequency === 'daily' ? 'Dia' : 'Qualquer dia do período'}
          hint={
            kpi.frequency === 'daily'
              ? undefined
              : `Período: ${formatDate(periodStart)} a ${formatDate(periodEnd)}`
          }
        >
          {kpi.frequency === 'monthly' ? (
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
        {/* Atualiza junto com o valor digitado — vê o efeito antes de salvar. */}
        {(() => {
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
  checkpoints,
  canWrite,
  onClose,
  onChanged,
}: {
  kpi: Kpi
  series: KpiValue[]
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

      {series.length === 0 ? (
        <EmptyState title="Sem lançamentos" description="Registre o primeiro valor deste KPI." />
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
