// Configurações internas da holding: provedor de IA, chaves, modelo e a senha
// padrão do primeiro acesso. Somente super admin. As chaves nunca voltam em
// texto puro — só mascaradas.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { listModels, type Provider } from './providers.ts'

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

const EDITABLE = new Set([
  'ai_provider',
  'gemini_api_key',
  'anthropic_api_key',
  'insights_model',
  'default_password',
])
const SECRET = new Set(['gemini_api_key', 'anthropic_api_key'])

function mask(key: string, value: string | null) {
  if (!value) return null
  if (!SECRET.has(key)) return value
  return value.length <= 8 ? '••••' : `${value.slice(0, 4)}••••${value.slice(-4)}`
}

async function requireSuperAdmin(req: Request) {
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

  return profile?.is_super_admin && profile.is_active ? (profile.id as string) : null
}

async function readSetting(key: string) {
  const { data } = await admin.rpc('get_system_setting', { p_key: key })
  return (data as string | null) ?? null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método não suportado' }, 405)

  const callerId = await requireSuperAdmin(req)
  if (!callerId) return json({ error: 'Apenas o admin da holding acessa as configurações.' }, 403)

  let payload: Record<string, any>
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'JSON inválido' }, 400)
  }

  // ------------------------------------------------------------------ ler
  if (payload.action === 'list') {
    const settings: Record<string, string | null> = {}
    for (const key of EDITABLE) {
      settings[key] = mask(key, await readSetting(key))
    }
    // O padrão é o Gemini enquanto ninguém escolher outro.
    settings.ai_provider = settings.ai_provider ?? 'gemini'
    return json({ settings })
  }

  // -------------------------------------------------------------- gravar
  if (payload.action === 'set') {
    const key = String(payload.key ?? '')
    const value = String(payload.value ?? '')
    if (!EDITABLE.has(key)) return json({ error: 'Configuração não editável' }, 400)
    if (!value) return json({ error: 'Valor obrigatório' }, 400)
    if (key === 'ai_provider' && !['gemini', 'anthropic'].includes(value)) {
      return json({ error: 'Provedor inválido' }, 400)
    }

    const { error } = await admin.rpc('set_system_setting', { p_key: key, p_value: value })
    if (error) return json({ error: error.message }, 400)

    // Trocar de provedor invalida o modelo escolhido para o anterior.
    if (key === 'ai_provider') {
      await admin.rpc('set_system_setting', { p_key: 'insights_model', p_value: '' })
    }

    await admin.from('audit_logs').insert({
      actor_id: callerId,
      action: 'settings.updated',
      entity: 'system_setting',
      entity_id: key,
      meta: SECRET.has(key) ? {} : { value },
    })
    return json({ ok: true })
  }

  // ------------------------------------------------- modelos disponíveis
  // Perguntamos ao provedor em vez de manter uma lista fixa no código, que
  // envelhece a cada lançamento.
  if (payload.action === 'list_models') {
    const provider: Provider =
      payload.provider === 'anthropic'
        ? 'anthropic'
        : payload.provider === 'gemini'
          ? 'gemini'
          : ((await readSetting('ai_provider')) as Provider) ?? 'gemini'

    const keyName = provider === 'anthropic' ? 'anthropic_api_key' : 'gemini_api_key'
    const apiKey = await readSetting(keyName)
    if (!apiKey) {
      return json({ error: 'Salve a chave deste provedor antes de listar os modelos.' }, 400)
    }

    try {
      const models = await listModels(provider, apiKey)
      return json({ provider, models })
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : 'Falha ao listar modelos' }, 502)
    }
  }

  return json({ error: 'Ação desconhecida' }, 400)
})
