// Puxa dados de sistemas externos (REST) e grava nos KPIs da empresa.
// Dois modos de entrada:
//  - agendado: pg_cron chama assinando o header x-sync-secret;
//  - manual: admin da empresa clica em "Sincronizar agora" (JWT no Authorization).
// verify_jwt fica desligado porque o cron não tem JWT — a autorização é feita aqui.
import { createClient } from 'jsr:@supabase/supabase-js@2'

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

type Integration = {
  id: string
  company_id: string
  name: string
  base_url: string
  http_method: string
  request_body: unknown
  headers: Record<string, string>
  auth_type: string
  auth_header: string
  sync_interval_minutes: number
  last_run_at: string | null
}

// Resolve caminhos tipo "data.totais[0].receita" dentro do JSON da resposta.
function resolvePath(source: unknown, path: string): unknown {
  const segments = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)

  let current: any = source
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined
    current = current[segment]
  }
  return current
}

function toNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'string') {
    // Aceita "R$ 1.234,56" e "1234.56".
    const normalized = raw
      .replace(/[^\d,.-]/g, '')
      .replace(/\.(?=\d{3}\b)/g, '')
      .replace(',', '.')
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function periodFor(mode: string, now = new Date()) {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const d = now.getUTCDate()
  const iso = (date: Date) => date.toISOString().slice(0, 10)

  switch (mode) {
    case 'current_day':
      return { start: iso(new Date(Date.UTC(y, m, d))), end: iso(new Date(Date.UTC(y, m, d))) }
    case 'current_week': {
      const weekday = new Date(Date.UTC(y, m, d)).getUTCDay()
      const monday = new Date(Date.UTC(y, m, d - ((weekday + 6) % 7)))
      const sunday = new Date(monday)
      sunday.setUTCDate(monday.getUTCDate() + 6)
      return { start: iso(monday), end: iso(sunday) }
    }
    case 'current_quarter': {
      const firstMonth = Math.floor(m / 3) * 3
      return {
        start: iso(new Date(Date.UTC(y, firstMonth, 1))),
        end: iso(new Date(Date.UTC(y, firstMonth + 3, 0))),
      }
    }
    case 'current_year':
      return { start: iso(new Date(Date.UTC(y, 0, 1))), end: iso(new Date(Date.UTC(y, 11, 31))) }
    case 'current_month':
    default:
      return { start: iso(new Date(Date.UTC(y, m, 1))), end: iso(new Date(Date.UTC(y, m + 1, 0))) }
  }
}

// Bloqueia SSRF óbvio: quem configura "base_url" é um admin de UMA empresa,
// mas o fetch roda do lado do servidor com acesso que essa pessoa não tem —
// sem essa checagem, dava pra apontar a integração pra um endereço interno
// (localhost, metadados de nuvem, rede privada) e usar o próprio Ápice como
// ponte pra sondar essas redes.
const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal'])

function isPrivateIp(ip: string): boolean {
  if (ip === '0.0.0.0' || ip === '::' || ip === '::1') return true
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (v4) {
    const [a, b] = v4.slice(1).map(Number)
    if (a === 127) return true // loopback
    if (a === 10) return true // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
    if (a === 192 && b === 168) return true // 192.168.0.0/16
    if (a === 169 && b === 254) return true // link-local, inclui metadados de nuvem
    return false
  }
  const lower = ip.toLowerCase()
  return lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd') // link-local / fc00::/7
}

async function assertPublicUrl(rawUrl: string) {
  const url = new URL(rawUrl)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Só endereços http:// ou https:// podem ser usados numa integração.')
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (BLOCKED_HOSTNAMES.has(hostname) || isPrivateIp(hostname)) {
    throw new Error('Este endereço aponta para uma rede interna e não pode ser usado numa integração.')
  }
  // Um domínio público também pode ter sido apontado de propósito pra um IP
  // privado — confere a resolução real quando o runtime permitir. Se a API
  // não estiver disponível aqui, segue só com as checagens acima.
  try {
    const records = await Deno.resolveDns(hostname, 'A')
    if (records.some(isPrivateIp)) {
      throw new Error('Este endereço aponta para uma rede interna e não pode ser usado numa integração.')
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('rede interna')) throw err
  }
}

async function runIntegration(integration: Integration, triggerSource: string) {
  const { data: run } = await admin
    .from('integration_runs')
    .insert({
      integration_id: integration.id,
      company_id: integration.company_id,
      status: 'running',
      trigger_source: triggerSource,
    })
    .select()
    .single()

  const finish = async (status: 'success' | 'error', records: number, error: string | null) => {
    if (run) {
      await admin
        .from('integration_runs')
        .update({ status, records, error, finished_at: new Date().toISOString() })
        .eq('id', run.id)
    }
    await admin
      .from('integrations')
      .update({ last_run_at: new Date().toISOString(), last_status: status, last_error: error })
      .eq('id', integration.id)
    return { integration: integration.name, status, records, error }
  }

  try {
    const { data: secret } = await admin
      .from('integration_secrets')
      .select('auth_value')
      .eq('integration_id', integration.id)
      .maybeSingle()

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(integration.headers ?? {}),
    }

    if (integration.auth_type !== 'none' && secret?.auth_value) {
      const headerName = integration.auth_header || 'Authorization'
      headers[headerName] =
        integration.auth_type === 'bearer'
          ? `Bearer ${secret.auth_value}`
          : integration.auth_type === 'basic'
            ? `Basic ${btoa(secret.auth_value)}`
            : secret.auth_value
    }

    const init: RequestInit = { method: integration.http_method, headers }
    if (integration.http_method === 'POST') {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(integration.request_body ?? {})
    }

    await assertPublicUrl(integration.base_url)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20_000)
    let response: Response
    try {
      response = await fetch(integration.base_url, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      return await finish('error', 0, `HTTP ${response.status} ao chamar ${integration.name}`)
    }

    const body = await response.json()

    const { data: mappings } = await admin
      .from('integration_mappings')
      .select('kpi_id, json_path, multiplier, period_mode')
      .eq('integration_id', integration.id)

    let records = 0
    const problems: string[] = []

    for (const mapping of mappings ?? []) {
      const value = toNumber(resolvePath(body, mapping.json_path))
      if (value === null) {
        problems.push(`caminho "${mapping.json_path}" não retornou número`)
        continue
      }

      const period = periodFor(mapping.period_mode)
      const { error } = await admin.from('kpi_values').upsert(
        {
          kpi_id: mapping.kpi_id,
          company_id: integration.company_id,
          period_start: period.start,
          period_end: period.end,
          value: value * Number(mapping.multiplier ?? 1),
          source: 'integration',
        },
        { onConflict: 'kpi_id,period_start' },
      )

      if (error) problems.push(error.message)
      else records += 1
    }

    return await finish(
      problems.length && records === 0 ? 'error' : 'success',
      records,
      problems.length ? problems.join('; ') : null,
    )
  } catch (err) {
    return await finish('error', 0, err instanceof Error ? err.message : 'Erro inesperado')
  }
}

function isDue(integration: Integration, now: Date) {
  if (!integration.sync_interval_minutes) return false
  if (!integration.last_run_at) return true
  const elapsed = now.getTime() - new Date(integration.last_run_at).getTime()
  return elapsed >= integration.sync_interval_minutes * 60_000
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método não suportado' }, 405)

  let payload: Record<string, any> = {}
  try {
    payload = await req.json()
  } catch {
    payload = {}
  }

  const providedSecret = req.headers.get('x-sync-secret')
  const { data: expectedSecret } = await admin.rpc('get_system_setting', {
    p_key: 'sync_shared_secret',
  })

  // ------------------------------------------------------------- agendado
  if (providedSecret) {
    if (!expectedSecret || providedSecret !== expectedSecret) {
      return json({ error: 'Assinatura inválida' }, 401)
    }

    const now = new Date()
    const { data: integrations } = await admin
      .from('integrations')
      .select('*')
      .eq('is_active', true)
      .gt('sync_interval_minutes', 0)

    const due = (integrations ?? []).filter((i) => isDue(i as Integration, now)).slice(0, 25)
    const results = []
    for (const integration of due) {
      results.push(await runIntegration(integration as Integration, 'cron'))
    }
    return json({ ran: results.length, results })
  }

  // --------------------------------------------------------------- manual
  const authorization = req.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return json({ error: 'Não autenticado' }, 401)

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })
  const { data: auth, error: authError } = await userClient.auth.getUser()
  if (authError || !auth.user) return json({ error: 'Não autenticado' }, 401)

  const integrationId = String(payload.integration_id ?? '')
  if (!integrationId) return json({ error: 'integration_id obrigatório' }, 400)

  const { data: integration } = await admin
    .from('integrations')
    .select('*')
    .eq('id', integrationId)
    .maybeSingle()

  if (!integration) return json({ error: 'Integração não encontrada' }, 404)

  const { data: profile } = await admin
    .from('profiles')
    .select('is_super_admin, is_active')
    .eq('id', auth.user.id)
    .maybeSingle()

  if (!profile?.is_active) return json({ error: 'Usuário inativo' }, 403)

  if (!profile.is_super_admin) {
    const { data: membership } = await admin
      .from('company_members')
      .select('role')
      .eq('company_id', integration.company_id)
      .eq('user_id', auth.user.id)
      .maybeSingle()
    if (membership?.role !== 'admin') {
      return json({ error: 'Apenas administradores da empresa sincronizam integrações.' }, 403)
    }
  }

  const result = await runIntegration(integration as Integration, 'manual')
  return json(result)
})
