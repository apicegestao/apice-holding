// Formulário de tarefa, usado tanto dentro da empresa quanto no painel da
// holding. Concentra quem faz, prazo, lembrete e — o ponto delicado —
// quem enxerga a tarefa. Editando uma tarefa já salva, ganha também
// subtarefas (checklist) e notas — o histórico de acompanhamento dela.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../core/lib/supabase'
import { useAuth } from '../../core/auth/AuthProvider'
import { formatDateTime, initials } from '../../core/lib/format'
import { ConfirmDialog, ErrorText, Field, Modal, Spinner, useConfirmDelete, useToast } from '../../core/ui'
import {
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  VISIBILITY_HINT,
  VISIBILITY_LABEL,
  type Product,
  type Profile,
  type Task,
  type TaskChecklistItem,
  type TaskComment,
  type TaskPriority,
  type TaskStatus,
  type TaskVisibility,
} from '../../core/types'

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent']
const VISIBILITIES: TaskVisibility[] = ['private', 'company', 'shared']
// 1 a 15 dias antes do prazo — o menu suspenso do lembrete antecipado.
const REMIND_DAYS_OPTIONS = Array.from({ length: 15 }, (_, i) => i + 1)

type FormState = {
  company_id: string
  title: string
  description: string
  assignee_id: string
  product_id: string
  due_date: string
  remind_days_before: string
  remind_time: string
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
  product_id: '',
  due_date: '',
  remind_days_before: '1',
  remind_time: '09:00',
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
  const [products, setProducts] = useState<Product[]>([])
  const [shareCompanies, setShareCompanies] = useState<string[]>([])
  const [sharePeople, setSharePeople] = useState<string[]>([])
  const [allPeople, setAllPeople] = useState<Profile[]>([])
  const [checklist, setChecklist] = useState<TaskChecklistItem[]>([])
  const [newChecklistTitle, setNewChecklistTitle] = useState('')
  const [editingChecklistId, setEditingChecklistId] = useState<string | null>(null)
  const [comments, setComments] = useState<TaskComment[]>([])
  const [commentAuthors, setCommentAuthors] = useState<Record<string, Profile>>({})
  // `loadFollowUp` abaixo é intencionalmente estável (deps vazias, reusado
  // por vários callers sem re-disparar efeitos) — mas por isso não pode ler
  // `commentAuthors` direto (ficaria sempre no valor de quando montou). O
  // ref mantém a leitura sempre atual sem precisar recriar o callback.
  const commentAuthorsRef = useRef(commentAuthors)
  useEffect(() => {
    commentAuthorsRef.current = commentAuthors
  }, [commentAuthors])
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editingCommentBody, setEditingCommentBody] = useState('')
  const [newComment, setNewComment] = useState('')
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
        product_id: task.product_id ?? '',
        due_date: task.due_date ?? '',
        remind_days_before: task.remind_days_before?.toString() ?? '',
        remind_time: task.remind_time?.slice(0, 5) || '09:00',
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

  // Subtarefas e notas só existem numa tarefa já salva — nascem junto com o
  // primeiro carregamento da edição.
  const loadFollowUp = useCallback(async (taskId: string) => {
    const [{ data: items }, { data: notes }] = await Promise.all([
      supabase
        .from('task_checklist_items')
        .select('*')
        .eq('task_id', taskId)
        .order('position', { ascending: true }),
      supabase.from('task_comments').select('*').eq('task_id', taskId).order('created_at', { ascending: true }),
    ])
    setChecklist((items as TaskChecklistItem[]) ?? [])
    setComments((notes as TaskComment[]) ?? [])

    const authorIds = [...new Set((notes ?? []).map((n) => n.author_id).filter((id): id is string => Boolean(id)))]
    const missing = authorIds.filter((id) => !commentAuthorsRef.current[id])
    if (missing.length) {
      const { data: profiles } = await supabase.from('profiles').select('*').in('id', missing)
      setCommentAuthors((current) => {
        const next = { ...current }
        for (const p of (profiles as Profile[]) ?? []) next[p.id] = p
        return next
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!open || !task) {
      setChecklist([])
      setComments([])
      setNewChecklistTitle('')
      setNewComment('')
      return
    }
    void loadFollowUp(task.id)
  }, [open, task, loadFollowUp])

  const addChecklistItem = async () => {
    const title = newChecklistTitle.trim()
    if (!title || !task) return
    const { error: insertError } = await supabase.from('task_checklist_items').insert({
      task_id: task.id,
      company_id: task.company_id,
      title,
      position: checklist.length,
      created_by: profile?.id ?? null,
    })
    if (insertError) {
      notify(insertError.message, 'error')
      return
    }
    setNewChecklistTitle('')
    await loadFollowUp(task.id)
  }

  const toggleChecklistItem = async (item: TaskChecklistItem) => {
    setChecklist((current) => current.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)))
    const { error: updateError } = await supabase
      .from('task_checklist_items')
      .update({ done: !item.done })
      .eq('id', item.id)
    if (updateError) notify(updateError.message, 'error')
  }

  const renameChecklistItem = async (id: string, title: string) => {
    const trimmed = title.trim()
    setEditingChecklistId(null)
    if (!trimmed) return
    setChecklist((current) => current.map((i) => (i.id === id ? { ...i, title: trimmed } : i)))
    const { error: updateError } = await supabase
      .from('task_checklist_items')
      .update({ title: trimmed })
      .eq('id', id)
    if (updateError) notify(updateError.message, 'error')
  }

  const checklistDelete = useConfirmDelete<TaskChecklistItem>(async (item) => {
    const { error: deleteError } = await supabase.from('task_checklist_items').delete().eq('id', item.id)
    if (deleteError) {
      notify(deleteError.message, 'error')
      return
    }
    if (task) await loadFollowUp(task.id)
  })

  const addComment = async () => {
    const body = newComment.trim()
    if (!body || !task) return
    const { error: insertError } = await supabase.from('task_comments').insert({
      task_id: task.id,
      company_id: task.company_id,
      author_id: profile?.id ?? null,
      body,
    })
    if (insertError) {
      notify(insertError.message, 'error')
      return
    }
    setNewComment('')
    await loadFollowUp(task.id)
  }

  const commentDelete = useConfirmDelete<TaskComment>(async (comment) => {
    const { error: deleteError } = await supabase.from('task_comments').delete().eq('id', comment.id)
    if (deleteError) {
      notify(deleteError.message, 'error')
      return
    }
    if (task) await loadFollowUp(task.id)
  })

  const startEditingComment = (comment: TaskComment) => {
    setEditingCommentId(comment.id)
    setEditingCommentBody(comment.body)
  }

  const saveComment = async (id: string) => {
    const body = editingCommentBody.trim()
    setEditingCommentId(null)
    if (!body) return
    setComments((current) => current.map((c) => (c.id === id ? { ...c, body } : c)))
    const { error: updateError } = await supabase.from('task_comments').update({ body }).eq('id', id)
    if (updateError) notify(updateError.message, 'error')
  }

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

  // Produtos possíveis: as frentes cadastradas na empresa escolhida —
  // "vincular a tarefa a um produto" só faz sentido depois de escolher a
  // empresa, exatamente como o responsável.
  const loadProducts = useCallback(async (companyId: string) => {
    if (!companyId) {
      setProducts([])
      return
    }
    const { data } = await supabase
      .from('products')
      .select('*')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('display_order')
    setProducts((data as Product[]) ?? [])
  }, [])

  useEffect(() => {
    if (open) void loadProducts(form.company_id)
  }, [open, form.company_id, loadProducts])

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
      product_id: form.product_id || null,
      due_date: form.due_date || null,
      // remind_at é recalculado pelo próprio banco (trigger app.sync_task_reminder)
      // a partir de due_date + remind_days_before + remind_time — nada aqui.
      remind_days_before: form.due_date && form.remind_days_before ? Number(form.remind_days_before) : null,
      remind_time: form.remind_time || '09:00',
      priority: form.priority,
      status: form.status,
      visibility: form.visibility,
      // Dedupe — "urgente, Urgente" viraria duas badges idênticas na lista
      // (e key duplicada no React) sem isso.
      tags: [...new Set(form.tags.split(',').map((tag) => tag.trim()).filter(Boolean))],
      ...(task ? {} : { created_by: profile?.id ?? null }),
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
    <>
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
                setForm((c) => ({ ...c, company_id: event.target.value, assignee_id: '', product_id: '' }))
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

        {products.length > 0 && (
          <Field label="Produto" hint="Opcional — deixe em branco se for uma tarefa geral da empresa.">
            <select
              className="input"
              value={form.product_id}
              onChange={(event) => setForm((c) => ({ ...c, product_id: event.target.value }))}
            >
              <option value="">Nenhum — tarefa da empresa toda</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        {/* Lembretes padrão: o responsável já é avisado quando a tarefa é
            atribuída. Com prazo definido, entram mais dois avisos automáticos
            — não precisa digitar data por extenso, só escolher quanto antes. */}
        {form.due_date ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Lembrar quantos dias antes"
              hint="O dia do prazo sempre avisa também, além deste."
            >
              <select
                className="input"
                value={form.remind_days_before}
                onChange={(event) => setForm((c) => ({ ...c, remind_days_before: event.target.value }))}
              >
                <option value="">Sem lembrete antecipado</option>
                {REMIND_DAYS_OPTIONS.map((days) => (
                  <option key={days} value={days}>
                    {days} {days === 1 ? 'dia antes' : 'dias antes'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Horário do lembrete">
              <input
                className="input"
                type="time"
                value={form.remind_time}
                onChange={(event) => setForm((c) => ({ ...c, remind_time: event.target.value }))}
              />
            </Field>
          </div>
        ) : (
          <p className="text-xs text-content-soft">
            Defina um prazo para ligar os lembretes automáticos (N dias antes e no próprio dia).
          </p>
        )}

        {/* ------------------------------------------------- quem enxerga */}
        <Field asGroup label="Quem enxerga esta tarefa" hint={VISIBILITY_HINT[form.visibility]}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {VISIBILITIES.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setForm((c) => ({ ...c, visibility: item }))}
                className={`rounded-lg border px-3 py-2 text-sm transition ${
                  form.visibility === item
                    ? 'border-brand-500 bg-brand/10 font-medium text-brand-text'
                    : 'border-line-strong text-content-muted hover:bg-hover'
                }`}
              >
                {VISIBILITY_LABEL[item]}
              </button>
            ))}
          </div>
        </Field>

        {form.visibility === 'shared' && (
          <div className="space-y-3 rounded-lg border border-line bg-hover p-3">
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
                          ? 'border-brand-500 bg-brand/15 text-brand-text'
                          : 'border-line-strong bg-surface text-content-muted'
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
                <p className="text-xs text-content-soft">Nenhuma outra pessoa cadastrada ainda.</p>
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
                            ? 'border-accent-500 bg-accent-500/15 text-accent-600 dark:text-accent-300'
                            : 'border-line-strong bg-surface text-content-muted'
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

        {/* Subtarefas e notas só fazem sentido numa tarefa que já existe —
            a nova nasce sem elas e ganha depois de salva a primeira vez. */}
        {task && (
          <>
            <div className="border-t border-line pt-4">
              <p className="label">
                Subtarefas
                {checklist.length > 0 && (
                  <span className="ml-1.5 font-normal text-content-faint">
                    {checklist.filter((item) => item.done).length}/{checklist.length}
                  </span>
                )}
              </p>
              {checklist.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {checklist.map((item) => (
                    <li key={item.id} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1 shrink-0"
                        checked={item.done}
                        onChange={() => void toggleChecklistItem(item)}
                      />
                      {editingChecklistId === item.id ? (
                        <input
                          className="input flex-1 py-1"
                          autoFocus
                          defaultValue={item.title}
                          onBlur={(event) => void renameChecklistItem(item.id, event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
                            if (event.key === 'Escape') setEditingChecklistId(null)
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className={`min-w-0 flex-1 break-words py-0.5 text-left text-sm ${item.done ? 'text-content-faint line-through' : 'text-content'}`}
                          onClick={() => setEditingChecklistId(item.id)}
                          title="Editar subtarefa"
                        >
                          {item.title}
                        </button>
                      )}
                      <button
                        type="button"
                        className="mt-0.5 shrink-0 rounded p-1 text-content-faint hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400"
                        onClick={() => checklistDelete.ask(item)}
                        aria-label="Remover subtarefa"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex gap-2">
                <input
                  className="input"
                  placeholder="Adicionar subtarefa…"
                  aria-label="Adicionar subtarefa"
                  value={newChecklistTitle}
                  onChange={(event) => setNewChecklistTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void addChecklistItem()
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn-ghost shrink-0"
                  disabled={!newChecklistTitle.trim()}
                  onClick={() => void addChecklistItem()}
                  aria-label="Adicionar subtarefa"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="border-t border-line pt-4">
              <p className="label">Notas</p>
              {comments.length > 0 && (
                <ul className="mt-2 space-y-3">
                  {comments.map((comment) => {
                    const author = comment.author_id ? commentAuthors[comment.author_id] : undefined
                    const mine = comment.author_id === profile?.id
                    const editing = editingCommentId === comment.id
                    return (
                      <li key={comment.id} className="flex items-start gap-2">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-hover text-xs font-semibold text-content-muted">
                          {initials(author?.full_name || author?.email || '?')}
                        </span>
                        <div className="min-w-0 flex-1">
                          {editing ? (
                            <textarea
                              className="input min-h-16"
                              autoFocus
                              value={editingCommentBody}
                              onChange={(event) => setEditingCommentBody(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Escape') setEditingCommentId(null)
                              }}
                            />
                          ) : (
                            <p className="whitespace-pre-wrap text-sm text-content">{comment.body}</p>
                          )}
                          <p className="mt-0.5 text-xs text-content-faint">
                            {author?.full_name ?? 'Alguém'} · {formatDateTime(comment.created_at)}
                            {editing && (
                              <>
                                {' · '}
                                <button
                                  type="button"
                                  className="text-brand-text hover:underline"
                                  onClick={() => void saveComment(comment.id)}
                                >
                                  salvar
                                </button>
                              </>
                            )}
                          </p>
                        </div>
                        {mine && !editing && (
                          <div className="flex shrink-0 gap-0.5">
                            <button
                              type="button"
                              className="rounded p-1 text-content-faint hover:bg-hover hover:text-content"
                              onClick={() => startEditingComment(comment)}
                              aria-label="Editar nota"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className="rounded p-1 text-content-faint hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400"
                              onClick={() => commentDelete.ask(comment)}
                              aria-label="Remover nota"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
              <div className="mt-2 flex gap-2">
                <textarea
                  className="input min-h-16"
                  placeholder="Escreva uma nota sobre o andamento…"
                  aria-label="Adicionar nota"
                  value={newComment}
                  onChange={(event) => setNewComment(event.target.value)}
                />
                <button
                  type="button"
                  className="btn-ghost shrink-0 self-end"
                  disabled={!newComment.trim()}
                  onClick={() => void addComment()}
                  aria-label="Adicionar nota"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}

        {error && <ErrorText>{error}</ErrorText>}
      </form>
    </Modal>

    <ConfirmDialog
      open={checklistDelete.target !== null}
      title="Excluir subtarefa?"
      message={`Isso remove "${checklistDelete.target?.title}" da lista. Não dá pra desfazer.`}
      confirmLabel="Excluir"
      danger
      busy={checklistDelete.busy}
      onConfirm={() => void checklistDelete.confirm()}
      onCancel={checklistDelete.cancel}
    />
    <ConfirmDialog
      open={commentDelete.target !== null}
      title="Excluir nota?"
      message="Essa nota some do histórico da tarefa. Não dá pra desfazer."
      confirmLabel="Excluir"
      danger
      busy={commentDelete.busy}
      onConfirm={() => void commentDelete.confirm()}
      onCancel={commentDelete.cancel}
    />
    </>
  )
}
