// Tarefas: quem, o quê, prazo e lembrete. O lembrete vira notificação
// automática (job no banco a cada 5 minutos).
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bell, CalendarClock, Pencil, Plus, Trash2, User } from 'lucide-react'
import { supabase } from '../../core/lib/supabase'
import { formatDate, formatDateTime, initials, relativeDays } from '../../core/lib/format'
import { useAuth } from '../../core/auth/AuthProvider'
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
  useToast,
} from '../../core/ui'
import {
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  type Profile,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from '../../core/types'

const BOARD: TaskStatus[] = ['todo', 'doing', 'blocked', 'done']
const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent']

function priorityTone(priority: TaskPriority) {
  if (priority === 'urgent') return 'red'
  if (priority === 'high') return 'amber'
  if (priority === 'low') return 'slate'
  return 'blue'
}

/** datetime-local trabalha em horário local; o banco guarda timestamptz. */
function toLocalInput(iso: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const emptyTask = {
  title: '',
  description: '',
  assignee_id: '',
  due_date: '',
  remind_at: '',
  priority: 'medium' as TaskPriority,
  status: 'todo' as TaskStatus,
  tags: '',
}

export default function TasksPage() {
  const { company, canWrite } = useCompany()
  const { profile } = useAuth()
  const { notify } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  const [tasks, setTasks] = useState<Task[]>([])
  const [people, setPeople] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(emptyTask)
  const [editing, setEditing] = useState<Task | null>(null)
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState<Task | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const onlyMine = searchParams.get('meu') === '1'
  const showDone = searchParams.get('concluidas') === '1'

  const load = useCallback(async () => {
    setLoading(true)
    const [taskResult, memberResult] = await Promise.all([
      supabase
        .from('tasks')
        .select('*')
        .eq('company_id', company.id)
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false }),
      supabase.from('company_members').select('user_id').eq('company_id', company.id),
    ])

    const ids = (memberResult.data ?? []).map((row) => row.user_id)
    const { data: profileRows } = ids.length
      ? await supabase.from('profiles').select('*').in('id', ids)
      : { data: [] as Profile[] }

    setTasks((taskResult.data as Task[]) ?? [])
    setPeople((profileRows as Profile[]) ?? [])
    setLoading(false)
  }, [company.id])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(
    () =>
      tasks.filter((task) => {
        if (onlyMine && task.assignee_id !== profile?.id) return false
        if (!showDone && (task.status === 'done' || task.status === 'canceled')) return false
        return true
      }),
    [tasks, onlyMine, showDone, profile?.id],
  )

  const columns = useMemo(
    () =>
      BOARD.map((status) => ({
        status,
        items: visible.filter((task) => task.status === status),
      })),
    [visible],
  )

  const openCreate = (status: TaskStatus = 'todo') => {
    setForm({ ...emptyTask, status })
    setError('')
    setCreating(true)
  }

  const openEdit = (task: Task) => {
    setForm({
      title: task.title,
      description: task.description ?? '',
      assignee_id: task.assignee_id ?? '',
      due_date: task.due_date ?? '',
      remind_at: toLocalInput(task.remind_at),
      priority: task.priority,
      status: task.status,
      tags: task.tags.join(', '),
    })
    setError('')
    setEditing(task)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')

    if (!form.title.trim()) {
      setError('Diga o que precisa ser feito.')
      return
    }

    const payload = {
      company_id: company.id,
      title: form.title.trim(),
      description: form.description.trim() || null,
      assignee_id: form.assignee_id || null,
      due_date: form.due_date || null,
      remind_at: form.remind_at ? new Date(form.remind_at).toISOString() : null,
      priority: form.priority,
      status: form.status,
      tags: form.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      ...(editing ? {} : { created_by: profile?.id ?? null }),
      // Mudou o lembrete: a notificação precisa poder disparar de novo.
      ...(editing && toLocalInput(editing.remind_at) !== form.remind_at
        ? { reminder_sent_at: null }
        : {}),
    }

    setBusy(true)
    const result = editing
      ? await supabase.from('tasks').update(payload).eq('id', editing.id)
      : await supabase.from('tasks').insert(payload)
    setBusy(false)

    if (result.error) {
      setError(result.error.message)
      return
    }

    notify(editing ? 'Tarefa atualizada.' : 'Tarefa criada.')
    setCreating(false)
    setEditing(null)
    await load()
  }

  const changeStatus = async (task: Task, status: TaskStatus) => {
    const { error: updateError } = await supabase.from('tasks').update({ status }).eq('id', task.id)
    if (updateError) {
      notify(updateError.message, 'error')
      return
    }
    await load()
  }

  const remove = async () => {
    if (!removing) return
    setBusy(true)
    const { error: deleteError } = await supabase.from('tasks').delete().eq('id', removing.id)
    setBusy(false)
    if (deleteError) {
      notify(deleteError.message, 'error')
      return
    }
    notify('Tarefa excluída.')
    setRemoving(null)
    await load()
  }

  const person = (id: string | null) => people.find((item) => item.id === id)

  const toggleParam = (key: string, active: boolean) => {
    const next = new URLSearchParams(searchParams)
    if (active) next.set(key, '1')
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={`Tarefas · ${company.name}`}
        subtitle="Quem faz, o quê e até quando — com lembrete automático."
        actions={
          <>
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={onlyMine}
                onChange={(event) => toggleParam('meu', event.target.checked)}
              />
              Só as minhas
            </label>
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={showDone}
                onChange={(event) => toggleParam('concluidas', event.target.checked)}
              />
              Mostrar concluídas
            </label>
            {canWrite && (
              <button type="button" className="btn-primary" onClick={() => openCreate()}>
                <Plus className="h-4 w-4" /> Nova tarefa
              </button>
            )}
          </>
        }
      />

      {loading ? (
        <Loading />
      ) : tasks.length === 0 ? (
        <EmptyState
          title="Nenhuma tarefa por aqui"
          description="Tire da cabeça e coloque no sistema: o que precisa ser feito, por quem e até quando."
          action={
            canWrite && (
              <button type="button" className="btn-primary" onClick={() => openCreate()}>
                <Plus className="h-4 w-4" /> Nova tarefa
              </button>
            )
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {columns.map(({ status, items }) => (
            <div key={status} className="flex flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-sm font-semibold text-ink-900">
                  {TASK_STATUS_LABEL[status]}
                  <span className="ml-1.5 text-xs font-normal text-slate-400">{items.length}</span>
                </h2>
                {canWrite && (
                  <button
                    type="button"
                    className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    onClick={() => openCreate(status)}
                    aria-label={`Nova tarefa em ${TASK_STATUS_LABEL[status]}`}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                )}
              </div>

              {items.length === 0 && (
                <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
                  vazio
                </p>
              )}

              {items.map((task) => {
                const assignee = person(task.assignee_id)
                const late =
                  task.due_date &&
                  task.due_date < new Date().toISOString().slice(0, 10) &&
                  task.status !== 'done'
                const mine = task.assignee_id === profile?.id
                const editable = canWrite || mine

                return (
                  <article key={task.id} className="card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-ink-900">{task.title}</p>
                      {editable && (
                        <div className="flex shrink-0 gap-0.5">
                          <button
                            type="button"
                            className="rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600"
                            onClick={() => openEdit(task)}
                            aria-label="Editar"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {canWrite && (
                            <button
                              type="button"
                              className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600"
                              onClick={() => setRemoving(task)}
                              aria-label="Excluir"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {task.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-slate-500">{task.description}</p>
                    )}

                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <Badge tone={priorityTone(task.priority)}>
                        {TASK_PRIORITY_LABEL[task.priority]}
                      </Badge>
                      {task.due_date && (
                        <Badge tone={late ? 'red' : 'slate'}>
                          <CalendarClock className="h-3 w-3" /> {relativeDays(task.due_date)}
                        </Badge>
                      )}
                      {task.remind_at && !task.reminder_sent_at && (
                        <Badge tone="blue">
                          <Bell className="h-3 w-3" /> lembrete
                        </Badge>
                      )}
                      {task.tags.map((tag) => (
                        <Badge key={tag}>{tag}</Badge>
                      ))}
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span
                        className="flex items-center gap-1.5 text-xs text-slate-500"
                        title={assignee?.email}
                      >
                        {assignee ? (
                          <>
                            <span className="grid h-5 w-5 place-items-center rounded-full bg-slate-200 text-[9px] font-semibold text-slate-600">
                              {initials(assignee.full_name || assignee.email)}
                            </span>
                            <span className="max-w-24 truncate">{assignee.full_name}</span>
                          </>
                        ) : (
                          <>
                            <User className="h-3.5 w-3.5" /> sem responsável
                          </>
                        )}
                      </span>

                      {editable && (
                        <select
                          className="rounded border border-slate-200 bg-white px-1.5 py-1 text-xs"
                          value={task.status}
                          onChange={(event) =>
                            void changeStatus(task, event.target.value as TaskStatus)
                          }
                        >
                          {(Object.keys(TASK_STATUS_LABEL) as TaskStatus[]).map((item) => (
                            <option key={item} value={item}>
                              {TASK_STATUS_LABEL[item]}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={creating || Boolean(editing)}
        title={editing ? 'Editar tarefa' : 'Nova tarefa'}
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
            <button type="submit" form="task-form" className="btn-primary" disabled={busy}>
              {busy && <Spinner />}
              {editing ? 'Salvar' : 'Criar tarefa'}
            </button>
          </>
        }
      >
        <form id="task-form" onSubmit={submit} className="space-y-4">
          <Field label="O que precisa ser feito">
            <input
              className="input"
              required
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

          {editing?.reminder_sent_at && (
            <p className="text-xs text-slate-500">
              Lembrete já enviado em {formatDateTime(editing.reminder_sent_at)}. Mudar a data
              reprograma o aviso.
            </p>
          )}
          {editing && (
            <p className="text-xs text-slate-400">Criada em {formatDate(editing.created_at)}</p>
          )}
          {error && <ErrorText>{error}</ErrorText>}
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(removing)}
        title="Excluir tarefa"
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
