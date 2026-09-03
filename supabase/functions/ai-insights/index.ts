// Geração de insights com IA para o admin da empresa ou da holding.
// O provedor (Gemini ou Claude) e o modelo vêm das configurações da holding.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { generateText, listModels, pickDefaultModel, type Provider } from './providers.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const SEVERITIES = ['info', 'opportunity', 'warning', 'critical']

const SYSTEM_PROMPT = `Você é o analista de gestão da Ápice Holding, uma holding que controla várias empresas.
Recebe um retrato em JSON com o estado inteiro da empresa (ou do grupo): metas — o que se mede —, cada uma
podendo ter zero, um ou vários alvos (valor-alvo, prazo, responsável e andamento), tarefas, orçamentos
de eventos/projetos (previsto x realizado) e integrações. Ao escrever os insights, chame a coisa medida de
"meta" e o valor-alvo/prazo/responsável dela de "alvo" — nunca use "KPI" ou "indicador". Devolve insights
acionáveis para o administrador.

Cada meta tem um campo "nivel": "empresa", "produto" ou "turma" (e, quando aplicável, "produto"/"edicao"
com o nome). Isso é uma cascata: o valor de uma meta de turma soma automaticamente na do produto, que soma
na da empresa — a mesma coisa medida em três grãos diferentes, não três metas independentes. Ao comentar
um alvo de nível produto ou turma, deixe claro o nível ("o alvo da turma X do produto Y", não só "o alvo").
Nunca compare ou some alvos de níveis diferentes como se fossem o mesmo objetivo — um alvo de turma perdido
não é equivalente a um alvo de empresa perdido.

Regras:
- Responda SEMPRE em português do Brasil.
- Trabalhe apenas com os números fornecidos. Nunca invente dados que não estão no retrato.
- Se os dados forem insuficientes para uma conclusão, diga isso explicitamente em vez de especular.
- Cruze módulos quando fizer sentido: uma integração que parou de sincronizar e a meta dela sem lançamento
  recente, um alvo sem tarefa nenhuma andando por trás dele.
- Priorize o que muda decisão: meta fora do alvo, alvo em risco ou sem responsável, tarefa vencida, tendência
  de queda, integração falhando.
- Entre 3 e 6 insights, do mais crítico para o menos crítico.

Responda APENAS com um array JSON válido, sem texto antes ou depois, sem blocos de código.
Cada item: {"title": string (até 80 caracteres), "body": string (2 a 4 frases com os números que sustentam a conclusão), "severity": "info"|"opportunity"|"warning"|"critical", "recommendation": string (uma ação concreta e específica)}`

async function getCaller(req: Request) {
  const authorization = req.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return null
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })
  const { data, error } = await client.auth.getUser()
  if (error || !data.user) return null

  const { data: profile } = await admin
    .from('profiles')
    .select('id, is_super_admin, is_active')
    .eq('id', data.user.id)
    .maybeSingle()

  if (!profile?.is_active) return null
  return profile as { id: string; is_super_admin: boolean }
}

// ----------------------------------------------------------------------------
// Cada módulo do sistema lê os próprios dados aqui e devolve um pedaço do
// retrato. Isso é de propósito: um insight raso ("faturamento caiu") é fácil;
// um insight profundo cruza módulos ("faturamento caiu, a integração que
// alimenta esse KPI parou de sincronizar há 9 dias, e a tarefa que resolveria
// isso está atrasada"). Pra IA enxergar essa ligação, ela precisa ver os
// módulos todos de uma vez — não um de cada vez.
//
// Ao adicionar um módulo novo ao sistema, adicione um leitor aqui. Não é
// automático de propósito (cada tabela nova tem sua própria forma de virar
// contexto útil) — é UM lugar só pra lembrar, em vez de espalhado.
//
// Notas ficam de fora de propósito: são privadas de quem escreveu (RLS não
// usa app.is_member como todo o resto do sistema), e isso vale também aqui —
// nem a IA que gera insight pro admin lê a nota de outra pessoa.
type ModuleReader = (companyId: string) => Promise<Record<string, unknown>>

const MODULE_READERS: Record<string, ModuleReader> = {
  async kpis(companyId) {
    const { data: kpis } = await admin
      .from('kpis')
      .select('id, name, unit, direction, frequency, category, product_id, product_edition_id, parent_kpi_id')
      .eq('company_id', companyId)
      .eq('is_active', true)

    const kpiIds = (kpis ?? []).map((k) => k.id)
    if (!kpiIds.length) return { kpis: [] }

    // Nome do produto/turma de cada meta, pra IA saber o nível (empresa,
    // produto ou turma) em vez de só ver kpi_id/product_id soltos.
    const productIds = [...new Set((kpis ?? []).map((k) => k.product_id).filter((id): id is string => Boolean(id)))]
    const editionIds = [
      ...new Set((kpis ?? []).map((k) => k.product_edition_id).filter((id): id is string => Boolean(id))),
    ]
    const [{ data: products }, { data: editions }] = await Promise.all([
      productIds.length
        ? admin.from('products').select('id, name').in('id', productIds)
        : { data: [] as { id: string; name: string }[] },
      editionIds.length
        ? admin.from('product_editions').select('id, name').in('id', editionIds)
        : { data: [] as { id: string; name: string }[] },
    ])
    const productName = new Map((products ?? []).map((p) => [p.id, p.name]))
    const editionName = new Map((editions ?? []).map((e) => [e.id, e.name]))

    const history: Record<string, { period: string; value: number }[]> = {}

    const [{ data: values }, { data: metas }] = await Promise.all([
      admin
        .from('kpi_values')
        .select('kpi_id, period_start, value')
        .in('kpi_id', kpiIds)
        .order('period_start', { ascending: false })
        .limit(400),
      // Um indicador pode ter 0, 1 ou várias metas — cada uma com seu
      // próprio prazo, alvo, responsável e andamento.
      admin
        .from('metas')
        .select('id, kpi_id, target_value, due_date, owner_id, status')
        .in('kpi_id', kpiIds),
    ])

    for (const row of values ?? []) {
      const bucket = (history[row.kpi_id] ??= [])
      if (bucket.length < 8) bucket.push({ period: row.period_start, value: Number(row.value) })
    }

    const metaIds = (metas ?? []).map((m) => m.id)
    const ownerIds = [
      ...new Set((metas ?? []).map((m) => m.owner_id).filter((id): id is string => Boolean(id))),
    ]

    const [{ data: checkpoints }, { data: owners }] = await Promise.all([
      metaIds.length
        ? admin
            .from('kpi_checkpoints')
            .select('meta_id, period_start, period_end, target_value')
            .in('meta_id', metaIds)
            .order('seq', { ascending: true })
        : { data: [] as { meta_id: string; period_start: string; period_end: string; target_value: number }[] },
      ownerIds.length
        ? admin.from('profiles').select('id, full_name').in('id', ownerIds)
        : { data: [] as { id: string; full_name: string }[] },
    ])

    const checkpointsByMeta: Record<string, { periodo: string; alvo: number }[]> = {}
    for (const row of checkpoints ?? []) {
      const bucket = (checkpointsByMeta[row.meta_id] ??= [])
      bucket.push({ periodo: `${row.period_start}..${row.period_end}`, alvo: Number(row.target_value) })
    }
    const ownerName = new Map((owners ?? []).map((o) => [o.id, o.full_name]))

    type MetaRow = {
      id: string
      kpi_id: string
      target_value: number | null
      due_date: string | null
      owner_id: string | null
      status: string
    }
    const metasByKpi: Record<string, MetaRow[]> = {}
    for (const m of (metas ?? []) as MetaRow[]) {
      const bucket = (metasByKpi[m.kpi_id] ??= [])
      bucket.push(m)
    }

    return {
      kpis: (kpis ?? []).map((k) => ({
        nome: k.name,
        // Cascata de 3 níveis: uma meta de turma soma na de produto, que
        // soma na de empresa (parent_kpi_id) — nivel/produto/edicao dizem
        // onde esta linha fica nessa cadeia.
        nivel: k.product_edition_id ? 'turma' : k.product_id ? 'produto' : 'empresa',
        produto: k.product_id ? (productName.get(k.product_id) ?? null) : null,
        edicao: k.product_edition_id ? (editionName.get(k.product_edition_id) ?? null) : null,
        categoria: k.category,
        unidade: k.unit,
        direcao: k.direction, // "up" = quanto maior melhor
        frequencia: k.frequency,
        ultimos_valores: (history[k.id] ?? []).slice().reverse(),
        metas: (metasByKpi[k.id] ?? []).map((m) => ({
          meta: m.target_value === null ? null : Number(m.target_value),
          prazo: m.due_date,
          andamento: m.status,
          responsavel: m.owner_id ? (ownerName.get(m.owner_id) ?? null) : null,
          parcelas_semanais: checkpointsByMeta[m.id] ?? [],
        })),
      })),
    }
  },

  async tarefas(companyId) {
    const { data: tasks } = await admin
      .from('tasks')
      .select('title, status, priority, due_date, visibility, tags')
      .eq('company_id', companyId)
      .in('status', ['todo', 'doing', 'blocked'])
      .order('due_date', { ascending: true })
      .limit(50)
    return { tarefas_abertas: tasks ?? [] }
  },

  async orcamentos(companyId) {
    const { data: budgets } = await admin
      .from('budgets')
      .select('id, title, status, event_date')
      .eq('company_id', companyId)
      .limit(20)
    if (!budgets?.length) return { orcamentos: [] }

    const { data: items } = await admin
      .from('budget_items')
      .select('budget_id, kind, status, planned_amount, actual_amount, due_date')
      .in('budget_id', budgets.map((b) => b.id))
      .neq('status', 'cancelado')

    return {
      // Orçamento de evento/projeto: previsto x realizado já somado por
      // orçamento — a IA não precisa (nem consegue) somar centavo a
      // centavo, só cruzar com prazos e tarefas do mesmo projeto.
      orcamentos: budgets.map((budget) => {
        const rows = (items ?? []).filter((i) => i.budget_id === budget.id)
        const sum = (kind: string, field: 'planned_amount' | 'actual_amount') =>
          rows.filter((r) => r.kind === kind).reduce((acc, r) => acc + Number(r[field] ?? 0), 0)
        return {
          titulo: budget.title,
          situacao: budget.status,
          data_evento: budget.event_date,
          receita_prevista: sum('receita', 'planned_amount'),
          despesa_prevista: sum('despesa', 'planned_amount'),
          receita_realizada: sum('receita', 'actual_amount'),
          despesa_realizada: sum('despesa', 'actual_amount'),
          itens_sem_valor_realizado: rows.filter((r) => r.actual_amount === null).length,
        }
      }),
    }
  },

  async integracoes(companyId) {
    const { data: integrations } = await admin
      .from('integrations')
      .select('name, provider, is_active, last_run_at, last_status, last_error')
      .eq('company_id', companyId)
    return {
      integracoes: (integrations ?? []).map((i) => ({
        nome: i.name,
        provedor: i.provider,
        ativa: i.is_active,
        ultima_execucao: i.last_run_at,
        status: i.last_status,
        erro: i.last_status === 'error' ? i.last_error : null,
      })),
    }
  },
}

async function companyContext(companyId: string) {
  const { data: company } = await admin
    .from('companies')
    .select('name, sector, description')
    .eq('id', companyId)
    .maybeSingle()

  const modules = await Promise.all(Object.values(MODULE_READERS).map((read) => read(companyId)))

  return {
    escopo: 'empresa',
    empresa: company,
    ...Object.assign({}, ...modules),
    hoje: new Date().toISOString().slice(0, 10),
  }
}

async function holdingContext() {
  const [{ data: snapshots }, { data: metas }, { data: companies }, { data: integrations }, { data: budgets }] =
    await Promise.all([
      admin.rpc('company_snapshots'),
      admin
        .from('meta_latest_values')
        .select(
          'company_id, name, value, target_value, unit, direction, period_start, due_date, status, product_id, product_edition_id',
        )
        .limit(300),
      admin.from('companies').select('id, name, sector'),
      // Uma integração parada numa empresa explica um KPI congelado nela —
      // sinal de holding, não só de empresa.
      admin.from('integrations').select('company_id, name, is_active, last_status, last_run_at'),
      admin.from('budgets').select('id, company_id, title, status, event_date').limit(100),
    ])

  const byId = new Map((companies ?? []).map((c) => [c.id, c.name]))

  // Mesma cascata de 3 níveis do contexto de empresa — sem isso a IA veria
  // alvo de turma e alvo de empresa misturados na mesma lista, sem saber
  // que são grãos diferentes da mesma meta.
  const metaProductIds = [
    ...new Set((metas ?? []).map((m) => m.product_id).filter((id): id is string => Boolean(id))),
  ]
  const metaEditionIds = [
    ...new Set((metas ?? []).map((m) => m.product_edition_id).filter((id): id is string => Boolean(id))),
  ]
  const [{ data: metaProducts }, { data: metaEditions }] = await Promise.all([
    metaProductIds.length
      ? admin.from('products').select('id, name').in('id', metaProductIds)
      : { data: [] as { id: string; name: string }[] },
    metaEditionIds.length
      ? admin.from('product_editions').select('id, name').in('id', metaEditionIds)
      : { data: [] as { id: string; name: string }[] },
  ])
  const metaProductName = new Map((metaProducts ?? []).map((p) => [p.id, p.name]))
  const metaEditionName = new Map((metaEditions ?? []).map((e) => [e.id, e.name]))

  const budgetIds = (budgets ?? []).map((b) => b.id)
  const { data: budgetItems } = budgetIds.length
    ? await admin
        .from('budget_items')
        .select('budget_id, kind, planned_amount, actual_amount')
        .in('budget_id', budgetIds)
        .neq('status', 'cancelado')
    : { data: [] as { budget_id: string; kind: string; planned_amount: number; actual_amount: number | null }[] }

  return {
    escopo: 'holding',
    empresas: snapshots ?? [],
    metas_consolidadas: (metas ?? []).map((m) => ({
      empresa: byId.get(m.company_id) ?? m.company_id,
      nome: m.name,
      nivel: m.product_edition_id ? 'turma' : m.product_id ? 'produto' : 'empresa',
      produto: m.product_id ? (metaProductName.get(m.product_id) ?? null) : null,
      edicao: m.product_edition_id ? (metaEditionName.get(m.product_edition_id) ?? null) : null,
      valor: m.value === null ? null : Number(m.value),
      meta: m.target_value === null ? null : Number(m.target_value),
      unidade: m.unit,
      direcao: m.direction,
      periodo: m.period_start,
      prazo: m.due_date,
      andamento: m.status,
    })),
    integracoes_com_problema: (integrations ?? [])
      .filter((i) => i.is_active && i.last_status === 'error')
      .map((i) => ({ empresa: byId.get(i.company_id) ?? i.company_id, nome: i.name, ultima_execucao: i.last_run_at })),
    orcamentos: (budgets ?? []).map((budget) => {
      const rows = (budgetItems ?? []).filter((i) => i.budget_id === budget.id)
      const sum = (kind: string, field: 'planned_amount' | 'actual_amount') =>
        rows.filter((r) => r.kind === kind).reduce((acc, r) => acc + Number(r[field] ?? 0), 0)
      return {
        empresa: byId.get(budget.company_id) ?? budget.company_id,
        titulo: budget.title,
        situacao: budget.status,
        data_evento: budget.event_date,
        receita_prevista: sum('receita', 'planned_amount'),
        despesa_prevista: sum('despesa', 'planned_amount'),
        receita_realizada: sum('receita', 'actual_amount'),
        despesa_realizada: sum('despesa', 'actual_amount'),
      }
    }),
    hoje: new Date().toISOString().slice(0, 10),
  }
}

/**
 * Acha o ']' que realmente fecha o '[' inicial, contando colchetes/chaves e
 * ignorando os que aparecem dentro de strings. Antes isto pegava só o
 * primeiro '[' e o ÚLTIMO ']' do texto inteiro — quebrava sempre que a IA
 * devolvia um array vazio seguido de uma explicação em prosa que por acaso
 * continha outro colchete mais adiante (bem comum quando a empresa tem
 * pouquíssimo dado pra comentar).
 */
function matchingBracketEnd(text: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '[' || ch === '{') depth++
    else if (ch === ']' || ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function parseInsights(raw: string) {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = cleaned.indexOf('[')
  if (start === -1) throw new Error('A IA não devolveu um JSON reconhecível.')
  const end = matchingBracketEnd(cleaned, start)
  if (end === -1) throw new Error('A IA não devolveu um JSON reconhecível.')

  const parsed = JSON.parse(cleaned.slice(start, end + 1))
  if (!Array.isArray(parsed)) throw new Error('A IA não devolveu uma lista de insights.')

  return parsed
    .filter((item) => item && typeof item.title === 'string' && typeof item.body === 'string')
    .slice(0, 8)
    .map((item) => ({
      title: String(item.title).slice(0, 160),
      body: String(item.body),
      severity: SEVERITIES.includes(item.severity) ? item.severity : 'info',
      recommendation: item.recommendation ? String(item.recommendation) : null,
    }))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método não suportado' }, 405)

  let payload: Record<string, any>
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'JSON inválido' }, 400)
  }

  // Chamada agendada: pg_cron assina com o mesmo segredo que integrations-sync
  // já usa (não tem usuário logado às 7h da manhã) — valida o segredo em vez
  // de pedir Bearer token. Chamada manual (botão "Gerar Insights"): segue
  // exigindo login e permissão, como sempre.
  const providedSecret = req.headers.get('x-sync-secret')
  const isDailyCron = Boolean(providedSecret)
  let caller: { id: string; is_super_admin: boolean } | null = null

  if (isDailyCron) {
    const { data: expectedSecret } = await admin.rpc('get_system_setting', {
      p_key: 'sync_shared_secret',
    })
    if (!expectedSecret || providedSecret !== expectedSecret) {
      return json({ error: 'Assinatura inválida' }, 401)
    }
  } else {
    caller = await getCaller(req)
    if (!caller) return json({ error: 'Não autenticado' }, 401)
  }

  const scope = payload.scope === 'holding' ? 'holding' : 'company'
  const companyId: string | null = payload.company_id ?? null

  if (scope === 'holding') {
    if (!isDailyCron && !caller!.is_super_admin) return json({ error: 'Apenas o admin da holding.' }, 403)
  } else {
    if (!companyId) return json({ error: 'company_id obrigatório' }, 400)
    if (!isDailyCron && !caller!.is_super_admin) {
      const { data: membership } = await admin
        .from('company_members')
        .select('role')
        .eq('company_id', companyId)
        .eq('user_id', caller!.id)
        .maybeSingle()
      if (membership?.role !== 'admin') {
        return json({ error: 'Apenas administradores da empresa geram insights.' }, 403)
      }
    }
  }

  const { data: configuredProvider } = await admin.rpc('get_system_setting', {
    p_key: 'ai_provider',
  })
  const provider: Provider = configuredProvider === 'anthropic' ? 'anthropic' : 'gemini'
  const keyName = provider === 'anthropic' ? 'anthropic_api_key' : 'gemini_api_key'

  const { data: apiKey } = await admin.rpc('get_system_setting', { p_key: keyName })
  if (!apiKey) {
    return json(
      {
        error: `Configure a chave do ${
          provider === 'anthropic' ? 'Claude (Anthropic)' : 'Gemini (Google)'
        } em Holding → Configurações antes de gerar insights.`,
      },
      400,
    )
  }

  const { data: configuredModel } = await admin.rpc('get_system_setting', { p_key: 'insights_model' })
  let model = (configuredModel as string | null) ?? ''

  const context = scope === 'holding' ? await holdingContext() : await companyContext(companyId!)

  // No resumo automático de todo dia, além dos insights de sempre, pede pra
  // IA nomear explicitamente o que precisa de atenção HOJE — vencimento de
  // hoje, meta em risco — não só o padrão "3 a 6 insights do mais crítico".
  const userMessage = isDailyCron
    ? `Resumo automático de hoje (${new Date().toISOString().slice(0, 10)}). Além dos insights de sempre, ` +
      `garanta que ao menos um insight liste as prioridades de HOJE especificamente — tarefa vencendo hoje ` +
      `ou já vencida, alvo em risco, meta fora do alvo que pede ação imediata.\n\n` +
      `Retrato atual em JSON:\n\n${JSON.stringify(context, null, 2)}`
    : `Retrato atual em JSON:\n\n${JSON.stringify(context, null, 2)}`

  let insights: ReturnType<typeof parseInsights>
  try {
    // Sem modelo escolhido, pergunta ao provedor o que existe hoje em vez de
    // apostar num identificador que pode ter sido aposentado.
    if (!model) {
      const available = await listModels(provider, apiKey as string)
      model = pickDefaultModel(provider, available) ?? ''
      if (!model) throw new Error('O provedor não devolveu nenhum modelo utilizável.')
      await admin.rpc('set_system_setting', { p_key: 'insights_model', p_value: model })
    }

    const text = await generateText(provider, apiKey as string, model, SYSTEM_PROMPT, userMessage)
    insights = parseInsights(text)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Falha ao consultar a IA' }, 502)
  }

  if (!insights.length) return json({ error: 'A IA não gerou insights desta vez.' }, 502)

  const rows = insights.map((item) => ({
    company_id: scope === 'holding' ? null : companyId,
    scope,
    title: item.title,
    body: item.body,
    severity: item.severity,
    recommendation: item.recommendation,
    model,
    generated_by: caller?.id ?? null,
    payload: {},
  }))

  const { data: inserted, error } = await admin.from('insights').insert(rows).select()
  if (error) return json({ error: error.message }, 500)

  // Gerado sozinho de madrugada — sem notificação ninguém saberia que
  // chegou insight novo até abrir a tela por acaso.
  if (isDailyCron && inserted?.length) {
    const link = scope === 'holding' ? '/holding/insights' : `/empresa/${companyId}/insights`
    let recipientIds: string[] = []
    if (scope === 'holding') {
      const { data: admins } = await admin
        .from('profiles')
        .select('id')
        .eq('is_super_admin', true)
        .eq('is_active', true)
      recipientIds = (admins ?? []).map((row) => row.id)
    } else {
      const { data: members } = await admin
        .from('company_members')
        .select('user_id')
        .eq('company_id', companyId!)
        .eq('role', 'admin')
      recipientIds = (members ?? []).map((row) => row.user_id)
    }

    if (recipientIds.length) {
      await admin.from('notifications').insert(
        recipientIds.map((userId) => ({
          user_id: userId,
          company_id: scope === 'holding' ? null : companyId,
          kind: 'daily_insights',
          title:
            inserted.length === 1
              ? 'Novo insight do dia'
              : `${inserted.length} novos insights do dia`,
          body: inserted[0].title,
          link,
        })),
      )
    }
  }

  return json({ insights: inserted })
})
