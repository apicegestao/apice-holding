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
  CalendarRange,
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
import { attainmentRatio, formatDate, formatValue, relativeDays, sumValuesInRange } from '../../core/lib/format'
import { contributionRatio } from '../../core/lib/kpiRollup'
import { Badge, Card, EmptyState, Loading } from '../../core/ui'
import { CHECKPOINT_FREQUENCY_LABEL, GOAL_STATUS_LABEL, type Kpi, type Meta } from '../../core/types'
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

  // Por prazo (mais próximo primeiro) — pedido explícito: a ordenação
  // precisa ser cronológica, senão turmas de meses diferentes aparecem
  // fora de ordem (ex. set/nov/out) e a lista fica "bagunçada" de bater o
  // olho. Sem prazo definido vai pro fim, não pro topo. Precisa vir ANTES
  // dos returns condicionais abaixo (loading / meta não achada) — hook
  // nunca pode ser pulado em algumas renderizações e chamado em outras,
  // senão o React perde a contagem de hooks entre uma e outra.
  const children = useMemo(() => {
    if (!kpi) return []
    return [...(ctx.childrenByParent.get(kpi.id) ?? [])].sort((a, b) => {
      const da = (ctx.metasByKpi.get(a.id) ?? [])[0]?.due_date
      const db = (ctx.metasByKpi.get(b.id) ?? [])[0]?.due_date
      if (!da && !db) return 0
      if (!da) return 1
      if (!db) return -1
      return da.localeCompare(db)
    })
  }, [ctx, kpi])

  // Soma dos alvos dos produtos/turmas diretos — pra comparar com o alvo
  // definido aqui em cima (os dois são independentes: nada impede o alvo
  // da empresa ser diferente da soma dos alvos que cada produto assumiu).
  // null (não 0) quando nenhum filho tem alvo ainda. Mesma exigência de
  // ordem que `children` acima: hook antes de qualquer return condicional.
  const childrenAlvoSum = useMemo(() => {
    let sum = 0
    let any = false
    for (const child of children) {
      const childAlvo = (ctx.metasByKpi.get(child.id) ?? [])[0]
      if (childAlvo?.target_value != null) {
        sum += Number(childAlvo.target_value)
        any = true
      }
    }
    return any ? sum : null
  }, [children, ctx.metasByKpi])

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
            {/* Soma dos alvos dos produtos — independente do alvo definido
                aqui em cima, útil pra conferir se um bate com o outro. */}
            {childrenAlvoSum !== null && (
              <p className="mt-0.5 text-xs text-content-faint">
                Soma dos alvos dos produtos: {formatValue(childrenAlvoSum, kpi.unit)}
              </p>
            )}

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

      {/* ------------------------------------------- acompanhamento por período */}
      {/* Só existe pra meta sem filho — com produto/turma por baixo, "Como
          este número se divide" já é o acompanhamento por período (com
          dados de verdade), então as duas coisas juntas confundiriam mais
          do que ajudariam (ver aviso equivalente no modal de editar alvo,
          que também esconde a repartição nesse caso). */}
      {primaryAlvo && children.length === 0 && <PeriodTracker meta={primaryAlvo} kpi={kpi} ctx={ctx} />}

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
            {/* A partir de sm: tabela em grid (rolagem horizontal só em
                telas bem estreitas). Abaixo de sm: cartão empilhado por
                filho — mesma informação, sem espremer 8 colunas num celular. */}
            <div className="hidden overflow-x-auto sm:block">
              <div className="min-w-[820px]">
                <div
                  className="grid items-center gap-4 border-b border-line px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-content-faint"
                  style={{ gridTemplateColumns: 'minmax(200px, 2fr) 110px 90px 110px 150px 110px 130px 20px' }}
                >
                  <div className="text-center">{kpi.product_id ? 'Turma' : 'Produto'}</div>
                  <div className="text-center">Atual</div>
                  <div className="text-center">Contrib.</div>
                  <div className="text-center">Alvo</div>
                  <div className="text-center">Progresso</div>
                  <div className="text-center">Status</div>
                  <div className="text-center">Prazo</div>
                  <div />
                </div>
                {children.map((child) => (
                  <ChildRow key={child.id} kpi={child} ctx={ctx} parentValue={value} />
                ))}
                {/* Total — soma do que já foi lançado e soma dos alvos que
                    cada produto/turma assumiu (os dois são contas
                    independentes: nada garante que a soma dos alvos bate
                    com o alvo definido lá em cima no cartão). */}
                <div
                  className="grid items-center gap-4 border-t border-line-strong bg-hover/40 px-5 py-2.5 text-sm font-semibold text-content"
                  style={{ gridTemplateColumns: 'minmax(200px, 2fr) 110px 90px 110px 150px 110px 130px 20px' }}
                >
                  <div>Total</div>
                  <div className="text-right">{value !== null ? formatValue(value, kpi.unit) : '—'}</div>
                  <div />
                  <div className="text-right">
                    {childrenAlvoSum !== null ? formatValue(childrenAlvoSum, kpi.unit) : '—'}
                  </div>
                  <div />
                  <div />
                  <div />
                  <div />
                </div>
              </div>
            </div>
            <div className="sm:hidden">
              <div className="space-y-2.5 p-3">
                {children.map((child) => (
                  <ChildCard key={child.id} kpi={child} ctx={ctx} parentValue={value} />
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-line-strong bg-hover/40 px-4 py-3 text-sm font-semibold text-content">
                <span>Total</span>
                <span className="flex gap-3">
                  <span>{value !== null ? formatValue(value, kpi.unit) : '—'}</span>
                  {childrenAlvoSum !== null && (
                    <span className="text-content-soft">de {formatValue(childrenAlvoSum, kpi.unit)}</span>
                  )}
                </span>
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

/** Cálculo compartilhado entre a linha (sm:+) e o cartão (mobile) do mesmo
 *  filho — um lugar só pra não divergir entre as duas apresentações. */
function useChildStats(kpi: Kpi, ctx: KpisCtx, parentValue: number | null) {
  const value = ctx.effectiveValue(kpi.id)
  const grandchildren = ctx.childrenByParent.get(kpi.id) ?? []
  const alvo = (ctx.metasByKpi.get(kpi.id) ?? [])[0] ?? null
  const ratio = alvo && value !== null ? attainmentRatio(value, alvo.target_value, kpi.direction) : null
  const pct = ratio !== null ? Math.round(ratio * 100) : null
  const contribution = contributionRatio(value, parentValue)
  const contributionPct = contribution !== null ? Math.round(contribution * 100) : null
  const label = ctx.nestedLabel(kpi)
  return { value, grandchildren, alvo, pct, contributionPct, label }
}

function pctTone(pct: number | null) {
  if (pct === null) return { bar: '', text: '' }
  if (pct >= 100) return { bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' }
  if (pct >= 70) return { bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' }
  return { bar: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400' }
}

function ChildRow({ kpi, ctx, parentValue }: { kpi: Kpi; ctx: KpisCtx; parentValue: number | null }) {
  const { value, grandchildren, alvo, pct, contributionPct, label } = useChildStats(kpi, ctx, parentValue)
  const { bar: barColor, text: pctColor } = pctTone(pct)

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
      style={{ gridTemplateColumns: 'minmax(200px, 2fr) 110px 90px 110px 150px 110px 130px 20px' }}
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
      <div className="text-right text-content-soft">{contributionPct !== null ? `${contributionPct}%` : '—'}</div>
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

/** Mesma informação de ChildRow, empilhada em cartão — usada abaixo de sm:
 *  pra nunca precisar espremer 8 colunas num celular. */
function ChildCard({ kpi, ctx, parentValue }: { kpi: Kpi; ctx: KpisCtx; parentValue: number | null }) {
  const { value, grandchildren, alvo, pct, contributionPct, label } = useChildStats(kpi, ctx, parentValue)
  const { bar: barColor, text: pctColor } = pctTone(pct)
  const ariaLabel = `${label}, atual ${value !== null ? formatValue(value, kpi.unit) : 'sem lançamento'}${
    alvo ? `, alvo ${formatValue(alvo.target_value, kpi.unit)}, ${GOAL_STATUS_LABEL[alvo.status]}` : ', sem alvo'
  }`

  return (
    <Link
      to={`/empresa/${ctx.companyId}/kpis/${kpi.id}`}
      aria-label={ariaLabel}
      className={`block rounded-xl border border-line-strong bg-surface px-4 py-3.5 shadow-card transition
        hover:border-content-faint hover:bg-hover ${kpi.is_active ? '' : 'opacity-60'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-content">{label}</p>
          {grandchildren.length > 0 && (
            <p className="text-xs text-content-faint">{grandchildren.length} turma(s)</p>
          )}
        </div>
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-content-faint" />
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-content-faint">Atual</p>
          <p className="font-semibold text-content">{value !== null ? formatValue(value, kpi.unit) : '—'}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-content-faint">Contribuição</p>
          <p className="text-content-soft">{contributionPct !== null ? `${contributionPct}%` : '—'}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-content-faint">Alvo</p>
          <p className="text-content-soft">{alvo?.target_value != null ? formatValue(alvo.target_value, kpi.unit) : '—'}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-content-faint">Prazo</p>
          <p className="text-content-soft">{alvo?.due_date ? formatDate(alvo.due_date) : '—'}</p>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-3">
        {alvo ? <Badge tone={statusTone(alvo.status)}>{GOAL_STATUS_LABEL[alvo.status]}</Badge> : <Badge tone="slate">Sem alvo</Badge>}
        {pct !== null && (
          <div className="min-w-0 flex-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-hover">
              <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, Math.max(3, pct))}%` }} />
            </div>
          </div>
        )}
        {pct !== null && <span className={`shrink-0 text-xs font-semibold ${pctColor}`}>{pct}%</span>}
      </div>
    </Link>
  )
}

/** Progresso e % de cada parcela do alvo (dia/semana/.../ano) — só existe
 *  quando o alvo primário já foi repartido (ver "Repartir por período" no
 *  modal de editar alvo). Full-width, fora do Card, com espaço de sobra —
 *  era isso que faltava: antes só cabia uma lista apertada dentro do modal. */
function PeriodTracker({ meta, kpi, ctx }: { meta: Meta; kpi: Kpi; ctx: KpisCtx }) {
  const checkpoints = ctx.checkpointsByMeta.get(meta.id) ?? []
  const series = ctx.seriesByKpi.get(kpi.id) ?? []
  if (!checkpoints.length) return null

  return (
    <div>
      <div className="mb-3">
        <p className="flex items-center gap-1.5 text-sm font-bold text-content">
          <CalendarRange className="h-4 w-4 text-content-faint" /> Acompanhamento por período
        </p>
        <p className="text-xs text-content-faint">
          Alvo de {formatValue(meta.target_value, kpi.unit)} repartido em {checkpoints.length} parcela(s) de{' '}
          {CHECKPOINT_FREQUENCY_LABEL[checkpoints[0].frequency].toLowerCase()} — cada uma comparada com o que foi
          lançado naquele período.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {checkpoints.map((checkpoint) => {
          const actual = sumValuesInRange(series, checkpoint.period_start, checkpoint.period_end)
          const pct =
            actual !== null && checkpoint.target_value ? Math.round((actual / checkpoint.target_value) * 100) : null
          const { bar, text } = pctTone(pct)
          return (
            <div key={checkpoint.id} className="card p-3.5">
              <p className="text-xs font-semibold text-content">
                {CHECKPOINT_FREQUENCY_LABEL[checkpoint.frequency]} {checkpoint.seq}
              </p>
              <p className="text-[11px] text-content-faint">
                {formatDate(checkpoint.period_start)}–{formatDate(checkpoint.period_end)}
              </p>
              <p className="mt-2 text-lg font-bold text-content">
                {actual !== null ? formatValue(actual, kpi.unit) : '—'}
              </p>
              <p className="text-xs text-content-soft">de {formatValue(checkpoint.target_value, kpi.unit)}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-hover">
                <div
                  className={`h-full rounded-full ${bar}`}
                  style={{ width: `${pct !== null ? Math.min(100, Math.max(3, pct)) : 0}%` }}
                />
              </div>
              <p className={`mt-1 text-xs font-semibold ${text || 'text-content-faint'}`}>
                {pct !== null ? `${pct}%` : 'sem lançamento'}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
