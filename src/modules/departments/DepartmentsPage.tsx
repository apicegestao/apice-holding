// Áreas: as frentes internas da empresa (Comercial, Financeiro,
// Administrativo...) — Fase 2 do plano de virar um sistema de gestão
// completo por empresa. Cada empresa define as próprias áreas (não é uma
// lista fixa pro grupo inteiro), e indicador/tarefa/orçamento podem
// (opcionalmente) apontar pra uma delas.
//
// Cadastro simples de propósito — sem "turma" por baixo (área não tem
// subdivisão, diferente de Produto → Edição). O que junta indicador/
// tarefa/orçamento de uma área numa tela só é o painel dela
// (DepartmentDashboard.tsx), aberto por "Ver painel" em cada linha.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, LayoutDashboard, Pencil, Plus, Target, Trash2, Wallet } from 'lucide-react'
import { supabase } from '../../core/lib/supabase'
import { KPI_CATEGORIES } from '../../core/catalog'
import { useCompany } from '../../core/company/CompanyProvider'
import {
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
import type { Department } from '../../core/types'

type DepartmentForm = { name: string; color: string }
const blankForm: DepartmentForm = { name: '', color: '' }

// Contagem enxuta só do que esta tela precisa mostrar por área — nada de
// trazer o indicador/tarefa/orçamento inteiro à toa.
type ScopeCounts = { kpis: number; tasks: number; budgets: number }

export default function DepartmentsPage() {
  const { company, canWrite } = useCompany()
  const { notify } = useToast()

  const [departments, setDepartments] = useState<Department[]>([])
  const [kpiCounts, setKpiCounts] = useState<{ department_id: string | null }[]>([])
  const [taskCounts, setTaskCounts] = useState<{ department_id: string | null }[]>([])
  const [budgetCounts, setBudgetCounts] = useState<{ department_id: string | null }[]>([])
  const [loading, setLoading] = useState(true)

  const [modal, setModal] = useState<{ editing: Department | null } | null>(null)
  const [form, setForm] = useState<DepartmentForm>(blankForm)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: departmentRows }, { data: kpiRows }, { data: taskRows }, { data: budgetRows }] =
      await Promise.all([
        supabase.from('departments').select('*').eq('company_id', company.id).order('display_order'),
        supabase.from('kpis').select('department_id').eq('company_id', company.id).eq('is_active', true).is('archived_at', null),
        supabase.from('tasks').select('department_id').eq('company_id', company.id),
        supabase.from('budgets').select('department_id').eq('company_id', company.id),
      ])
    setDepartments((departmentRows as Department[]) ?? [])
    setKpiCounts(kpiRows ?? [])
    setTaskCounts(taskRows ?? [])
    setBudgetCounts(budgetRows ?? [])
    setLoading(false)
  }, [company.id])

  useEffect(() => {
    void load()
  }, [load])

  const countsByDepartment = useMemo(() => {
    const map = new Map<string, ScopeCounts>()
    const bump = (id: string | null, key: keyof ScopeCounts) => {
      if (!id) return
      const entry = map.get(id) ?? { kpis: 0, tasks: 0, budgets: 0 }
      entry[key] += 1
      map.set(id, entry)
    }
    for (const row of kpiCounts) bump(row.department_id, 'kpis')
    for (const row of taskCounts) bump(row.department_id, 'tasks')
    for (const row of budgetCounts) bump(row.department_id, 'budgets')
    return map
  }, [kpiCounts, taskCounts, budgetCounts])

  // Sugestões prontas (mesmo catálogo usado como sugestão de categoria de
  // indicador) menos as áreas já cadastradas — pra não sugerir duplicata.
  const existingNames = useMemo(() => new Set(departments.map((d) => d.name)), [departments])
  const suggestions = useMemo(
    () => KPI_CATEGORIES.filter((name) => !existingNames.has(name)),
    [existingNames],
  )

  const openCreate = (suggestedName?: string) => {
    setForm({ name: suggestedName ?? '', color: '' })
    setError('')
    setModal({ editing: null })
  }
  const openEdit = (department: Department) => {
    setForm({ name: department.name, color: department.color ?? '' })
    setError('')
    setModal({ editing: department })
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!form.name.trim()) {
      setError('Dê um nome à área.')
      return
    }
    setError('')
    setBusy(true)
    const editing = modal?.editing ?? null
    const result = editing
      ? await supabase.from('departments').update({ name: form.name.trim() }).eq('id', editing.id)
      : await supabase.from('departments').insert({
          company_id: company.id,
          name: form.name.trim(),
          color: COMPANY_PALETTE[departments.length % COMPANY_PALETTE.length],
          display_order: departments.length,
        })
    setBusy(false)
    if (result.error) {
      setError(
        result.error.code === '23505' ? 'Já existe uma área com esse nome nesta empresa.' : result.error.message,
      )
      return
    }
    notify(editing ? 'Área atualizada.' : 'Área criada.')
    setModal(null)
    await load()
  }

  const departmentDelete = useConfirmDelete<Department>(async (department) => {
    const { error: deleteError } = await supabase.from('departments').delete().eq('id', department.id)
    if (deleteError) {
      notify(deleteError.message, 'error')
      return
    }
    notify('Área excluída.')
    await load()
  })

  if (loading) return <Loading />

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={`Áreas · ${company.name}`}
        subtitle="As frentes internas da empresa — comercial, financeiro, administrativo... Indicador, tarefa e orçamento podem ser vinculados a uma delas."
        actions={
          canWrite && (
            <button type="button" className="btn-primary" onClick={() => openCreate()}>
              <Plus className="h-4 w-4" /> Nova área
            </button>
          )
        }
      />

      {departments.length === 0 ? (
        <EmptyState
          title="Nenhuma área cadastrada"
          description='Cadastre as frentes internas da empresa — ex.: "Comercial", "Financeiro", "Administrativo" — pra acompanhar indicador, tarefa e orçamento de cada uma juntos.'
          action={
            canWrite && (
              <button type="button" className="btn-primary" onClick={() => openCreate()}>
                <Plus className="h-4 w-4" /> Criar área
              </button>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {departments.map((department) => {
            const counts = countsByDepartment.get(department.id) ?? { kpis: 0, tasks: 0, budgets: 0 }
            return (
              <div key={department.id} className="card min-w-0 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: department.color ?? '#94A3B8' }}
                    />
                    <p className="min-w-0 truncate text-sm font-semibold text-content">{department.name}</p>
                  </div>
                  {canWrite && (
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        className="rounded p-1 text-content-faint hover:bg-hover hover:text-content"
                        onClick={() => openEdit(department)}
                        aria-label="Editar área"
                        title="Editar"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="rounded p-1 text-content-faint hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400"
                        onClick={() => departmentDelete.ask(department)}
                        aria-label="Excluir área"
                        title="Excluir"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-content-faint">
                  <span className="flex items-center gap-1">
                    <Target className="h-3.5 w-3.5" /> {counts.kpis} indicador(es)
                  </span>
                  <span className="flex items-center gap-1">
                    <ClipboardList className="h-3.5 w-3.5" /> {counts.tasks} tarefa(s)
                  </span>
                  <span className="flex items-center gap-1">
                    <Wallet className="h-3.5 w-3.5" /> {counts.budgets} orçamento(s)
                  </span>
                </div>
                <Link
                  to={`/empresa/${company.id}/areas/${department.id}`}
                  className="btn-ghost mt-3 w-full justify-center py-1.5 text-xs"
                >
                  <LayoutDashboard className="h-3.5 w-3.5" /> Ver painel
                </Link>
              </div>
            )
          })}
        </div>
      )}

      <Modal
        open={Boolean(modal)}
        title={modal?.editing ? `Editar ${modal.editing.name}` : 'Nova área'}
        onClose={() => setModal(null)}
        width="max-w-md"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setModal(null)}>
              Cancelar
            </button>
            <button type="submit" form="department-form" className="btn-primary" disabled={busy}>
              {busy && <Spinner />}
              {modal?.editing ? 'Salvar' : 'Criar área'}
            </button>
          </>
        }
      >
        <form id="department-form" onSubmit={submit} className="space-y-4">
          <Field label="Nome da área">
            <input
              className="input"
              required
              autoFocus
              placeholder="Comercial, Financeiro, Administrativo…"
              value={form.name}
              onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))}
            />
          </Field>
          {!modal?.editing && suggestions.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-content-faint">Sugestões</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="rounded-full border border-line px-2.5 py-1 text-xs text-content-soft transition hover:border-brand-500 hover:text-content"
                    onClick={() => setForm((c) => ({ ...c, name }))}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {error && <ErrorText>{error}</ErrorText>}
        </form>
      </Modal>

      <ConfirmDialog
        open={departmentDelete.target !== null}
        title="Excluir área?"
        danger
        busy={departmentDelete.busy}
        confirmLabel="Excluir"
        message={
          <>
            Excluir <strong>{departmentDelete.target?.name}</strong>. Indicadores, tarefas e orçamentos ligados a
            ela continuam existindo, só perdem o vínculo com a área. Não dá pra desfazer.
          </>
        }
        onConfirm={() => void departmentDelete.confirm()}
        onCancel={departmentDelete.cancel}
      />
    </div>
  )
}
