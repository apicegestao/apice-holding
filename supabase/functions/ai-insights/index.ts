// Geração de insights com IA (Claude) para o admin da empresa ou da holding.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk@0.71.0'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
Recebe um retrato em JSON com KPIs, metas e tarefas e devolve insights acionáveis para o administrador.

Regras:
- Responda SEMPRE em português do Brasil.
- Trabalhe apenas com os números fornecidos. Nunca invente dados que não estão no retrato.
- Se os dados forem insuficientes para uma conclusão, diga isso explicitamente em vez de especular.
- Priorize o que muda decisão: KPI fora da meta, meta em risco, tarefa vencida, tendência de queda.
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

async function companyContext(companyId: string) {
  const [company, kpis, goals, tasks] = await Promise.all([
    admin.from('companies').select('name, sector, description').eq('id', companyId).maybeSingle(),
    admin
      .from('kpis')
      .select('id, name, unit, direction, frequency, target_value, category')
      .eq('company_id', companyId)
      .eq('is_active', true),
    admin
      .from('goals')
      .select('title, status, target_value, current_value, due_date')
      .eq('company_id', companyId)
      .order('due_date', { ascending: true })
      .limit(30),
    admin
      .from('tasks')
      .select('title, status, priority, due_date')
      .eq('company_id', companyId)
      .in('status', ['todo', 'doing', 'blocked'])
      .order('due_date', { ascending: true })
      .limit(50),
  ])

  const kpiIds = (kpis.data ?? []).map((k) => k.id)
  let history: Record<string, { period: string; value: number }[]> = {}

  if (kpiIds.length) {
    const { data: values } = await admin
      .from('kpi_values')
      .select('kpi_id, period_start, value')
      .in('kpi_id', kpiIds)
      .order('period_start', { ascending: false })
      .limit(400)

    for (const row of values ?? []) {
      const bucket = (history[row.kpi_id] ??= [])
      if (bucket.length < 8) bucket.push({ period: row.period_start, value: Number(row.value) })
    }
  }

  return {
    escopo: 'empresa',
    empresa: company.data,
    kpis: (kpis.data ?? []).map((k) => ({
      nome: k.name,
      categoria: k.category,
      unidade: k.unit,
      // "up" = quanto maior melhor
      direcao: k.direction,
      frequencia: k.frequency,
      meta: k.target_value === null ? null : Number(k.target_value),
      ultimos_valores: (history[k.id] ?? []).slice().reverse(),
    })),
    metas: goals.data ?? [],
    tarefas_abertas: tasks.data ?? [],
    hoje: new Date().toISOString().slice(0, 10),
  }
}

async function holdingContext() {
  const { data: snapshots } = await admin.rpc('company_snapshots')
  const { data: kpis } = await admin
    .from('kpi_latest_values')
    .select('company_id, name, value, target_value, unit, direction, period_start')
    .eq('roll_up', true)
    .limit(300)

  const { data: companies } = await admin.from('companies').select('id, name, sector')
  const byId = new Map((companies ?? []).map((c) => [c.id, c.name]))

  return {
    escopo: 'holding',
    empresas: snapshots ?? [],
    kpis_consolidados: (kpis ?? []).map((k) => ({
      empresa: byId.get(k.company_id) ?? k.company_id,
      nome: k.name,
      valor: Number(k.value),
      meta: k.target_value === null ? null : Number(k.target_value),
      unidade: k.unit,
      direcao: k.direction,
      periodo: k.period_start,
    })),
    hoje: new Date().toISOString().slice(0, 10),
  }
}

function parseInsights(raw: string) {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start === -1 || end === -1) throw new Error('A IA não devolveu um JSON reconhecível.')

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

  const caller = await getCaller(req)
  if (!caller) return json({ error: 'Não autenticado' }, 401)

  let payload: Record<string, any>
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'JSON inválido' }, 400)
  }

  const scope = payload.scope === 'holding' ? 'holding' : 'company'
  const companyId: string | null = payload.company_id ?? null

  if (scope === 'holding') {
    if (!caller.is_super_admin) return json({ error: 'Apenas o admin da holding.' }, 403)
  } else {
    if (!companyId) return json({ error: 'company_id obrigatório' }, 400)
    if (!caller.is_super_admin) {
      const { data: membership } = await admin
        .from('company_members')
        .select('role')
        .eq('company_id', companyId)
        .eq('user_id', caller.id)
        .maybeSingle()
      if (membership?.role !== 'admin') {
        return json({ error: 'Apenas administradores da empresa geram insights.' }, 403)
      }
    }
  }

  const { data: apiKey } = await admin.rpc('get_system_setting', { p_key: 'anthropic_api_key' })
  if (!apiKey) {
    return json(
      { error: 'Configure a chave da Anthropic em Holding → Configurações antes de gerar insights.' },
      400,
    )
  }

  const { data: configuredModel } = await admin.rpc('get_system_setting', { p_key: 'insights_model' })
  const model = (configuredModel as string | null) ?? 'claude-opus-5'

  const context = scope === 'holding' ? await holdingContext() : await companyContext(companyId!)

  let insights: ReturnType<typeof parseInsights>
  try {
    const client = new Anthropic({ apiKey: apiKey as string })
    const response = await client.messages.create({
      model,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      messages: [
        {
          role: 'user',
          content: `Retrato atual em JSON:\n\n${JSON.stringify(context, null, 2)}`,
        },
      ],
    })

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { text: string }).text)
      .join('\n')

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
    generated_by: caller.id,
    payload: {},
  }))

  const { data: inserted, error } = await admin.from('insights').insert(rows).select()
  if (error) return json({ error: error.message }, 500)

  return json({ insights: inserted })
})
