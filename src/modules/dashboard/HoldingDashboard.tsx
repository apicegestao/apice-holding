// Painel consolidado da holding: todas as empresas lado a lado.
// A RLS continua valendo — só entram as empresas que o usuário pode ver.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Building2, ClipboardList, Sparkles, Target } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { supabase } from '../../core/lib/supabase'
import { formatValue, isOnTarget } from '../../core/lib/format'
import { Badge, Card, EmptyState, Loading, PageHeader } from '../../core/ui'
import type { CompanySnapshot, Insight, KpiLatestValue } from '../../core/types'

export default function HoldingDashboard() {
  const [snapshots, setSnapshots] = useState<CompanySnapshot[]>([])
  const [kpis, setKpis] = useState<KpiLatestValue[]>([])
  const [insights, setInsights] = useState<Insight[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [snapshotResult, kpiResult, insightResult] = await Promise.all([
      supabase.rpc('company_snapshots'),
      supabase.from('kpi_latest_values').select('*').eq('roll_up', true),
      supabase
        .from('insights')
        .select('*')
        .eq('scope', 'holding')
        .eq('is_archived', false)
        .order('generated_at', { ascending: false })
        .limit(4),
    ])

    setSnapshots((snapshotResult.data as CompanySnapshot[]) ?? [])
    setKpis((kpiResult.data as KpiLatestValue[]) ?? [])
    setInsights((insightResult.data as Insight[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const operating = useMemo(() => snapshots.filter((item) => !item.is_holding), [snapshots])

  const totals = useMemo(
    () =>
      operating.reduce(
        (acc, item) => ({
          kpisOnTarget: acc.kpisOnTarget + Number(item.kpis_on_target),
          kpisOffTarget: acc.kpisOffTarget + Number(item.kpis_off_target),
          goalsAtRisk: acc.goalsAtRisk + Number(item.goals_at_risk),
          goalsActive: acc.goalsActive + Number(item.goals_active),
          tasksOpen: acc.tasksOpen + Number(item.tasks_open),
          tasksOverdue: acc.tasksOverdue + Number(item.tasks_overdue),
        }),
        {
          kpisOnTarget: 0,
          kpisOffTarget: 0,
          goalsAtRisk: 0,
          goalsActive: 0,
          tasksOpen: 0,
          tasksOverdue: 0,
        },
      ),
    [operating],
  )

  const chartData = useMemo(
    () =>
      operating.map((item) => ({
        empresa: item.company_name,
        cor: item.company_color,
        Abertas: Number(item.tasks_open),
        Vencidas: Number(item.tasks_overdue),
      })),
    [operating],
  )

  const kpisByCompany = useMemo(() => {
    const map = new Map<string, KpiLatestValue[]>()
    for (const kpi of kpis) {
      const list = map.get(kpi.company_id) ?? []
      list.push(kpi)
      map.set(kpi.company_id, list)
    }
    return map
  }, [kpis])

  if (loading) return <Loading />

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Painel da holding"
        subtitle="Todas as empresas do grupo em um lugar só."
      />

      {operating.length === 0 ? (
        <EmptyState
          title="Nenhuma empresa cadastrada"
          description="Cadastre as empresas controladas para começar a consolidar os números."
          action={
            <Link to="/holding/empresas" className="btn-primary">
              <Building2 className="h-4 w-4" /> Cadastrar empresa
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Empresas</p>
              <p className="mt-2 text-2xl font-semibold">{operating.length}</p>
              <p className="text-xs text-slate-500">no grupo</p>
            </div>
            <div className="card p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                KPIs na meta
              </p>
              <p className="mt-2 text-2xl font-semibold text-emerald-600">
                {totals.kpisOnTarget}
                <span className="text-base font-normal text-slate-400">
                  /{totals.kpisOnTarget + totals.kpisOffTarget}
                </span>
              </p>
              <p className="text-xs text-slate-500">indicadores com meta definida</p>
            </div>
            <div className="card p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Metas em risco
              </p>
              <p
                className={`mt-2 text-2xl font-semibold ${
                  totals.goalsAtRisk ? 'text-amber-600' : 'text-ink-900'
                }`}
              >
                {totals.goalsAtRisk}
              </p>
              <p className="text-xs text-slate-500">de {totals.goalsActive} em andamento</p>
            </div>
            <div className="card p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Tarefas vencidas
              </p>
              <p
                className={`mt-2 text-2xl font-semibold ${
                  totals.tasksOverdue ? 'text-rose-600' : 'text-emerald-600'
                }`}
              >
                {totals.tasksOverdue}
              </p>
              <p className="text-xs text-slate-500">de {totals.tasksOpen} abertas</p>
            </div>
          </div>

          <Card title="Carga de tarefas por empresa">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="empresa" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={40} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Abertas" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry) => (
                      <Cell key={entry.empresa} fill={entry.cor} />
                    ))}
                  </Bar>
                  <Bar dataKey="Vencidas" fill="#F43F5E" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            {operating.map((snapshot) => {
              const companyKpis = kpisByCompany.get(snapshot.company_id) ?? []
              return (
                <Card key={snapshot.company_id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="h-9 w-1.5 rounded-full"
                        style={{ backgroundColor: snapshot.company_color }}
                      />
                      <div>
                        <Link
                          to={`/empresa/${snapshot.company_id}`}
                          className="text-sm font-semibold text-ink-900 hover:text-brand-600"
                        >
                          {snapshot.company_name}
                        </Link>
                        <p className="text-xs text-slate-500">
                          {snapshot.members_total} pessoa(s) com acesso
                        </p>
                      </div>
                    </div>
                    {Number(snapshot.tasks_overdue) > 0 && (
                      <Badge tone="red">
                        <AlertTriangle className="h-3 w-3" /> {snapshot.tasks_overdue} vencida(s)
                      </Badge>
                    )}
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-lg bg-slate-50 py-2">
                      <p className="text-lg font-semibold">
                        {snapshot.kpis_on_target}
                        <span className="text-xs font-normal text-slate-400">
                          /{Number(snapshot.kpis_on_target) + Number(snapshot.kpis_off_target)}
                        </span>
                      </p>
                      <p className="text-[11px] text-slate-500">KPIs na meta</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 py-2">
                      <p className="text-lg font-semibold">{snapshot.goals_active}</p>
                      <p className="text-[11px] text-slate-500">metas ativas</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 py-2">
                      <p className="text-lg font-semibold">{snapshot.tasks_open}</p>
                      <p className="text-[11px] text-slate-500">tarefas abertas</p>
                    </div>
                  </div>

                  {companyKpis.length > 0 && (
                    <ul className="mt-4 space-y-1.5">
                      {companyKpis.slice(0, 4).map((kpi) => {
                        const status = isOnTarget(Number(kpi.value), kpi.target_value, kpi.direction)
                        return (
                          <li
                            key={kpi.kpi_id}
                            className="flex items-center justify-between gap-2 text-sm"
                          >
                            <span className="min-w-0 truncate text-slate-600">{kpi.name}</span>
                            <span
                              className={`shrink-0 font-medium ${
                                status === false ? 'text-rose-600' : 'text-ink-900'
                              }`}
                            >
                              {formatValue(Number(kpi.value), kpi.unit)}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  <div className="mt-4 flex gap-2">
                    <Link to={`/empresa/${snapshot.company_id}`} className="btn-ghost py-1.5 text-xs">
                      <Target className="h-3.5 w-3.5" /> Painel
                    </Link>
                    <Link
                      to={`/empresa/${snapshot.company_id}/tarefas`}
                      className="btn-ghost py-1.5 text-xs"
                    >
                      <ClipboardList className="h-3.5 w-3.5" /> Tarefas
                    </Link>
                  </div>
                </Card>
              )
            })}
          </div>

          {insights.length > 0 && (
            <Card
              title="Insights da holding"
              actions={
                <Link to="/holding/insights" className="text-xs text-brand-600 hover:underline">
                  ver todos
                </Link>
              }
            >
              <ul className="space-y-3">
                {insights.map((insight) => (
                  <li key={insight.id} className="flex gap-3">
                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                    <div>
                      <p className="text-sm font-medium">{insight.title}</p>
                      <p className="text-sm text-slate-600">{insight.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
