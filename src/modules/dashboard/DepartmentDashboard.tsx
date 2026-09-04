// Painel de área: mesmo tipo de retrato do painel de produto/turma
// (ProductDashboard.tsx) — indicadores, alvos, tarefas e orçamento juntos
// numa tela só —, só que escopado a uma área/departamento interno da
// empresa (Comercial, Financeiro, Administrativo...) em vez de um produto.
//
// Diferente de produto/turma, área não tem subdivisão por baixo — por
// isso este componente é mais simples que o de produto/turma (sem seção
// de "sub-áreas") e, diferente do de produto, MOSTRA tarefas: `tasks` já
// tem `department_id` direto (não a limitação de granularidade que só
// existe pra produto/turma — ver comentário em ProductDashboard.tsx).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ClipboardList, Square, Target, Wallet } from 'lucide-react'
import { supabase } from '../../core/lib/supabase'
import { attainmentRatio, formatDate, formatValue, isOnTarget, relativeDays } from '../../core/lib/format'
import { buildChildrenByParent, effectiveKpiValue, type RollupRow } from '../../core/lib/kpiRollup'
import { useCompany } from '../../core/company/CompanyProvider'
import { Badge, Card, EmptyState, Loading, PageHeader, ProgressBar, useToast } from '../../core/ui'
import { StatTile, IndicatorLine } from './CompanyDashboard'
import {
  GOAL_STATUS_LABEL,
  TASK_PRIORITY_LABEL,
  type Budget,
  type BudgetItem,
  type Department,
  type GoalStatus,
  type Kpi,
  type KpiDirection,
  type KpiLatestValue,
  type KpiUnit,
  type Meta,
  type Profile,
  type Task,
} from '../../core/types'

type KpiRow = RollupRow & { name: string; unit: KpiUnit; direction: KpiDirection; department_id: string | null }

/** Mesmo formato de `MetaRow` do painel da empresa/produto — duplicado de
 *  propósito: cada painel monta a própria lista a partir do escopo dele. */
type MetaRow = {
  meta_id: string
  kpi_id: string
  name: string
  unit: KpiUnit
  direction: KpiDirection
  target_value: number | null
  due_date: string | null
  owner_id: string | null
  status: GoalStatus
  value: number | null
}

type BudgetItemTotals = Pick<BudgetItem, 'budget_id' | 'kind' | 'planned_amount' | 'actual_amount' | 'status'>

export default function DepartmentDashboard() {
  const { company } = useCompany()
  const { departmentId } = useParams<{ departmentId: string }>()
  const { notify } = useToast()

  const [department, setDepartment] = useState<Department | null>(null)
  const [kpiDefs, setKpiDefs] = useState<Kpi[]>([])
  const [kpiValues, setKpiValues] = useState<KpiLatestValue[]>([])
  const [metas, setMetas] = useState<Meta[]>([])
  const [people, setPeople] = useState<Profile[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [budgetItems, setBudgetItems] = useState<BudgetItemTotals[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [
      departmentResult,
      kpiDefResult,
      kpiValueResult,
      metaResult,
      memberResult,
      taskResult,
      budgetResult,
    ] = await Promise.all([
      supabase.from('departments').select('*').eq('id', departmentId).eq('company_id', company.id).maybeSingle(),
      supabase.from('kpis').select('*').eq('company_id', company.id).eq('is_active', true).is('archived_at', null),
      supabase.from('kpi_latest_values').select('*').eq('company_id', company.id).is('archived_at', null),
      supabase.from('metas').select('*').eq('company_id', company.id).is('archived_at', null),
      supabase.from('company_members').select('user_id').eq('company_id', company.id),
      supabase.from('tasks').select('*').eq('company_id', company.id).eq('department_id', departmentId),
      supabase.from('budgets').select('*').eq('company_id', company.id).eq('department_id', departmentId),
    ])

    const memberIds = (memberResult.data ?? []).map((row) => row.user_id)
    const { data: profileRows } = memberIds.length
      ? await supabase.from('profiles').select('*').in('id', memberIds)
      : { data: [] as Profile[] }

    const budgetIds = ((budgetResult.data as Budget[]) ?? []).map((b) => b.id)
    const { data: itemRows } = budgetIds.length
      ? await supabase
          .from('budget_items')
          .select('budget_id, kind, planned_amount, actual_amount, status')
          .in('budget_id', budgetIds)
      : { data: [] as BudgetItemTotals[] }

    setDepartment((departmentResult.data as Department) ?? null)
    setKpiDefs((kpiDefResult.data as Kpi[]) ?? [])
    setKpiValues((kpiValueResult.data as KpiLatestValue[]) ?? [])
    setMetas((metaResult.data as Meta[]) ?? [])
    setPeople((profileRows as Profile[]) ?? [])
    setTasks((taskResult.data as Task[]) ?? [])
    setBudgets((budgetResult.data as Budget[]) ?? [])
    setBudgetItems((itemRows as BudgetItemTotals[]) ?? [])
    setNotFound(!departmentResult.data)
    setLoading(false)
  }, [company.id, departmentId])

  useEffect(() => {
    void load()
  }, [load])

  const markTaskDone = async (task: Task) => {
    const { error } = await supabase.from('tasks').update({ status: 'done' }).eq('id', task.id)
    if (error) {
      notify(error.message, 'error')
      return
    }
    await load()
  }

  // Mesma cadeia de soma de sempre (ver kpiRollup.ts) — roda sobre TODOS os
  // indicadores da empresa porque o valor de um nó do meio depende dos
  // filhos, que podem não estar nesta área.
  const kpiRows = useMemo<KpiRow[]>(
    () =>
      kpiDefs.map((def) => {
        const latest = kpiValues.find((v) => v.kpi_id === def.id)
        return {
          kpi_id: def.id,
          name: def.name,
          unit: def.unit,
          direction: def.direction,
          value: latest ? Number(latest.value) : null,
          department_id: def.department_id,
          parent_kpi_id: def.parent_kpi_id,
        }
      }),
    [kpiDefs, kpiValues],
  )
  const childrenByParent = useMemo(() => buildChildrenByParent(kpiRows), [kpiRows])
  const kpiRowById = useMemo(() => new Map(kpiRows.map((row) => [row.kpi_id, row])), [kpiRows])
  const effectiveValue = useCallback(
    (kpiId: string) => effectiveKpiValue(kpiId, childrenByParent, kpiRowById),
    [childrenByParent, kpiRowById],
  )

  const scopedKpiRows = useMemo(
    () => kpiRows.filter((row) => row.department_id === departmentId),
    [kpiRows, departmentId],
  )

  const metaRows = useMemo<MetaRow[]>(
    () =>
      metas
        .map((meta) => {
          const kpi = kpiRowById.get(meta.kpi_id)
          if (!kpi || kpi.department_id !== departmentId) return null
          return {
            meta_id: meta.id,
            kpi_id: meta.kpi_id,
            name: kpi.name,
            unit: kpi.unit,
            direction: kpi.direction,
            target_value: meta.target_value,
            due_date: meta.due_date,
            owner_id: meta.owner_id,
            status: meta.status,
            value: effectiveValue(meta.kpi_id),
          }
        })
        .filter((row): row is MetaRow => row !== null),
    [metas, kpiRowById, departmentId, effectiveValue],
  )

  const ownerName = (id: string | null) =>
    id ? (people.find((person) => person.id === id)?.full_name ?? '—') : 'Sem responsável'

  const openMetas = useMemo(
    () => [...metaRows].sort((a, b) => ((a.due_date ?? '9999') < (b.due_date ?? '9999') ? -1 : 1)),
    [metaRows],
  )

  const stats = useMemo(() => {
    const withValue = metaRows.filter((row) => row.value !== null && row.target_value !== null)
    const onTarget = withValue.filter((row) => isOnTarget(row.value!, row.target_value, row.direction) === true)
    const offTarget = withValue.filter((row) => isOnTarget(row.value!, row.target_value, row.direction) === false)
    return { onTarget, offTarget }
  }, [metaRows])

  const overallHealth = useMemo(() => {
    const ratios = metaRows
      .filter((row) => row.target_value !== null && Number(row.target_value) !== 0)
      .map((row) => attainmentRatio(row.value, row.target_value, row.direction))
      .filter((ratio): ratio is number => ratio !== null)
    return {
      ratio: ratios.length ? ratios.reduce((sum, r) => sum + r, 0) / ratios.length : null,
      medidos: ratios.length,
    }
  }, [metaRows])

  const openTasks = useMemo(() => tasks.filter((task) => ['todo', 'doing', 'blocked'].includes(task.status)), [tasks])
  const upcomingTasks = useMemo(
    () =>
      openTasks
        .filter((task) => task.due_date)
        .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))
        .slice(0, 6),
    [openTasks],
  )

  const executionByBudget = useMemo(() => {
    const map = new Map<string, { planned: number; actual: number }>()
    for (const item of budgetItems) {
      if (item.kind !== 'despesa' || item.status === 'cancelado') continue
      const entry = map.get(item.budget_id) ?? { planned: 0, actual: 0 }
      entry.planned += Number(item.planned_amount)
      if (item.actual_amount !== null) entry.actual += Number(item.actual_amount)
      map.set(item.budget_id, entry)
    }
    return map
  }, [budgetItems])

  if (loading) return <Loading />

  if (notFound || !department) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="Área não encontrada"
          description="Pode ter sido excluída, ou o link está desatualizado."
          action={
            <Link to={`/empresa/${company.id}/areas`} className="btn-primary">
              Ir para Áreas
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={department.name}
        subtitle="Indicadores, alvos, tarefas e orçamento desta área, juntos."
        actions={
          <Link to={`/empresa/${company.id}/areas`} className="btn-ghost py-1.5 text-xs">
            Ver Todas
          </Link>
        }
      />

      {overallHealth.ratio !== null && (
        <div className="card p-4">
          <ProgressBar
            ratio={overallHealth.ratio}
            label="Saúde geral dos alvos"
            caption={`média de atingimento em ${overallHealth.medidos} alvo(s) definido(s)`}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label="Metas no alvo"
          value={`${stats.onTarget.length}/${stats.onTarget.length + stats.offTarget.length}`}
          hint={`${stats.onTarget.length + stats.offTarget.length} alvo(s) definido(s)`}
          tone={stats.offTarget.length === 0 && stats.onTarget.length > 0 ? 'green' : 'slate'}
          icon={Target}
        />
        <StatTile label="Tarefas abertas" value={openTasks.length} icon={ClipboardList} />
        <StatTile label="Orçamentos" value={budgets.length} icon={Wallet} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Indicadores" description="Último valor apurado de cada um.">
          {scopedKpiRows.length === 0 ? (
            <EmptyState
              title="Nenhum indicador vinculado ainda"
              description="Vincule um indicador existente a esta área pela tela de Metas."
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {scopedKpiRows.map((kpi) => (
                <Link
                  key={kpi.kpi_id}
                  to={`/empresa/${company.id}/kpis/${kpi.kpi_id}`}
                  className="block rounded-lg border border-line p-3 transition hover:border-line-strong hover:bg-hover"
                >
                  <IndicatorLine row={kpi} value={effectiveValue(kpi.kpi_id)} />
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card title="Alvos" description="Alvo, prazo e andamento de cada meta desta área.">
          {openMetas.length === 0 ? (
            <p className="text-sm text-content-soft">Nenhum alvo definido aqui ainda.</p>
          ) : (
            <ul className="space-y-3">
              {openMetas.map((meta) => {
                const ratio = attainmentRatio(meta.value, meta.target_value, meta.direction)
                const caption =
                  meta.value !== null && meta.target_value !== null
                    ? `${formatValue(meta.value, meta.unit)} de ${formatValue(meta.target_value, meta.unit)}`
                    : undefined
                return (
                  <li key={meta.meta_id}>
                    <Link
                      to={`/empresa/${company.id}/kpis/${meta.kpi_id}`}
                      className="block rounded-md -mx-1 px-1 py-0.5 transition hover:bg-hover"
                    >
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate">{meta.name}</span>
                        <Badge tone={meta.status === 'at_risk' ? 'amber' : 'slate'}>
                          {GOAL_STATUS_LABEL[meta.status]}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-content-faint">
                        {ownerName(meta.owner_id)}
                        {meta.due_date && ` · prazo ${formatDate(meta.due_date)} (${relativeDays(meta.due_date)})`}
                      </p>
                      {ratio !== null && (
                        <div className="mt-1.5">
                          <ProgressBar ratio={ratio} caption={caption} />
                        </div>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Próximos prazos"
        description="Tarefas abertas desta área."
        actions={
          <Link to={`/empresa/${company.id}/tarefas`} className="btn-ghost py-1.5 text-xs">
            Ver Tarefas
          </Link>
        }
      >
        {upcomingTasks.length === 0 ? (
          <p className="text-sm text-content-soft">Nenhuma tarefa com prazo definido.</p>
        ) : (
          <ul className="space-y-2.5">
            {upcomingTasks.map((task) => {
              const late = task.due_date! < new Date().toISOString().slice(0, 10)
              return (
                <li key={task.id} className="flex items-start justify-between gap-2">
                  <span className="flex min-w-0 items-start gap-2">
                    <button
                      type="button"
                      className="mt-0.5 shrink-0 text-content-faint hover:text-emerald-600 dark:hover:text-emerald-400"
                      onClick={() => void markTaskDone(task)}
                      aria-label="Marcar como concluída"
                      title="Marcar como concluída"
                    >
                      <Square className="h-4 w-4" />
                    </button>
                    <span className="min-w-0 text-sm">
                      <span className="block truncate">{task.title}</span>
                      <span className="text-xs text-content-faint">{TASK_PRIORITY_LABEL[task.priority]}</span>
                    </span>
                  </span>
                  <Badge tone={late ? 'red' : 'slate'}>{relativeDays(task.due_date)}</Badge>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {budgets.length > 0 && (
        <Card title="Orçamento" description="Execução de despesa de cada orçamento desta área.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {budgets.map((budget) => {
              const execution = executionByBudget.get(budget.id)
              const ratio = execution && execution.planned > 0 ? execution.actual / execution.planned : null
              return (
                <div key={budget.id} className="rounded-lg border border-line p-3">
                  <p className="truncate text-sm font-medium text-content">{budget.title}</p>
                  {ratio !== null && execution ? (
                    <div className="mt-2">
                      <ProgressBar
                        ratio={ratio}
                        label="Despesa executada"
                        variant="spend"
                        caption={`${formatValue(execution.actual, 'currency')} de ${formatValue(execution.planned, 'currency')} previstos`}
                      />
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-content-faint">Sem despesa lançada ainda.</p>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </div>
  )
}
