// Detalhe de uma meta — drill-down por breadcrumb. Substitui o antigo
// accordion aninhado: em vez de tudo empilhado num cartão só, cada nível
// (empresa/produto/turma) ganha sua própria tela, com um bloco de destaque
// pro nível atual e uma tabela de quebra pros filhos diretos dele. Navegar
// mais fundo é só clicar numa linha da tabela — o breadcrumb no topo sempre
// mostra onde você está.
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  History,
  Layers,
  Pencil,
  Plus,
  SquarePen,
  Target,
  Trash2,
  TrendingUp,
} from 'lucide-react'
import { Line, LineChart, ResponsiveContainer } from 'recharts'
import { attainmentRatio, formatDate, formatValue, relativeDays } from '../../core/lib/format'
import { Badge, Card, EmptyState, Loading } from '../../core/ui'
import { GOAL_STATUS_LABEL, type Kpi } from '../../core/types'
import { statusTone, type KpisCtx } from './KpisPage'

export default function MetaDetail({ ctx, kpiId }: { ctx: KpisCtx; kpiId: string }) {
  const kpi = ctx.kpiById.get(kpiId)

  // Cadeia de ancestrais (empresa → produto → turma → …) subindo por
  // parent_kpi_id — o breadcrumb é só isso renderizado, sem estado próprio.
  const chain = useMemo(() => {
    if (!kpi) return []
    const list: Kpi[] = []
    let cursor: Kpi | undefined = kpi
    while (cursor) {
      list.unshift(cursor)
      cursor = cursor.parent_kpi_id ? ctx.kpiById.get(cursor.parent_kpi_id) : undefined
    }
    return list
  }, [kpi, ctx.kpiById])

  if (ctx.loading) return <Loading />

  if (!kpi) {
    return (
      <EmptyState
        title="Meta não encontrada"
        description="Ela pode ter sido excluída, ou o link está errado."
        action={
          <Link to=".." relative="path" className="btn-primary">
            Voltar pra Metas
          </Link>
        }
      />
    )
  }

  const children = ctx.childrenByParent.get(kpi.id) ?? []
  const rollup = ctx.rollupFor(kpi.id)
  const value = ctx.effectiveValue(kpi.id)
  const displayName = ctx.nestedLabel(kpi)
  const alvos = ctx.metasByKpi.get(kpi.id) ?? []
  // Várias podem existir (ex. alvo mensal e anual da mesma meta) — a que
  // ganha o anel de destaque é a de prazo mais próximo (a lista já vem
  // ordenada por due_date); as demais aparecem completas logo abaixo.
  const primaryAlvo = alvos[0] ?? null
  const ratio = primaryAlvo && value !== null ? attainmentRatio(value, primaryAlvo.target_value, kpi.direction) : null
  const pct = ratio !== null ? Math.round(ratio * 100) : null
  const ringColor = pct === null ? '#BDC4CF' : pct >= 100 ? '#059669' : pct >= 70 ? '#D97706' : '#E11D48'

  const series = ctx.seriesByKpi.get(kpi.id) ?? []
  const chartData = series.slice(-12).map((item) => ({ value: Number(item.value) }))

  // Pode receber produto (nível empresa/produto) ou turma (nível produto) —
  // nunca abaixo de turma, que já é folha. Checagem por "falso" (não por
  // === null) de propósito: em dado vindo de fora do banco de verdade (ex.
  // simulação de teste) o campo pode vir ausente (undefined) em vez de nulo.
  const canAttachChild = !kpi.product_edition_id

  return (
    <div className="space-y-5">
      {/* --------------------------------------------------------- breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm">
        <Link to={`/empresa/${ctx.companyId}/kpis`} className="font-medium text-content-soft hover:text-brand-text">
          Metas
        </Link>
        {chain.map((node, index) => (
          <span key={node.id} className="flex items-center gap-1.5">
            <ChevronRight className="h-3.5 w-3.5 text-content-faint" />
            {index === chain.length - 1 ? (
              <span className="font-bold text-content">{ctx.nestedLabel(node)}</span>
            ) : (
              <Link
                to={`/empresa/${ctx.companyId}/kpis/${node.id}`}
                className="font-medium text-content-soft hover:text-brand-text"
              >
                {ctx.nestedLabel(node)}
              </Link>
            )}
          </span>
        ))}
      </nav>

      {/* ------------------------------------------------------ bloco do nível */}
      <Card className={kpi.is_active ? '' : 'opacity-60'}>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          {pct !== null && (
            <div className="relative h-28 w-28 shrink-0">
              <svg width="112" height="112" viewBox="0 0 112 112">
                <circle cx="56" cy="56" r="46" fill="none" stroke="rgb(var(--hover))" strokeWidth="10" />
                <circle
                  cx="56"
                  cy="56"
                  r="46"
                  fill="none"
                  stroke={ringColor}
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={`${(Math.min(100, Math.max(0, pct)) / 100) * 2 * Math.PI * 46} ${2 * Math.PI * 46}`}
                  transform="rotate(-90 56 56)"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xl font-bold text-content">{pct}%</span>
                <span className="text-[10px] uppercase tracking-wide text-content-faint">do alvo</span>
              </div>
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-semibold text-content-soft">{displayName}</h1>
              {primaryAlvo && <Badge tone={statusTone(primaryAlvo.status)}>{GOAL_STATUS_LABEL[primaryAlvo.status]}</Badge>}
              {rollup && (
                <Badge tone="blue">
                  <Layers className="mr-1 inline h-3 w-3" />
                  soma {rollup.reported}/{rollup.total}
                </Badge>
              )}
              {kpi.category && <span className="text-xs text-content-faint">{kpi.category}</span>}
            </div>
            <p className="mt-1 text-3xl font-bold tracking-tight text-content">
              {value !== null ? formatValue(value, kpi.unit) : '—'}
            </p>
            <p className="mt-1.5 text-sm text-content-soft">
              {primaryAlvo ? (
                <>
                  Alvo: <strong className="text-content">{formatValue(primaryAlvo.target_value, kpi.unit)}</strong>
                  {primaryAlvo.due_date && (
                    <> · prazo {formatDate(primaryAlvo.due_date)} ({relativeDays(primaryAlvo.due_date)})</>
                  )}
                  {primaryAlvo.owner_id && <> · {ctx.ownerName(primaryAlvo.owner_id)}</>}
                </>
              ) : (
                'Nenhum alvo definido ainda.'
              )}
            </p>

            {chartData.length > 1 && (
              <div className="mt-3 h-10 w-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <Line type="monotone" dataKey="value" stroke="rgb(var(--brand))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col">
            {ctx.canWrite && !rollup && (
              <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => ctx.setEntryFor(kpi)}>
                <TrendingUp className="h-3.5 w-3.5" /> Lançar valor
              </button>
            )}
            {ctx.canWrite && (
              <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => ctx.openEdit(kpi)}>
                <Pencil className="h-3.5 w-3.5" /> Editar
              </button>
            )}
            <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => ctx.setHistoryFor(kpi)}>
              <History className="h-3.5 w-3.5" /> Histórico
            </button>
            {ctx.canWrite && kpi.product_id && (
              <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => ctx.setEditingEntity(kpi)}>
                <SquarePen className="h-3.5 w-3.5" /> {kpi.product_edition_id ? 'Editar turma' : 'Editar produto'}
              </button>
            )}
            {ctx.canWrite &&
              (kpi.archived_at ? (
                <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => void ctx.unarchiveKpi(kpi)}>
                  <ArchiveRestore className="h-3.5 w-3.5" /> Reativar
                </button>
              ) : (
                <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => void ctx.archiveKpi(kpi)}>
                  <Archive className="h-3.5 w-3.5" /> Arquivar
                </button>
              ))}
            {ctx.canWrite && (
              <button
                type="button"
                className="btn-ghost py-1.5 text-xs text-rose-600 dark:text-rose-400"
                onClick={() => ctx.setRemovingKpi(kpi)}
              >
                <Trash2 className="h-3.5 w-3.5" /> Excluir
              </button>
            )}
          </div>
        </div>

        {/* ---------------------------------------------------------- alvos */}
        <div className="mt-5 border-t border-line pt-4">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-content-soft">
              <Target className="h-3.5 w-3.5" /> Alvos{alvos.length > 0 && ` (${alvos.length})`}
            </p>
            {ctx.canWrite && (
              <button
                type="button"
                className="text-xs text-brand-text hover:underline"
                onClick={() => ctx.setMetaModalFor({ kpi, meta: null })}
              >
                + Alvo
              </button>
            )}
          </div>
          {alvos.length === 0 ? (
            <p className="mt-1.5 text-xs text-content-faint">Nenhum alvo ainda.</p>
          ) : (
            <ul className="mt-2 space-y-3">
              {alvos.map((meta) => {
                const metaRatio = value !== null ? attainmentRatio(value, meta.target_value, kpi.direction) : null
                return (
                  <li key={meta.id} className="flex flex-wrap items-start justify-between gap-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => ctx.setMetaModalFor({ kpi, meta })}
                    >
                      <span className="block truncate text-sm font-semibold text-content hover:underline">
                        {meta.target_value !== null ? formatValue(meta.target_value, kpi.unit) : 'Alvo sem valor definido'}
                      </span>
                      <span className="block truncate text-xs text-content-soft">
                        {ctx.ownerName(meta.owner_id) ?? 'Sem responsável'}
                        {meta.due_date && <> · prazo {formatDate(meta.due_date)} ({relativeDays(meta.due_date)})</>}
                        {metaRatio !== null && ` · ${Math.round(metaRatio * 100)}%`}
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Badge tone={statusTone(meta.status)}>{GOAL_STATUS_LABEL[meta.status]}</Badge>
                      {ctx.canWrite && (
                        <button
                          type="button"
                          className="rounded p-0.5 text-content-faint hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400"
                          onClick={() => ctx.setRemovingMeta(meta)}
                          aria-label="Excluir alvo"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </Card>

      {/* ---------------------------------------------------- quebra por filho */}
      {children.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-content">Como este número se divide</p>
              <p className="text-xs text-content-faint">
                {children.length} {kpi.product_id ? 'turma(s)' : 'produto(s)'} contribuem pro {displayName}
              </p>
            </div>
            {ctx.canWrite && canAttachChild && (
              <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => ctx.setAttachingTo(kpi)}>
                <Plus className="h-3.5 w-3.5" /> {kpi.product_id ? 'Vincular turma' : 'Vincular produto'}
              </button>
            )}
          </div>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <div className="min-w-[720px]">
                <div
                  className="grid items-center gap-4 border-b border-line px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-content-faint"
                  style={{ gridTemplateColumns: 'minmax(240px, 2fr) 130px 130px 150px 110px 130px 20px' }}
                >
                  <div>{kpi.product_id ? 'Turma' : 'Produto'}</div>
                  <div className="text-right">Atual</div>
                  <div className="text-right">Alvo</div>
                  <div>Progresso</div>
                  <div>Status</div>
                  <div>Prazo</div>
                  <div />
                </div>
                {children.map((child) => (
                  <ChildRow key={child.id} kpi={child} ctx={ctx} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Botão de vincular produto quando a meta ainda não tem nenhum filho
          (a seção acima só aparece quando já existe pelo menos um). */}
      {children.length === 0 && ctx.canWrite && canAttachChild && (
        <button type="button" className="btn-ghost" onClick={() => ctx.setAttachingTo(kpi)}>
          <Plus className="h-3.5 w-3.5" /> {kpi.product_id ? 'Vincular turma' : 'Vincular produto'}
        </button>
      )}
    </div>
  )
}

function ChildRow({ kpi, ctx }: { kpi: Kpi; ctx: KpisCtx }) {
  const value = ctx.effectiveValue(kpi.id)
  const grandchildren = ctx.childrenByParent.get(kpi.id) ?? []
  const alvo = (ctx.metasByKpi.get(kpi.id) ?? [])[0] ?? null
  const ratio = alvo && value !== null ? attainmentRatio(value, alvo.target_value, kpi.direction) : null
  const pct = ratio !== null ? Math.round(ratio * 100) : null
  const barColor = pct === null ? '' : pct >= 100 ? 'bg-emerald-500' : pct >= 70 ? 'bg-amber-500' : 'bg-rose-500'
  const pctColor =
    pct === null
      ? ''
      : pct >= 100
        ? 'text-emerald-600 dark:text-emerald-400'
        : pct >= 70
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-rose-600 dark:text-rose-400'

  const label = ctx.nestedLabel(kpi)
  // Ver comentário equivalente em MetasOverview.tsx: sem isso, o nome
  // acessível do link vira a linha inteira concatenada.
  const ariaLabel = `${label}, atual ${value !== null ? formatValue(value, kpi.unit) : 'sem lançamento'}${
    alvo ? `, alvo ${formatValue(alvo.target_value, kpi.unit)}, ${GOAL_STATUS_LABEL[alvo.status]}` : ', sem alvo'
  }`

  return (
    <Link
      to={`/empresa/${ctx.companyId}/kpis/${kpi.id}`}
      aria-label={ariaLabel}
      className={`grid items-center gap-4 border-b border-line px-5 py-3.5 text-sm transition last:border-b-0 hover:bg-hover ${
        kpi.is_active ? '' : 'opacity-60'
      }`}
      style={{ gridTemplateColumns: 'minmax(240px, 2fr) 130px 130px 150px 110px 130px 20px' }}
    >
      <div className="min-w-0">
        <p className="truncate font-semibold text-content">{label}</p>
        {grandchildren.length > 0 && (
          <p className="text-xs text-content-faint">{grandchildren.length} turma(s)</p>
        )}
      </div>
      <div className="text-right font-semibold text-content">
        {value !== null ? formatValue(value, kpi.unit) : '—'}
      </div>
      <div className="text-right text-content-soft">
        {alvo?.target_value != null ? formatValue(alvo.target_value, kpi.unit) : '—'}
      </div>
      <div>
        {pct !== null ? (
          <>
            <div className="h-1.5 overflow-hidden rounded-full bg-hover">
              <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, Math.max(3, pct))}%` }} />
            </div>
            <p className={`mt-1 text-xs font-semibold ${pctColor}`}>{pct}%</p>
          </>
        ) : (
          <span className="text-xs text-content-faint">—</span>
        )}
      </div>
      <div>
        {alvo ? (
          <Badge tone={statusTone(alvo.status)}>{GOAL_STATUS_LABEL[alvo.status]}</Badge>
        ) : (
          <Badge tone="slate">Sem alvo</Badge>
        )}
      </div>
      <div className="text-xs text-content-soft">{alvo?.due_date ? formatDate(alvo.due_date) : '—'}</div>
      <ChevronRight className="h-4 w-4 text-content-faint" />
    </Link>
  )
}
