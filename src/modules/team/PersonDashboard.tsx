// Atalho pra performance de um responsável — pedido do usuário ("clico em
// Felipe e tenho um painel de controle com todas as metas direcionadas e de
// responsabilidade dele"): toda meta que ele é dono (todo nível — empresa,
// produto, turma) e toda tarefa atribuída a ele, em qualquer empresa. Sem
// contexto de empresa nenhum — dá pra chegar aqui tanto de dentro de uma
// empresa (Equipe) quanto da Holding (Usuários do grupo); a RLS decide
// sozinha o que aparece, não filtramos company_id na mão em lugar nenhum.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardList, Square, Target } from 'lucide-react'
import { supabase } from '../../core/lib/supabase'
import { attainmentRatio, formatDate, formatValue, initials, isOnTarget, relativeDays } from '../../core/lib/format'
import { buildChildrenByParent, effectiveKpiValue, type RollupRow } from '../../core/lib/kpiRollup'
import { useAuth } from '../../core/auth/AuthProvider'
import { Badge, Card, EmptyState, Loading, PageHeader, ProgressBar, useToast } from '../../core/ui'
import { StatTile } from '../dashboard/CompanyDashboard'
import {
  GOAL_STATUS_LABEL,
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  type KpiLatestValue,
  type MetaLatestValue,
  type Profile,
  type Task,
} from '../../core/types'

const OPEN_STATUSES = ['todo', 'doing', 'blocked'] as const

// Só os campos que a cadeia de soma precisa — mesmo tipo local que
// HoldingDashboard.tsx já usa pro mesmo propósito.
type RollupDef = { kpi_id: string; company_id: string; parent_kpi_id: string | null }

export default function PersonDashboard() {
  const { userId, companyId } = useParams<{ userId: string; companyId?: string }>()
  const { memberships } = useAuth()
  const { notify } = useToast()

  const [person, setPerson] = useState<Profile | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [metas, setMetas] = useState<MetaLatestValue[]>([])
  const [kpiValues, setKpiValues] = useState<KpiLatestValue[]>([])
  const [kpiDefs, setKpiDefs] = useState<RollupDef[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    const [personResult, metaResult, kpiValueResult, kpiDefResult, taskResult] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      // Todo nível (empresa/produto/turma) — diferente dos painéis de
      // empresa/holding, que escopam a alvo de empresa inteira de
      // propósito (pooling de grãos diferentes no mesmo número). Aqui a
      // pergunta é outra — "tudo que é dessa pessoa" —, então granularidade
      // nenhuma fica de fora.
      supabase.from('meta_latest_values').select('*').eq('owner_id', userId).is('archived_at', null),
      // Cadeia de soma completa, em todo o grupo (mesmo motivo de sempre —
      // um nó do meio nunca lança direto, ver kpiRollup.ts). Sem isso, uma
      // meta de empresa/produto com filho por baixo sempre mostraria
      // R$ 0,00 aqui, mesmo já lançada na turma.
      supabase.from('kpi_latest_values').select('*').is('archived_at', null),
      supabase.from('kpis').select('id, company_id, parent_kpi_id').eq('is_active', true).is('archived_at', null),
      supabase
        .from('tasks')
        .select('*')
        .eq('assignee_id', userId)
        .order('due_date', { ascending: true, nullsFirst: false }),
    ])

    setPerson((personResult.data as Profile | null) ?? null)
    setNotFound(!personResult.data)
    setMetas((metaResult.data as MetaLatestValue[]) ?? [])
    setKpiValues((kpiValueResult.data as KpiLatestValue[]) ?? [])
    setKpiDefs(
      ((kpiDefResult.data as { id: string; company_id: string; parent_kpi_id: string | null }[]) ?? []).map(
        (row) => ({ kpi_id: row.id, company_id: row.company_id, parent_kpi_id: row.parent_kpi_id }),
      ),
    )
    setTasks((taskResult.data as Task[]) ?? [])
    setLoading(false)
  }, [userId])

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

  const companyName = useCallback(
    (id: string) => memberships.find((item) => item.company.id === id)?.company.name ?? 'Empresa',
    [memberships],
  )
  const companyColor = useCallback(
    (id: string) => memberships.find((item) => item.company.id === id)?.company.color ?? '#94A3B8',
    [memberships],
  )

  const rollupRows = useMemo<RollupRow[]>(() => {
    const valueByKpi = new Map(kpiValues.map((row) => [row.kpi_id, Number(row.value)]))
    return kpiDefs.map((def) => ({
      kpi_id: def.kpi_id,
      parent_kpi_id: def.parent_kpi_id,
      value: valueByKpi.get(def.kpi_id) ?? null,
    }))
  }, [kpiDefs, kpiValues])
  const childrenByParent = useMemo(() => buildChildrenByParent(rollupRows), [rollupRows])
  const rollupRowById = useMemo(() => new Map(rollupRows.map((row) => [row.kpi_id, row])), [rollupRows])
  const effectiveValue = useCallback(
    (kpiId: string) => effectiveKpiValue(kpiId, childrenByParent, rollupRowById),
    [childrenByParent, rollupRowById],
  )

  // Valor DE VERDADE (soma incluída), nunca o cru de meta_latest_values —
  // mesmo bug real já corrigido em HoldingDashboard.tsx (meta de empresa
  // com produto/turma por baixo sempre mostrava R$ 0,00 sem isso.
  const metasEffective = useMemo(
    () => metas.map((meta) => ({ ...meta, value: effectiveValue(meta.kpi_id) })).sort((a, b) => {
      if (!a.due_date) return 1
      if (!b.due_date) return -1
      return a.due_date < b.due_date ? -1 : 1
    }),
    [metas, effectiveValue],
  )

  const atRiskCount = metasEffective.filter((meta) => meta.status === 'at_risk').length
  const withTarget = metasEffective.filter((meta) => meta.value !== null && meta.target_value !== null)
  const onTargetCount = withTarget.filter(
    (meta) => isOnTarget(meta.value!, meta.target_value, meta.direction) === true,
  ).length

  const today = new Date().toISOString().slice(0, 10)
  const openTasks = useMemo(() => tasks.filter((task) => OPEN_STATUSES.includes(task.status as never)), [tasks])
  const overdueTasks = openTasks.filter((task) => task.due_date && task.due_date < today)

  const backHref = companyId ? `/empresa/${companyId}/equipe` : '/holding/usuarios'
  const backLabel = companyId ? 'Equipe da empresa' : 'Usuários do grupo'

  if (loading) return <Loading />

  if (notFound || !person) {
    return (
      <div className="mx-auto max-w-3xl">
        <Link to={backHref} className="btn-ghost mb-4 py-1.5 text-xs">
          <ArrowLeft className="h-3.5 w-3.5" /> {backLabel}
        </Link>
        <EmptyState
          title="Pessoa não encontrada"
          description="Ou vocês não têm nenhuma empresa em comum — o acesso segue as mesmas regras de sempre."
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link to={backHref} className="btn-ghost -mb-2 py-1.5 text-xs">
        <ArrowLeft className="h-3.5 w-3.5" /> {backLabel}
      </Link>

      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-hover text-sm font-semibold text-content-muted">
          {initials(person.full_name || person.email)}
        </span>
        <PageHeader
          title={person.full_name}
          subtitle={[person.job_title, person.email].filter(Boolean).join(' · ')}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile
          label="Metas no alvo"
          value={`${onTargetCount}/${withTarget.length}`}
          hint={`${withTarget.length} alvo(s) com valor lançado`}
          tone={withTarget.length > 0 && onTargetCount === withTarget.length ? 'green' : 'slate'}
          icon={CheckCircle2}
        />
        <StatTile
          label="Metas em risco"
          value={atRiskCount}
          tone={atRiskCount > 0 ? 'amber' : 'green'}
          hint={`de ${metasEffective.length} sob responsabilidade`}
          icon={Target}
        />
        <StatTile
          label="Tarefas abertas"
          value={openTasks.length}
          icon={ClipboardList}
          hint={`${tasks.filter((task) => task.status === 'done').length} concluídas`}
        />
        <StatTile
          label="Tarefas vencidas"
          value={overdueTasks.length}
          tone={overdueTasks.length > 0 ? 'red' : 'green'}
          hint={overdueTasks.length ? 'precisam de atenção' : 'nada atrasado'}
          icon={AlertTriangle}
        />
      </div>

      <Card
        title="Metas sob responsabilidade"
        description="Toda meta em que esta pessoa é a responsável — empresa, produto ou turma."
      >
        {metasEffective.length === 0 ? (
          <EmptyState title="Nenhuma meta atribuída" description="Ainda não é responsável por nenhuma meta." />
        ) : (
          <ul className="space-y-3">
            {metasEffective.map((meta) => {
              const ratio = attainmentRatio(meta.value, meta.target_value, meta.direction)
              const caption =
                meta.value !== null && meta.target_value !== null
                  ? `${formatValue(meta.value, meta.unit)} de ${formatValue(meta.target_value, meta.unit)}`
                  : undefined
              return (
                <li key={meta.meta_id}>
                  <Link
                    to={`/empresa/${meta.company_id}/kpis/${meta.kpi_id}`}
                    className="block rounded-md -mx-1 px-1 py-1 transition hover:bg-hover"
                  >
                    <div className="flex items-center gap-2 text-sm">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: companyColor(meta.company_id) }}
                        title={companyName(meta.company_id)}
                      />
                      <span className="min-w-0 flex-1 truncate">{meta.name}</span>
                      <Badge tone={meta.status === 'at_risk' ? 'amber' : 'slate'}>
                        {GOAL_STATUS_LABEL[meta.status]}
                      </Badge>
                    </div>
                    <p className="mt-0.5 pl-4 text-xs text-content-faint">
                      {companyName(meta.company_id)}
                      {meta.due_date && (
                        <>
                          {' · prazo '}
                          {formatDate(meta.due_date)} ({relativeDays(meta.due_date)})
                        </>
                      )}
                    </p>
                    {ratio !== null && (
                      <div className="mt-1.5 pl-4">
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

      <Card title="Tarefas atribuídas" description="Toda tarefa desta pessoa, em qualquer empresa.">
        {tasks.length === 0 ? (
          <EmptyState title="Nenhuma tarefa atribuída" description="Ainda não há tarefa nenhuma pra esta pessoa." />
        ) : (
          <ul className="divide-y divide-line">
            {tasks.slice(0, 20).map((task) => {
              const late = Boolean(task.due_date && task.due_date < today && task.status !== 'done')
              return (
                <li key={task.id} className="flex flex-wrap items-center gap-2 py-2.5">
                  {OPEN_STATUSES.includes(task.status as never) ? (
                    <button
                      type="button"
                      className="shrink-0 text-content-faint hover:text-emerald-600 dark:hover:text-emerald-400"
                      onClick={() => void markTaskDone(task)}
                      aria-label="Marcar como concluída"
                      title="Marcar como concluída"
                    >
                      <Square className="h-4 w-4" />
                    </button>
                  ) : (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  )}
                  <span
                    className="h-6 w-1 shrink-0 rounded-full"
                    style={{ backgroundColor: companyColor(task.company_id) }}
                    title={companyName(task.company_id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-content">{task.title}</span>
                    <span className="text-xs text-content-soft">
                      {companyName(task.company_id)} · {TASK_STATUS_LABEL[task.status]} ·{' '}
                      {TASK_PRIORITY_LABEL[task.priority]}
                    </span>
                  </span>
                  {task.due_date && (
                    <Badge tone={late ? 'red' : 'slate'}>{relativeDays(task.due_date)}</Badge>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
