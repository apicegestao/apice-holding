// Insights de IA. A geração roda numa Edge Function que lê metas, alvos e
// tarefas do escopo e devolve leituras acionáveis para o admin.
import { useCallback, useEffect, useState } from 'react'
import { Archive, Sparkles } from 'lucide-react'
import { supabase, callFunction } from '../../core/lib/supabase'
import { useCompany } from '../../core/company/CompanyProvider'
import {
  Badge,
  Card,
  EmptyState,
  Loading,
  PageHeader,
  Spinner,
  useToast,
} from '../../core/ui'
import type { Insight, InsightSeverity } from '../../core/types'

const SEVERITY_LABEL: Record<InsightSeverity, string> = {
  info: 'Observação',
  opportunity: 'Oportunidade',
  warning: 'Atenção',
  critical: 'Crítico',
}

function severityTone(severity: InsightSeverity) {
  if (severity === 'critical') return 'red'
  if (severity === 'warning') return 'amber'
  if (severity === 'opportunity') return 'green'
  return 'slate'
}

/** "Hoje", "Ontem" ou a data por extenso — o cabeçalho de cada grupo. */
function dayLabel(iso: string) {
  const date = new Date(iso)
  const today = new Date()
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((startOf(today) - startOf(date)) / 86_400_000)
  if (diff === 0) return 'Hoje'
  if (diff === 1) return 'Ontem'
  return date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })
}

const timeOnly = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

/** Agrupa por dia-calendário, mantendo a ordem (mais recente primeiro) que
 *  já vem da consulta — só junta o que já está junto, não reordena nada. */
function groupByDay(insights: Insight[]) {
  const groups: { label: string; items: Insight[] }[] = []
  for (const insight of insights) {
    const label = dayLabel(insight.generated_at)
    const current = groups[groups.length - 1]
    if (current?.label === label) current.items.push(insight)
    else groups.push({ label, items: [insight] })
  }
  return groups
}

function InsightList({
  insights,
  loading,
  onArchive,
}: {
  insights: Insight[]
  loading: boolean
  onArchive: (insight: Insight) => void
}) {
  if (loading) return <Loading />
  if (insights.length === 0) {
    return (
      <EmptyState
        title="Nenhum insight gerado ainda"
        description="Gere a primeira leitura para ver o que os números estão dizendo."
      />
    )
  }

  return (
    <div className="space-y-6">
      {groupByDay(insights).map((group) => (
        <div key={group.label}>
          <div className="mb-2.5 flex items-center gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-content-soft">
              {group.label}
            </h2>
            <span className="h-px flex-1 bg-line" />
            <span className="text-xs text-content-faint">{group.items.length}</span>
          </div>
          <div className="space-y-3">
            {group.items.map((insight) => (
              <Card key={insight.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={severityTone(insight.severity)}>
                        {SEVERITY_LABEL[insight.severity]}
                      </Badge>
                      <h3 className="text-sm font-semibold text-content">{insight.title}</h3>
                    </div>
                    <p className="mt-2 text-sm text-content-muted">{insight.body}</p>
                    {insight.recommendation && (
                      <p className="mt-2 rounded-lg bg-brand/10 px-3 py-2 text-sm text-brand-text">
                        <strong>O que fazer:</strong> {insight.recommendation}
                      </p>
                    )}
                    <p className="mt-2 text-xs text-content-faint">
                      {timeOnly(insight.generated_at)}
                      {insight.model && ` · ${insight.model}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-content-faint hover:bg-hover hover:text-content"
                    title="Arquivar"
                    aria-label={`Arquivar insight "${insight.title}"`}
                    onClick={() => onArchive(insight)}
                  >
                    <Archive className="h-4 w-4" />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function CompanyInsights() {
  const { company, isAdmin } = useCompany()
  const { notify } = useToast()
  const [insights, setInsights] = useState<Insight[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('insights')
      .select('*')
      .eq('company_id', company.id)
      .eq('is_archived', false)
      .order('generated_at', { ascending: false })
      .limit(30)
    setInsights((data as Insight[]) ?? [])
    setLoading(false)
  }, [company.id])

  useEffect(() => {
    void load()
  }, [load])

  const generate = async () => {
    setGenerating(true)
    try {
      await callFunction('ai-insights', { scope: 'company', company_id: company.id })
      notify('Insights gerados.')
      await load()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Falhou.', 'error')
    } finally {
      setGenerating(false)
    }
  }

  const archive = async (insight: Insight) => {
    const { error } = await supabase.from('insights').update({ is_archived: true }).eq('id', insight.id)
    if (error) {
      notify(error.message, 'error')
      return
    }
    setInsights((current) => current.filter((item) => item.id !== insight.id))
  }

  if (!isAdmin) {
    return (
      <EmptyState
        title="Área restrita"
        description="Os insights de IA são visíveis para administradores da empresa."
      />
    )
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={`Insights · ${company.name}`}
        subtitle="A IA lê as metas, os alvos e as tarefas desta empresa e aponta o que merece decisão."
        actions={
          <button type="button" className="btn-primary" disabled={generating} onClick={() => void generate()}>
            {generating ? <Spinner /> : <Sparkles className="h-4 w-4" />}
            Gerar insights
          </button>
        }
      />
      <InsightList insights={insights} loading={loading} onArchive={(item) => void archive(item)} />
    </div>
  )
}

function HoldingInsights() {
  const { notify } = useToast()
  const [insights, setInsights] = useState<Insight[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('insights')
      .select('*')
      .eq('scope', 'holding')
      .eq('is_archived', false)
      .order('generated_at', { ascending: false })
      .limit(30)
    setInsights((data as Insight[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const generate = async () => {
    setGenerating(true)
    try {
      await callFunction('ai-insights', { scope: 'holding' })
      notify('Insights gerados.')
      await load()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Falhou.', 'error')
    } finally {
      setGenerating(false)
    }
  }

  const archive = async (insight: Insight) => {
    const { error } = await supabase.from('insights').update({ is_archived: true }).eq('id', insight.id)
    if (error) {
      notify(error.message, 'error')
      return
    }
    setInsights((current) => current.filter((item) => item.id !== insight.id))
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Insights da Holding"
        subtitle="Leitura consolidada do grupo, comparando as empresas entre si."
        actions={
          <button type="button" className="btn-primary" disabled={generating} onClick={() => void generate()}>
            {generating ? <Spinner /> : <Sparkles className="h-4 w-4" />}
            Gerar insights
          </button>
        }
      />
      <InsightList insights={insights} loading={loading} onArchive={(item) => void archive(item)} />
    </div>
  )
}

export default function InsightsPage({ scope }: { scope: 'company' | 'holding' }) {
  return scope === 'company' ? <CompanyInsights /> : <HoldingInsights />
}
