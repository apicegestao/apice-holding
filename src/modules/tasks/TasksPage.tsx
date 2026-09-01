// Quadro de tarefas da empresa. Traz as tarefas dela e também as que outras
// empresas compartilharam com ela — sempre filtradas pela RLS.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bell, CalendarClock, Lock, Pencil, Plus, Share2, Trash2, User } from 'lucide-react'
import { supabase } from '../../core/lib/supabase'
import { initials, relativeDays } from '../../core/lib/format'
import { useAuth } from '../../core/auth/AuthProvider'
import { useCompany } from '../../core/company/CompanyProvider'
import {
  Badge,
  ConfirmDialog,
  EmptyState,
  Loading,
  PageHeader,
  useToast,
} from '../../core/ui'
import {
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  VISIBILITY_LABEL,
  type Profile,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from '../../core/types'
import TaskFormModal from './TaskFormModal'

const BOARD: TaskStatus[] = ['todo', 'doing', 'blocked', 'done']

function priorityTone(priority: TaskPriority) {
  if (priority === 'urgent') return 'red'
  if (priority === 'high') return 'amber'
  if (priority === 'low') return 'slate'
  return 'blue'
}

export default function TasksPage() {
  const { company, canWrite } = useCompany()
  const { profile } = useAuth()
  const { notify } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  const [tasks, setTasks] = useState<Task[]>([])
  const [people, setPeople] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Task | null>(null)
  const [creating, setCreating] = useState<TaskStatus | null>(null)
  const [removing, setRemoving] = useState<Task | null>(null)
  const [busy, setBusy] = useState(false)

  const onlyMine = searchParams.get('meu') === '1'
  const showDone = searchParams.get('concluidas') === '1'

  const load = useCallback(async () => {
    setLoading(true)
    const [taskResult, memberResult] = await Promise.all([
      supabase.rpc('tasks_for_company', { p_company: company.id }),
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
        if (onlyMine && task.assignee_id !== profile?.id && task.created_by !== profile?.id) {
          return false
        }
        if (!showDone && (task.status === 'done' || task.status === 'canceled')) return false
        return true
      }),
    [tasks, onlyMine, showDone, profile?.id],
  )

  const columns = useMemo(
    () => BOARD.map((status) => ({ status, items: visible.filter((t) => t.status === status) })),
    [visible],
  )

  const changeStatus = async (task: Task, status: TaskStatus) => {
    const { error } = await supabase.from('tasks').update({ status }).eq('id', task.id)
    if (error) {
      notify(error.message, 'error')
      return
    }
    await load()
  }

  const remove = async () => {
    if (!removing) return
    setBusy(true)
    const { error } = await supabase.from('tasks').delete().eq('id', removing.id)
    setBusy(false)
    if (error) {
      notify(error.message, 'error')
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
            <button type="button" className="btn-primary" onClick={() => setCreating('todo')}>
              <Plus className="h-4 w-4" /> Nova tarefa
            </button>
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
            <button type="button" className="btn-primary" onClick={() => setCreating('todo')}>
              <Plus className="h-4 w-4" /> Nova tarefa
            </button>
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
                <button
                  type="button"
                  className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  onClick={() => setCreating(status)}
                  aria-label={`Nova tarefa em ${TASK_STATUS_LABEL[status]}`}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              {items.length === 0 && (
                <p className="hidden rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400 md:block">
                  vazio
                </p>
              )}

              {items.map((task) => {
                const assignee = person(task.assignee_id)
                const late =
                  task.due_date &&
                  task.due_date < new Date().toISOString().slice(0, 10) &&
                  task.status !== 'done'
                const mine = task.created_by === profile?.id
                const editable = mine || task.assignee_id === profile?.id || canWrite
                const fromAnotherCompany = task.company_id !== company.id

                return (
                  <article key={task.id} className="card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-ink-900">{task.title}</p>
                      {editable && (
                        <div className="flex shrink-0 gap-0.5">
                          <button
                            type="button"
                            className="rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600"
                            onClick={() => setEditing(task)}
                            aria-label="Editar"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {(mine || canWrite) && (
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
                      {task.visibility === 'private' && (
                        <Badge tone="slate">
                          <Lock className="h-3 w-3" /> {VISIBILITY_LABEL.private}
                        </Badge>
                      )}
                      {task.visibility === 'shared' && (
                        <Badge tone="violet">
                          <Share2 className="h-3 w-3" /> {VISIBILITY_LABEL.shared}
                        </Badge>
                      )}
                      {fromAnotherCompany && <Badge tone="blue">de outra empresa</Badge>}
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

      <TaskFormModal
        open={creating !== null || Boolean(editing)}
        task={editing}
        fixedCompanyId={editing ? undefined : company.id}
        defaultStatus={creating ?? 'todo'}
        onClose={() => {
          setCreating(null)
          setEditing(null)
        }}
        onSaved={load}
      />

      <ConfirmDialog
        open={Boolean(removing)}
        title="Excluir tarefa"
        danger
        busy={busy}
        confirmLabel="Excluir"
        message={
          <>
            Excluir <strong>{removing?.title}</strong>?
          </>
        }
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </div>
  )
}
