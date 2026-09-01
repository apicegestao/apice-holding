// Configurações internas da holding (chave da IA, senha padrão do 1º acesso).
// Somente super admin. Valores nunca voltam em texto puro — só mascarados.
import { createClient } from 'jsr:@supabase/supabase-js@2'

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

// Chaves que o admin pode gerenciar pela interface.
const EDITABLE = new Set(['anthropic_api_key', 'default_password', 'insights_model'])
const SECRET = new Set(['anthropic_api_key'])

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

  return profile?.is_super_admin && profile.is_active ? profile.id as string : null
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

  if (payload.action === 'list') {
    const out: Record<string, string | null> = {}
    for (const key of EDITABLE) {
      const { data } = await admin.rpc('get_system_setting', { p_key: key })
      out[key] = mask(key, data as string | null)
    }
    return json({ settings: out })
  }

  if (payload.action === 'set') {
    const key = String(payload.key ?? '')
    const value = String(payload.value ?? '')
    if (!EDITABLE.has(key)) return json({ error: 'Configuração não editável' }, 400)
    if (!value) return json({ error: 'Valor obrigatório' }, 400)

    const { error } = await admin.rpc('set_system_setting', { p_key: key, p_value: value })
    if (error) return json({ error: error.message }, 400)

    await admin.from('audit_logs').insert({
      actor_id: callerId,
      action: 'settings.updated',
      entity: 'system_setting',
      entity_id: key,
      meta: SECRET.has(key) ? {} : { value },
    })
    return json({ ok: true })
  }

  return json({ error: 'Ação desconhecida' }, 400)
})
