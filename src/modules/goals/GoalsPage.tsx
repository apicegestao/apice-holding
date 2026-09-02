// Metas da empresa. Cada meta pode se apoiar num KPI já cadastrado.
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../core/lib/supabase'
import { formatDate, formatValue, relativeDays } from '../../core/lib/format'
import { useAuth } from '../../core/auth/AuthProvider'
import { useCompany } from '../../core/company/CompanyProvider'
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
  Spinner,
  useToast,
} from '../../core/ui'
import {
  GOAL_STATUS_LABEL,
  UNIT_LABEL,
  type Goal,
  type GoalStatus,
  type Kpi,
  type KpiUnit,
  type Profile,
} from '../../core/types'

const STATUSES: GoalStatus[] = ['planned', 'active', 'at_risk', 'achieved', 'missed']
const UNITS: KpiUnit[] = ['currency', 'percent', 'number', 'days', 'ratio']

function statusTone(status: GoalStatus) {
  if (status === 'achieved') return 'green'
  if (status === 'at_risk') return 'amber'
  if (status === 'missed') return 'red'
  return 'slate'
}

const emptyGoal = {
  title: '',
  description: '',
  kpi_id: '',
  target_value: null as number | null,
  current_value: 0 as number | null,
  unit: 'number' as KpiUnit,
  start_date: new Date().toISOString().slice(0, 10),
  due_date: '',
  status: 'active' as GoalStatus,
  owner_id: '',
}

export default function GoalsPage() {
  const { company, canWrite } = useCompany()
  const { profile } = useAuth()
  const { notify } = useToast()

  const [goals, setGoals] = useState<Goal[]>([])
  const [kpis, setKpis] = useState<Kpi[]>([])
  const [people, setPeople] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(emptyGoal)
  const [editing, setEditing] = useState<Goal | null>(null)
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState<Goal | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [goalResult, kpiResult, memberResult] = await Promise.all([
      supabase
        .from('goals')
        .select('*')
        .eq('company_id', company.id)
        .order('due_date', { ascending: true, nullsFirst: false }),
      supabase.from('kpis').select('*').eq('company_id', company.id).eq('is_active', true),
      supabase.from('company_members').select('user_id').eq('company_id', company.id),
    ])

    const ids = (memberResult.data ?? []).map((row) => row.user_id)
    const { data: profileRows } = ids.length
      ? await supabase.from('profiles').select('*').in('id', ids)
      : { data: [] as Profile[] }

    setGoals((goalResult.data as Goal[]) ?? [])
    setKpis((kpiResult.data as Kpi[]) ?? [])
    setPeople((profileRows as Profile[]) ?? [])
    setLoading(false)
  }, [company.id])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = () => {
    setForm(emptyGoal)
    setError('')
    setCreating(true)
  }

  const openEdit = (goal: Goal) => {
    setForm({
      title: goal.title,
      description: goal.description ?? '',
      kpi_id: goal.kpi_id ?? '',
      target_value: goal.target_value,
      current_value: Number(goal.current_value),
      unit: goal.unit,
      start_date: goal.start_date,
      due_date: goal.due_date ?? '',
      status: goal.status,
      owner_id: goal.owner_id ?? '',
    })
    setError('')
    setEditing(goal)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')

    if (!form.title.trim()) {
      setError('Descreva a meta.')
      return
    }

    const payload = {
      company_id: company.id,
      title: form.title.trim(),
      description: form.description.trim() || null,
      kpi_id: form.kpi_id || null,
      target_value: form.target_value,
      current_value: form.current_value ?? 0,
      unit: form.unit,
      start_date: form.start_date,
      due_date: form.due_date || null,
      status: form.status,
      owner_id: form.owner_id || null,
      ...(editing ? {} : { created_by: profile?.id ?? null }),
    }

    setBusy(true)
    const result = editing
      ? await supabase.from('goals').update(payload).eq('id', editing.id)
      : await supabase.from('goals').insert(payload)
    setBusy(false)

    if (result.error) {
      setError(result.error.message)
      return
    }

    notify(editing ? 'Meta atualizada.' : 'Meta criada.')
    setCreating(false)
    setEditing(null)
    await load()
  }

  const remove = async () => {
    if (!removing) return
    setBusy(true)
    const { error: deleteError } = await supabase.from('goals').delete().eq('id', removing.id)
    setBusy(false)
    if (deleteError) {
      notify(deleteError.message, 'error')
      return
    }
    notify('Meta excluída.')
    setRemoving(null)
    await load()
  }

  const ownerName = (id: string | null) =>
    id ? (people.find((person) => person.id === id)?.full_name ?? '—') : 'Sem responsável'

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`Metas · ${company.name}`}
        subtitle="O que precisa acontecer, até quando e quem responde."
        actions={
          canWrite && (
            <button type="button" className="btn-primary" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Nova meta
            </button>
          )
        }
      />

      {loading ? (
        <Loading />
      ) : goals.length === 0 ? (
        <EmptyState
          title="Nenhuma meta definida"
          description="Uma meta boa tem número, prazo e dono."
          action={
            canWrite && (
              <button type="button" className="btn-primary" onClick={openCreate}>
                <Plus className="h-4 w-4" /> Nova meta
              </button>
            )
          }
        />
      ) : (
        <div className="space-y-3">
          {goals.map((goal) => {
            const target = goal.target_value === null ? null : Number(goal.target_value)
            const progress =
              target && target !== 0
                ? Math.max(0, Math.min(100, Math.round((Number(goal.current_value) / target) * 100)))
                : null
            const late =
              goal.due_date &&
              goal.due_date < new Date().toISOString().slice(0, 10) &&
              !['achieved', 'missed'].includes(goal.status)

            return (
              <Card key={goal.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-ink-900">{goal.title}</h3>
                      <Badge tone={statusTone(goal.status)}>{GOAL_STATUS_LABEL[goal.status]}</Badge>
                      {late && <Badge tone="red">prazo estourado</Badge>}
                    </div>
                    {goal.description && (
                      <p className="mt-1 text-sm text-slate-600">{goal.description}</p>
                    )}
                    <p className="mt-1.5 text-xs text-slate-500">
                      {ownerName(goal.owner_id)} · prazo {formatDate(goal.due_date)}
                      {goal.due_date && <> ({relativeDays(goal.due_date)})</>}
                    </p>
                  </div>

                  <div className="flex items-center gap-4">
                    {target !== null && (
                      <div className="text-right">
                        <p className="text-lg font-semibold">
                          {formatValue(Number(goal.current_value), goal.unit)}
                        </p>
                        <p className="text-xs text-slate-500">
                          de {formatValue(target, goal.unit)}
                        </p>
                      </div>
                    )}
                    {canWrite && (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          onClick={() => openEdit(goal)}
                          aria-label="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          onClick={() => setRemoving(goal)}
                          aria-label="Excluir"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {progress !== null && (
                  <div className="mt-3">
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${
                          progress >= 100 ? 'bg-emerald-500' : 'bg-brand-500'
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{progress}% do alvo</p>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <Modal
        open={creating || Boolean(editing)}
        title={editing ? 'Editar meta' : 'Nova meta'}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        footer={
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setCreating(false)
                setEditing(null)
              }}
            >
              Cancelar
            </button>
            <button type="submit" form="goal-form" className="btn-primary" disabled={busy}>
              {busy && <Spinner />}
              {editing ? 'Salvar' : 'Criar meta'}
            </button>
          </>
        }
      >
        <form id="goal-form" onSubmit={submit} className="space-y-4">
          <Field label="Meta">
            <input
              className="input"
              required
              placeholder="Chegar a R$ 500 mil de faturamento mensal"
              value={form.title}
              onChange={(event) => setForm((c) => ({ ...c, title: event.target.value }))}
            />
          </Field>
          <Field label="Contexto">
            <textarea
              className="input min-h-16"
              value={form.description}
              onChange={(event) => setForm((c) => ({ ...c, description: event.target.value }))}
            />
          </Field>

          <Field label="KPI relacionado" hint="Opcional — liga a meta a um indicador já cadastrado.">
            <select
              className="input"
              value={form.kpi_id}
              onChange={(event) => {
                const kpi = kpis.find((item) => item.id === event.target.value)
                setForm((c) => ({
                  ...c,
                  kpi_id: event.target.value,
                  unit: kpi ? kpi.unit : c.unit,
                  target_value: kpi?.target_value ?? c.target_value,
                }))
              }}
            >
              <option value="">Nenhum</option>
              {kpis.map((kpi) => (
                <option key={kpi.id} value={kpi.id}>
                  {kpi.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Alvo">
              <NumberInput
                unit={form.unit}
                value={form.target_value}
                onChange={(target_value) => setForm((c) => ({ ...c, target_value }))}
              />
            </Field>
            <Field label="Hoje">
              <NumberInput
                unit={form.unit}
                value={form.current_value}
                onChange={(current_value) => setForm((c) => ({ ...c, current_value }))}
              />
            </Field>
            <Field label="Unidade">
              <select
                className="input"
                value={form.unit}
                onChange={(event) => setForm((c) => ({ ...c, unit: event.target.value as KpiUnit }))}
              >
                {UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {UNIT_LABEL[unit]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Início">
              <input
                className="input"
                type="date"
                value={form.start_date}
                onChange={(event) => setForm((c) => ({ ...c, start_date: event.target.value }))}
              />
            </Field>
            <Field label="Prazo">
              <input
                className="input"
                type="date"
                value={form.due_date}
                onChange={(event) => setForm((c) => ({ ...c, due_date: event.target.value }))}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Responsável">
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
            <Field label="Situação">
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
          </div>

          {error && <ErrorText>{error}</ErrorText>}
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(removing)}
        title="Excluir meta"
        danger
        busy={busy}
        confirmLabel="Excluir"
        message={<>Excluir <strong>{removing?.title}</strong>?</>}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </div>
  )
}
