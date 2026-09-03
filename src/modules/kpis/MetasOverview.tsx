// Visão Geral de Metas — uma lista escaneável, agrupada por categoria, uma
// linha por meta (não cartões gigantes). Nada aninhado aparece aqui: se a
// meta tem produtos/turmas por baixo, a linha só avisa quantos ("Empresa +
// 2 produtos") — clicar nela abre o Detalhe (MetaDetail.tsx), que é onde a
// quebra por produto/turma vive de verdade.
import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Plus, Search } from 'lucide-react'
import { attainmentRatio, formatDate, formatValue, relativeDays } from '../../core/lib/format'
import { Badge, EmptyState, Loading, PageHeader } from '../../core/ui'
import { GOAL_STATUS_LABEL, type Kpi } from '../../core/types'
import { statusTone, type KpisCtx } from './KpisPage'

// Múltiplas formas de ordenar dentro de cada grupo de categoria — a
// categoria continua sendo o agrupamento principal (não faria sentido
// misturar Financeiro com Comercial só porque o alvo de um é maior), a
// ordenação decide só a ordem das linhas dentro de cada grupo.
type SortKey = 'default' | 'name' | 'alvo' | 'progresso' | 'prazo'
const SORT_LABEL: Record<SortKey, string> = {
  default: 'Mais recentes primeiro',
  name: 'Nome (A-Z)',
  alvo: 'Alvo (maior primeiro)',
  progresso: 'Progresso (maior primeiro)',
  prazo: 'Prazo (mais próximo primeiro)',
}

export default function MetasOverview({ ctx }: { ctx: KpisCtx }) {
  const [productFilter, setProductFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('default')
  // Arquivados ficam num ambiente à parte — só aparece a aba quando existe
  // pelo menos um, pra não acrescentar nada na tela de quem nunca arquivou.
  const [showArchived, setShowArchived] = useState(false)

  // "Filtrar por produto" busca a raiz cujo ramo (em qualquer profundidade)
  // contenha aquele produto — a raiz em si nunca tem product_id (ela é
  // sempre a meta de empresa inteira).
  const hasProductInTree = useCallback(
    (kpi: Kpi, productId: string): boolean => {
      if (kpi.product_id === productId) return true
      return (ctx.childrenByParent.get(kpi.id) ?? []).some((child) => hasProductInTree(child, productId))
    },
    [ctx.childrenByParent],
  )

  // Busca por nome acha a família se o termo bater com o nome da meta OU
  // de qualquer produto/turma vinculado em qualquer profundidade — não dá
  // pra "abrir" só uma parte da família, então quem bate entra inteira.
  const familyMatchesSearch = useCallback(
    (kpi: Kpi, term: string): boolean => {
      if (kpi.name.toLowerCase().includes(term)) return true
      const product = kpi.product_id ? ctx.products.find((item) => item.id === kpi.product_id) : null
      if (product && product.name.toLowerCase().includes(term)) return true
      const edition = kpi.product_edition_id
        ? ctx.editions.find((item) => item.id === kpi.product_edition_id)
        : null
      if (edition && edition.name.toLowerCase().includes(term)) return true
      return (ctx.childrenByParent.get(kpi.id) ?? []).some((child) => familyMatchesSearch(child, term))
    },
    [ctx.childrenByParent, ctx.products, ctx.editions],
  )

  const archivedKpis = useMemo(
    () => ctx.kpis.filter((kpi) => !kpi.parent_kpi_id && Boolean(kpi.archived_at)),
    [ctx.kpis],
  )

  // Categorias em uso de verdade (não o catálogo de sugestões) — sempre
  // atualizado com o que já foi cadastrado, nunca uma lista fixa.
  const categories = useMemo(() => {
    const set = new Set<string>()
    let hasUncategorized = false
    for (const kpi of ctx.kpis) {
      if (kpi.parent_kpi_id) continue
      if (kpi.category) set.add(kpi.category)
      else hasUncategorized = true
    }
    const sorted = [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'))
    return hasUncategorized ? [...sorted, 'Sem categoria'] : sorted
  }, [ctx.kpis])

  const rootKpis = useMemo(() => {
    const byArchiveTab = ctx.kpis.filter(
      (kpi) => !kpi.parent_kpi_id && (showArchived ? Boolean(kpi.archived_at) : !kpi.archived_at),
    )
    const byProduct = productFilter ? byArchiveTab.filter((kpi) => hasProductInTree(kpi, productFilter)) : byArchiveTab
    const byCategory = categoryFilter
      ? byProduct.filter((kpi) => (kpi.category || 'Sem categoria') === categoryFilter)
      : byProduct
    const term = searchTerm.trim().toLowerCase()
    return term ? byCategory.filter((kpi) => familyMatchesSearch(kpi, term)) : byCategory
  }, [ctx.kpis, productFilter, categoryFilter, showArchived, hasProductInTree, searchTerm, familyMatchesSearch])

  // Agrupa por categoria, na ordem em que cada uma apareceu — "Sem
  // categoria" sempre por último, pra não competir por atenção com metas
  // já organizadas. Dentro de cada grupo, a ordem das linhas segue o
  // critério escolhido em `sortBy` — "default" mantém a ordem de chegada
  // (mais recente por último, igual sempre foi), sem custo extra de sort.
  const groups = useMemo(() => {
    const order: string[] = []
    const byCategory = new Map<string, Kpi[]>()
    for (const kpi of rootKpis) {
      const label = kpi.category || 'Sem categoria'
      if (!byCategory.has(label)) {
        byCategory.set(label, [])
        if (label !== 'Sem categoria') order.push(label)
      }
      byCategory.get(label)!.push(kpi)
    }
    if (byCategory.has('Sem categoria')) order.push('Sem categoria')

    if (sortBy !== 'default') {
      for (const items of byCategory.values()) {
        items.sort((a, b) => {
          if (sortBy === 'name') return a.name.localeCompare(b.name, 'pt-BR')
          const statsA = getMetaRowStats(a, ctx)
          const statsB = getMetaRowStats(b, ctx)
          if (sortBy === 'alvo') {
            const va = statsA.alvo?.target_value ?? -Infinity
            const vb = statsB.alvo?.target_value ?? -Infinity
            return vb - va
          }
          if (sortBy === 'progresso') {
            const pa = statsA.pct ?? -Infinity
            const pb = statsB.pct ?? -Infinity
            return pb - pa
          }
          // prazo: mais próximo primeiro — sem prazo definido vai pro fim.
          const da = statsA.alvo?.due_date ?? '9999-99-99'
          const db = statsB.alvo?.due_date ?? '9999-99-99'
          return da.localeCompare(db)
        })
      }
    }

    return order.map((label) => ({ label, items: byCategory.get(label)! }))
  }, [rootKpis, sortBy, ctx.effectiveValue, ctx.childrenByParent, ctx.metasByKpi])

  // Resumo do topo: todo alvo ativo desta empresa, em qualquer nível
  // (empresa/produto/turma) — diferente dos cartões-resumo do painel, que
  // contam só alvo de empresa inteira (ver company_snapshots()), aqui a
  // ideia é justamente dar uma visão de tudo que a própria tela mostra.
  // "Em andamento" junta planejada+ativa: o que importa bater o olho aqui é
  // atingido/em risco/não atingido — o resto é só "seguindo normalmente".
  const alvoStats = useMemo(() => {
    const active = ctx.metas.filter((meta) => !meta.archived_at)
    let achieved = 0
    let atRisk = 0
    let missed = 0
    for (const meta of active) {
      if (meta.status === 'achieved') achieved += 1
      else if (meta.status === 'at_risk') atRisk += 1
      else if (meta.status === 'missed') missed += 1
    }
    const emAndamento = active.length - achieved - atRisk - missed
    return { total: active.length, achieved, atRisk, missed, emAndamento }
  }, [ctx.metas])

  return (
    <>
      <PageHeader
        title={`Metas · ${ctx.companyName}`}
        subtitle="Visão consolidada de todas as metas desta empresa — do número global até cada produto, sub-produto e setor que contribui pra ele."
        actions={
          <>
            {ctx.kpis.length > 0 && (
              <span className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-faint" />
                <input
                  className="input w-auto pl-8"
                  placeholder="Buscar meta…"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  aria-label="Buscar meta por nome"
                />
              </span>
            )}
            {categories.length > 0 && (
              <select
                className="input w-auto"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                aria-label="Filtrar por categoria"
              >
                <option value="">Todas as categorias</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            )}
            {rootKpis.length > 1 && (
              <select
                className="input w-auto"
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as SortKey)}
                aria-label="Ordenar por"
              >
                {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
                  <option key={key} value={key}>
                    Ordenar: {SORT_LABEL[key]}
                  </option>
                ))}
              </select>
            )}
            {ctx.products.length > 0 && (
              <select
                className="input w-auto"
                value={productFilter}
                onChange={(event) => setProductFilter(event.target.value)}
                aria-label="Filtrar por produto"
              >
                <option value="">Todos os produtos</option>
                {ctx.products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            )}
            {ctx.canWrite && !showArchived && (
              <button type="button" className="btn-primary" onClick={ctx.openCreate}>
                <Plus className="h-4 w-4" /> Nova Meta
              </button>
            )}
          </>
        }
      />

      {/* Resumo em barra segmentada — dá a proporção de atingido/em
          andamento/em risco/não atingido num relance, sem competir por
          atenção com quatro números soltos. */}
      {alvoStats.total > 0 && (
        <div className="card mb-4 p-4">
          <p className="mb-3 text-sm text-content">
            <strong className="text-base">{alvoStats.total}</strong> alvo(s) ativo(s) nesta empresa, em todo nível
          </p>
          <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-hover">
            {alvoStats.achieved > 0 && <div className="bg-emerald-500" style={{ flex: alvoStats.achieved }} />}
            {alvoStats.emAndamento > 0 && (
              <div className="bg-line-strong" style={{ flex: alvoStats.emAndamento }} />
            )}
            {alvoStats.atRisk > 0 && <div className="bg-amber-500" style={{ flex: alvoStats.atRisk }} />}
            {alvoStats.missed > 0 && <div className="bg-rose-500" style={{ flex: alvoStats.missed }} />}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-xs text-content-soft">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> {alvoStats.achieved} atingido(s)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-line-strong" /> {alvoStats.emAndamento} em andamento
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-500" /> {alvoStats.atRisk} em risco
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-rose-500" /> {alvoStats.missed} não atingido(s)
            </span>
          </div>
        </div>
      )}

      {/* Arquivados vivem num ambiente à parte — a aba só existe quando há
          pelo menos um, pra não acrescentar nada em quem nunca arquivou. */}
      {archivedKpis.length > 0 && (
        <div className="mb-4 inline-flex rounded-lg border border-line-strong p-0.5 text-sm">
          <button
            type="button"
            onClick={() => setShowArchived(false)}
            className={`rounded-md px-3 py-1.5 font-medium transition ${
              !showArchived ? 'bg-brand/10 text-brand-text' : 'text-content-muted hover:bg-hover'
            }`}
          >
            Ativos
          </button>
          <button
            type="button"
            onClick={() => setShowArchived(true)}
            className={`rounded-md px-3 py-1.5 font-medium transition ${
              showArchived ? 'bg-brand/10 text-brand-text' : 'text-content-muted hover:bg-hover'
            }`}
          >
            Arquivados ({archivedKpis.length})
          </button>
        </div>
      )}

      {ctx.loading ? (
        <Loading />
      ) : ctx.kpis.length === 0 ? (
        <EmptyState
          title="Nenhuma meta ainda"
          description="Comece pelos números que você olharia primeiro se pudesse ver só três."
          action={
            ctx.canWrite && (
              <button type="button" className="btn-primary" onClick={ctx.openCreate}>
                <Plus className="h-4 w-4" /> Nova Meta
              </button>
            )
          }
        />
      ) : rootKpis.length === 0 ? (
        <EmptyState
          title={showArchived ? 'Nenhuma meta arquivada' : 'Nenhuma meta encontrada'}
          description={
            showArchived ? 'Metas arquivadas manualmente aparecem aqui.' : 'Troque a busca ou os filtros acima.'
          }
        />
      ) : (
        <div className="card overflow-hidden">
          {/* Cabeçalho de coluna só existe a partir de sm: (a versão mobile
              não tem coluna nenhuma pra rotular). O rótulo de categoria, em
              compensação, é UM só por grupo — nunca duplicado entre as duas
              apresentações, senão qualquer busca por texto vira ambígua. */}
          <div className="hidden overflow-x-auto sm:block">
            <div className="min-w-[900px]">
              <div
                className="grid items-center gap-4 border-b border-line px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-content-faint"
                style={{ gridTemplateColumns: 'minmax(240px, 2fr) 110px 110px 150px 110px 130px 140px 20px' }}
              >
                <div className="text-center">Meta</div>
                <div className="text-center">Atual</div>
                <div className="text-center">Alvo</div>
                <div className="text-center">Progresso</div>
                <div className="text-center">Status</div>
                <div className="text-center">Prazo</div>
                <div className="text-center">Responsável</div>
                <div />
              </div>
            </div>
          </div>
          {groups.map((group) => (
            <div key={group.label}>
              <p className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wide text-brand-text sm:px-5">
                {group.label}
              </p>
              {/* A partir de sm: tabela em grid. Abaixo de sm: cartão
                  empilhado por meta — 8 colunas nunca cabem legíveis num
                  celular. */}
              <div className="hidden overflow-x-auto sm:block">
                <div className="min-w-[900px]">
                  {group.items.map((kpi) => (
                    <MetaRow key={kpi.id} kpi={kpi} ctx={ctx} />
                  ))}
                </div>
              </div>
              <div className="divide-y divide-line sm:hidden">
                {group.items.map((kpi) => (
                  <MetaCard key={kpi.id} kpi={kpi} ctx={ctx} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/** Cálculo compartilhado entre a linha (sm:+) e o cartão (mobile) da mesma
 *  meta — um lugar só pra não divergir entre as duas apresentações. */
function getMetaRowStats(kpi: Kpi, ctx: KpisCtx) {
  const value = ctx.effectiveValue(kpi.id)
  const childCount = (ctx.childrenByParent.get(kpi.id) ?? []).length
  const levelSummary = childCount > 0 ? `Empresa + ${childCount} produto(s)` : 'Empresa'
  // Uma meta pode ter mais de um alvo (ex. mensal e anual) — a linha mostra
  // só o mais próximo do prazo (a lista já vem ordenada por due_date); o
  // Detalhe mostra todos.
  const alvo = (ctx.metasByKpi.get(kpi.id) ?? [])[0] ?? null
  const ratio = alvo && value !== null ? attainmentRatio(value, alvo.target_value, kpi.direction) : null
  const pct = ratio !== null ? Math.round(ratio * 100) : null
  return { value, levelSummary, alvo, pct }
}

function pctTone(pct: number | null) {
  if (pct === null) return { bar: '', text: '' }
  if (pct >= 100) return { bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' }
  if (pct >= 70) return { bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' }
  return { bar: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400' }
}

function MetaRow({ kpi, ctx }: { kpi: Kpi; ctx: KpisCtx }) {
  const { value, levelSummary, alvo, pct } = getMetaRowStats(kpi, ctx)
  const { bar: barColor, text: pctColor } = pctTone(pct)

  // Sem isso, o nome acessível do link vira o texto da linha inteira
  // (nome+valor+alvo+status+prazo+responsável concatenados) — ruim tanto
  // pra leitor de tela quanto pra identificar a linha certa em teste.
  const ariaLabel = `${kpi.name}, atual ${value !== null ? formatValue(value, kpi.unit) : 'sem lançamento'}${
    alvo ? `, alvo ${formatValue(alvo.target_value, kpi.unit)}, ${GOAL_STATUS_LABEL[alvo.status]}` : ', sem alvo'
  }`

  return (
    <Link
      to={kpi.id}
      aria-label={ariaLabel}
      className={`grid items-center gap-4 border-b border-line px-5 py-3.5 text-sm transition last:border-b-0 hover:bg-hover ${
        kpi.is_active ? '' : 'opacity-60'
      }`}
      style={{ gridTemplateColumns: 'minmax(240px, 2fr) 110px 110px 150px 110px 130px 140px 20px' }}
    >
      <div className="min-w-0">
        <p className="truncate font-semibold text-content">{kpi.name}</p>
        <p className="text-xs text-content-faint">{levelSummary}</p>
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
      <div className="text-xs text-content-soft">
        {alvo?.due_date ? (
          <>
            {formatDate(alvo.due_date)}
            <div className="text-content-faint">{relativeDays(alvo.due_date)}</div>
          </>
        ) : (
          '—'
        )}
      </div>
      <div className="truncate text-xs text-content-soft">
        {alvo ? (ctx.ownerName(alvo.owner_id) ?? 'Sem responsável') : '—'}
      </div>
      <ChevronRight className="h-4 w-4 text-content-faint" />
    </Link>
  )
}

/** Mesma informação de MetaRow, empilhada em cartão — usada abaixo de sm:. */
function MetaCard({ kpi, ctx }: { kpi: Kpi; ctx: KpisCtx }) {
  const { value, levelSummary, alvo, pct } = getMetaRowStats(kpi, ctx)
  const { bar: barColor, text: pctColor } = pctTone(pct)
  const ariaLabel = `${kpi.name}, atual ${value !== null ? formatValue(value, kpi.unit) : 'sem lançamento'}${
    alvo ? `, alvo ${formatValue(alvo.target_value, kpi.unit)}, ${GOAL_STATUS_LABEL[alvo.status]}` : ', sem alvo'
  }`

  return (
    <Link
      to={kpi.id}
      aria-label={ariaLabel}
      className={`block px-4 py-3.5 transition hover:bg-hover ${kpi.is_active ? '' : 'opacity-60'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-content">{kpi.name}</p>
          <p className="text-xs text-content-faint">{levelSummary}</p>
        </div>
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-content-faint" />
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-content-faint">Atual</p>
          <p className="font-semibold text-content">{value !== null ? formatValue(value, kpi.unit) : '—'}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-content-faint">Alvo</p>
          <p className="text-content-soft">{alvo?.target_value != null ? formatValue(alvo.target_value, kpi.unit) : '—'}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-content-faint">Prazo</p>
          <p className="text-content-soft">{alvo?.due_date ? formatDate(alvo.due_date) : '—'}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-content-faint">Responsável</p>
          <p className="truncate text-content-soft">{alvo ? (ctx.ownerName(alvo.owner_id) ?? 'Sem responsável') : '—'}</p>
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
