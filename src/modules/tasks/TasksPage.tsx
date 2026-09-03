// Quadro de tarefas da empresa. Traz as tarefas dela e também as que outras
// empresas compartilharam com ela — sempre filtradas pela RLS.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Bell,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ListChecks,
  Lock,
  Pencil,
  Plus,
  Share2,
  Trash2,
  User,
} from 'lucide-react'
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
  type TaskChecklistItem,
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
  const [checklists, setChecklists] = useState<TaskChecklistItem[]>([])
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
    const taskIds = (taskResult.data ?? []).map((row: Task) => row.id)
    const [{ data: profileRows }, { data: checklistRows }] = await Promise.all([
      ids.length
        ? supabase.from('profiles').select('*').in('id', ids)
        : Promise.resolve({ data: [] as Profile[] }),
      taskIds.length
        ? supabase.from('task_checklist_items').select('*').in('task_id', taskIds)
        : Promise.resolve({ data: [] as TaskChecklistItem[] }),
    ])

    setTasks((taskResult.data as Task[]) ?? [])
    setPeople((profileRows as Profile[]) ?? [])
    setChecklists((checklistRows as TaskChecklistItem[]) ?? [])
    setLoading(false)
  }, [company.id])

  const checklistProgress = useCallback(
    (taskId: string) => {
      const items = checklists.filter((item) => item.task_id === taskId)
      if (!items.length) return null
      return { done: items.filter((item) => item.done).length, total: items.length }
    },
    [checklists],
  )

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

  // Um toque pra mudar de coluna, sem abrir o select — o mesmo destino do
  // select, só que mais rápido pro caso comum de avançar/voltar uma coluna.
  const moveInBoard = (task: Task, delta: 1 | -1) => {
    const next = BOARD[BOARD.indexOf(task.status) + delta]
    if (next) void changeStatus(task, next)
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
            <label className="flex items-center gap-1.5 text-sm text-content-muted">
              <input
                type="checkbox"
                checked={onlyMine}
                onChange={(event) => toggleParam('meu', event.target.checked)}
              />
              Só as minhas
            </label>
            <label className="flex items-center gap-1.5 text-sm text-content-muted">
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {columns.map(({ status, items }) => (
            <div key={status} className="flex flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-sm font-semibold text-content">
                  {TASK_STATUS_LABEL[status]}
                  <span className="ml-1.5 text-xs font-normal text-content-faint">{items.length}</span>
                </h2>
                <button
                  type="button"
                  className="rounded-md p-1 text-content-faint hover:bg-hover hover:text-content"
                  onClick={() => setCreating(status)}
                  aria-label={`Nova tarefa em ${TASK_STATUS_LABEL[status]}`}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              {items.length === 0 && (
                <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-content-faint">
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
                const checklist = checklistProgress(task.id)

                return (
                  <article key={task.id} className="card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-content">{task.title}</p>
                      {editable && (
                        <div className="flex shrink-0 gap-0.5">
                          <button
                            type="button"
                            className="rounded p-1 text-content-faint hover:bg-hover hover:text-content-muted"
                            onClick={() => setEditing(task)}
                            aria-label={`Editar tarefa "${task.title}"`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {(mine || canWrite) && (
                            <button
                              type="button"
                              className="rounded p-1 text-content-faint hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400"
                              onClick={() => setRemoving(task)}
                              aria-label={`Excluir tarefa "${task.title}"`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {task.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-content-soft">{task.description}</p>
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
                      {checklist && (
                        <Badge tone={checklist.done === checklist.total ? 'green' : 'slate'}>
                          <ListChecks className="h-3 w-3" /> {checklist.done}/{checklist.total}
                        </Badge>
                      )}
                      {task.tags.map((tag, i) => (
                        <Badge key={`${tag}-${i}`}>{tag}</Badge>
                      ))}
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span
                        className="flex items-center gap-1.5 text-xs text-content-soft"
                        title={assignee?.email}
                      >
                        {assignee ? (
                          <>
                            <span className="grid h-5 w-5 place-items-center rounded-full bg-hover text-[9px] font-semibold text-content-muted">
                              {initials(assignee.full_name || assignee.email)}
                            </span>
                            <span className="max-w-32 truncate" title={assignee.full_name}>
                              {assignee.full_name}
                            </span>
                          </>
                        ) : (
                          <>
                            <User className="h-3.5 w-3.5" /> sem responsável
                          </>
                        )}
                      </span>

                      {editable && (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            className="rounded p-1 text-content-faint enabled:hover:bg-hover enabled:hover:text-content disabled:opacity-30"
                            disabled={BOARD.indexOf(task.status) <= 0}
                            onClick={() => moveInBoard(task, -1)}
                            aria-label={`Voltar "${task.title}" de coluna`}
                            title="Voltar coluna"
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            className="rounded p-1 text-content-faint enabled:hover:bg-hover enabled:hover:text-content disabled:opacity-30"
                            disabled={BOARD.indexOf(task.status) === -1 || BOARD.indexOf(task.status) >= BOARD.length - 1}
                            onClick={() => moveInBoard(task, 1)}
                            aria-label={`Avançar "${task.title}" de coluna`}
                            title="Avançar coluna"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                          <select
                            className="rounded border border-line bg-surface px-1.5 py-1 text-base sm:text-xs"
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
                        </div>
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
