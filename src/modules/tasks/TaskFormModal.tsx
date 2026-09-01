// Formulário de tarefa, usado tanto dentro da empresa quanto no painel da
// holding. Concentra quem faz, prazo, lembrete e — o ponto delicado —
// quem enxerga a tarefa.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../../core/lib/supabase'
import { useAuth } from '../../core/auth/AuthProvider'
import { ErrorText, Field, Modal, Spinner, useToast } from '../../core/ui'
import {
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  VISIBILITY_HINT,
  VISIBILITY_LABEL,
  type Profile,
  type Task,
  type TaskPriority,
  type TaskStatus,
  type TaskVisibility,
} from '../../core/types'

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent']
const VISIBILITIES: TaskVisibility[] = ['private', 'company', 'shared']

/** datetime-local trabalha em horário local; o banco guarda timestamptz. */
export function toLocalInput(iso: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

type FormState = {
  company_id: string
  title: string
  description: string
  assignee_id: string
  due_date: string
  remind_at: string
  priority: TaskPriority
  status: TaskStatus
  visibility: TaskVisibility
  tags: string
}

const blank: FormState = {
  company_id: '',
  title: '',
  description: '',
  assignee_id: '',
  due_date: '',
  remind_at: '',
  priority: 'medium',
  status: 'todo',
  visibility: 'private',
  tags: '',
}

export default function TaskFormModal({
  open,
  task,
  fixedCompanyId,
  defaultStatus = 'todo',
  onClose,
  onSaved,
}: {
  open: boolean
  task?: Task | null
  fixedCompanyId?: string
  defaultStatus?: TaskStatus
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const { profile, memberships, canWrite } = useAuth()
  const { notify } = useToast()

  const [form, setForm] = useState<FormState>(blank)
  const [people, setPeople] = useState<Profile[]>([])
  const [shareCompanies, setShareCompanies] = useState<string[]>([])
  const [sharePeople, setSharePeople] = useState<string[]>([])
  const [allPeople, setAllPeople] = useState<Profile[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const companyOptions = useMemo(
    () => memberships.map((item) => item.company),
    [memberships],
  )

  // ------------------------------------------------------------ abertura
  useEffect(() => {
    if (!open) return
    setError('')

    if (task) {
      setForm({
        company_id: task.company_id,
        title: task.title,
        description: task.description ?? '',
        assignee_id: task.assignee_id ?? '',
        due_date: task.due_date ?? '',
        remind_at: toLocalInput(task.remind_at),
        priority: task.priority,
        status: task.status,
        visibility: task.visibility,
        tags: task.tags.join(', '),
      })
    } else {
      setForm({
        ...blank,
        status: defaultStatus,
        company_id: fixedCompanyId ?? companyOptions[0]?.id ?? '',
      })
      setShareCompanies([])
      setSharePeople([])
    }
  }, [open, task, fixedCompanyId, defaultStatus, companyOptions])

  // Compartilhamentos já existentes da tarefa em edição.
  useEffect(() => {
    if (!open || !task) return
    const load = async () => {
      const { data } = await supabase
        .from('task_shares')
        .select('company_id, user_id')
        .eq('task_id', task.id)
      setShareCompanies((data ?? []).filter((r) => r.company_id).map((r) => r.company_id as string))
      setSharePeople((data ?? []).filter((r) => r.user_id).map((r) => r.user_id as string))
    }
    void load()
  }, [open, task])

  // Responsáveis possíveis: quem tem acesso à empresa escolhida.
  const loadPeople = useCallback(async (companyId: string) => {
    if (!companyId) {
      setPeople([])
      return
    }
    const { data: members } = await supabase
      .from('company_members')
      .select('user_id')
      .eq('company_id', companyId)
    const ids = (members ?? []).map((row) => row.user_id)
    if (!ids.length) {
      setPeople([])
      return
    }
    const { data } = await supabase.from('profiles').select('*').in('id', ids).order('full_name')
    setPeople((data as Profile[]) ?? [])
  }, [])

  useEffect(() => {
    if (open) void loadPeople(form.company_id)
  }, [open, form.company_id, loadPeople])

  // Para compartilhar com uma pessoa específica: todo mundo que eu enxergo.
  useEffect(() => {
    if (!open || form.visibility !== 'shared' || allPeople.length) return
    const load = async () => {
      const { data } = await supabase.from('profiles').select('*').order('full_name')
      setAllPeople((data as Profile[]) ?? [])
    }
    void load()
  }, [open, form.visibility, allPeople.length])

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value]

  // --------------------------------------------------------------- salvar
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')

    if (!form.title.trim()) {
      setError('Diga o que precisa ser feito.')
      return
    }
    if (!form.company_id) {
      setError('Escolha a empresa da tarefa.')
      return
    }
    if (form.visibility !== 'private' && !canWrite(form.company_id)) {
      setError('Você só pode criar tarefas privadas nesta empresa.')
      return
    }
    if (form.visibility === 'shared' && !shareCompanies.length && !sharePeople.length) {
      setError('Escolha ao menos uma empresa ou pessoa para compartilhar.')
      return
    }

    const payload = {
      company_id: form.company_id,
      title: form.title.trim(),
      description: form.description.trim() || null,
      assignee_id: form.assignee_id || null,
      due_date: form.due_date || null,
      remind_at: form.remind_at ? new Date(form.remind_at).toISOString() : null,
      priority: form.priority,
      status: form.status,
      visibility: form.visibility,
      tags: form.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      ...(task ? {} : { created_by: profile?.id ?? null }),
      // Mudou o lembrete: a notificação precisa poder disparar de novo.
      ...(task && toLocalInput(task.remind_at) !== form.remind_at ? { reminder_sent_at: null } : {}),
    }

    setBusy(true)
    const result = task
      ? await supabase.from('tasks').update(payload).eq('id', task.id).select().single()
      : await supabase.from('tasks').insert(payload).select().single()

    if (result.error || !result.data) {
      setBusy(false)
      setError(result.error?.message ?? 'Não foi possível salvar a tarefa.')
      return
    }

    const taskId = result.data.id as string

    // Compartilhamentos: apaga os que saíram, grava os que entraram.
    const wanted = [
      ...shareCompanies.map((id) => ({ company_id: id, user_id: null })),
      ...sharePeople.map((id) => ({ company_id: null, user_id: id })),
    ]

    await supabase.from('task_shares').delete().eq('task_id', taskId)
    if (form.visibility === 'shared' && wanted.length) {
      const { error: shareError } = await supabase.from('task_shares').insert(
        wanted.map((target) => ({
          task_id: taskId,
          company_id: target.company_id,
          user_id: target.user_id,
          created_by: profile?.id ?? null,
        })),
      )
      if (shareError) {
        setBusy(false)
        setError(`Tarefa salva, mas o compartilhamento falhou: ${shareError.message}`)
        return
      }
    }

    setBusy(false)
    notify(task ? 'Tarefa atualizada.' : 'Tarefa criada.')
    await onSaved()
    onClose()
  }

  const shareablePeople = allPeople.filter((person) => person.id !== profile?.id)

  return (
    <Modal
      open={open}
      title={task ? 'Editar tarefa' : 'Nova tarefa'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="task-form" className="btn-primary" disabled={busy}>
            {busy && <Spinner />}
            {task ? 'Salvar' : 'Criar tarefa'}
          </button>
        </>
      }
    >
      <form id="task-form" onSubmit={submit} className="space-y-4">
        {!fixedCompanyId && (
          <Field label="Empresa">
            <select
              className="input"
              value={form.company_id}
              onChange={(event) =>
                setForm((c) => ({ ...c, company_id: event.target.value, assignee_id: '' }))
              }
            >
              {companyOptions.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="O que precisa ser feito">
          <input
            className="input"
            required
            autoFocus
            value={form.title}
            onChange={(event) => setForm((c) => ({ ...c, title: event.target.value }))}
          />
        </Field>

        <Field label="Detalhes">
          <textarea
            className="input min-h-20"
            value={form.description}
            onChange={(event) => setForm((c) => ({ ...c, description: event.target.value }))}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Quem faz">
            <select
              className="input"
              value={form.assignee_id}
              onChange={(event) => setForm((c) => ({ ...c, assignee_id: event.target.value }))}
            >
              <option value="">Sem responsável</option>
              {people.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.full_name}
                </option>
              ))}
            </select>
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

        <Field
          label="Lembrete"
          hint="O responsável recebe um aviso no sistema na data e hora escolhidas."
        >
          <input
            className="input"
            type="datetime-local"
            value={form.remind_at}
            onChange={(event) => setForm((c) => ({ ...c, remind_at: event.target.value }))}
          />
        </Field>

        {/* ------------------------------------------------- quem enxerga */}
        <Field asGroup label="Quem enxerga esta tarefa" hint={VISIBILITY_HINT[form.visibility]}>
          <div className="grid grid-cols-3 gap-2">
            {VISIBILITIES.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setForm((c) => ({ ...c, visibility: item }))}
                className={`rounded-lg border px-3 py-2 text-sm transition ${
                  form.visibility === item
                    ? 'border-brand-500 bg-brand-50 font-medium text-brand-700'
                    : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {VISIBILITY_LABEL[item]}
              </button>
            ))}
          </div>
        </Field>

        {form.visibility === 'shared' && (
          <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div>
              <p className="label">Empresas</p>
              <div className="flex flex-wrap gap-1.5">
                {companyOptions.map((company) => {
                  const on = shareCompanies.includes(company.id)
                  return (
                    <button
                      key={company.id}
                      type="button"
                      onClick={() => setShareCompanies((list) => toggle(list, company.id))}
                      className={`chip border ${
                        on
                          ? 'border-brand-500 bg-brand-100 text-brand-800'
                          : 'border-slate-300 bg-white text-slate-600'
                      }`}
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: company.color }}
                      />
                      {company.name}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <p className="label">Pessoas</p>
              {shareablePeople.length === 0 ? (
                <p className="text-xs text-slate-500">Nenhuma outra pessoa cadastrada ainda.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {shareablePeople.map((person) => {
                    const on = sharePeople.includes(person.id)
                    return (
                      <button
                        key={person.id}
                        type="button"
                        onClick={() => setSharePeople((list) => toggle(list, person.id))}
                        className={`chip border ${
                          on
                            ? 'border-accent-500 bg-accent-100 text-accent-700'
                            : 'border-slate-300 bg-white text-slate-600'
                        }`}
                      >
                        {person.full_name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Prioridade">
            <select
              className="input"
              value={form.priority}
              onChange={(event) =>
                setForm((c) => ({ ...c, priority: event.target.value as TaskPriority }))
              }
            >
              {PRIORITIES.map((item) => (
                <option key={item} value={item}>
                  {TASK_PRIORITY_LABEL[item]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Situação">
            <select
              className="input"
              value={form.status}
              onChange={(event) => setForm((c) => ({ ...c, status: event.target.value as TaskStatus }))}
            >
              {(Object.keys(TASK_STATUS_LABEL) as TaskStatus[]).map((item) => (
                <option key={item} value={item}>
                  {TASK_STATUS_LABEL[item]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Etiquetas" hint="Separe por vírgula.">
          <input
            className="input"
            value={form.tags}
            onChange={(event) => setForm((c) => ({ ...c, tags: event.target.value }))}
            placeholder="comercial, urgente"
          />
        </Field>

        {error && <ErrorText>{error}</ErrorText>}
      </form>
    </Modal>
  )
}
