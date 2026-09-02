// Ápice Holding — administração de usuários.
// Criação de acesso com senha padrão, reset de senha, papéis e exclusão.
// Roda com service_role, mas só depois de validar quem está chamando.
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

type Role = 'admin' | 'collaborator' | 'viewer'
const ROLES: Role[] = ['admin', 'collaborator', 'viewer']

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
    .select('id, email, is_super_admin, is_active')
    .eq('id', data.user.id)
    .maybeSingle()

  if (!profile || !profile.is_active) return null
  return profile as { id: string; email: string; is_super_admin: boolean; is_active: boolean }
}

async function isCompanyAdmin(userId: string, companyId: string) {
  const { data } = await admin
    .from('company_members')
    .select('role')
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .maybeSingle()
  return data?.role === 'admin'
}

async function defaultPassword() {
  const { data } = await admin.rpc('get_system_setting', { p_key: 'default_password' })
  return (data as string | null) ?? 'Apice@2026'
}

async function audit(
  actorId: string,
  companyId: string | null,
  action: string,
  entityId: string,
  meta: Record<string, unknown> = {},
) {
  await admin.from('audit_logs').insert({
    actor_id: actorId,
    company_id: companyId,
    action,
    entity: 'user',
    entity_id: entityId,
    meta,
  })
}

// Quem pode administrar usuários daquela empresa.
async function assertCanManage(
  caller: { id: string; is_super_admin: boolean },
  companyId: string | null,
) {
  if (caller.is_super_admin) return
  if (!companyId) throw new Error('Apenas o admin da holding pode executar esta ação.')
  if (!(await isCompanyAdmin(caller.id, companyId))) {
    throw new Error('Você não é administrador desta empresa.')
  }
}

// Um admin de empresa só mexe em quem já é membro daquela empresa.
async function assertTargetInScope(
  caller: { id: string; is_super_admin: boolean },
  targetId: string,
  companyId: string | null,
) {
  if (caller.is_super_admin) return
  const { data } = await admin
    .from('company_members')
    .select('user_id')
    .eq('company_id', companyId!)
    .eq('user_id', targetId)
    .maybeSingle()
  if (!data) throw new Error('Usuário não pertence a esta empresa.')

  const { data: target } = await admin
    .from('profiles')
    .select('is_super_admin')
    .eq('id', targetId)
    .maybeSingle()
  if (target?.is_super_admin) throw new Error('Somente a holding administra um super admin.')
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

  const action = String(payload.action ?? '')
  const companyId: string | null = payload.company_id ?? null

  try {
    switch (action) {
      // ---------------------------------------------------------------- criar
      case 'create_user': {
        await assertCanManage(caller, companyId)

        const email = String(payload.email ?? '').trim().toLowerCase()
        if (!email || !email.includes('@')) return json({ error: 'E-mail inválido' }, 400)

        const role: Role = ROLES.includes(payload.role) ? payload.role : 'viewer'
        const makeSuperAdmin = Boolean(payload.is_super_admin) && caller.is_super_admin
        const password = await defaultPassword()

        const { data: existing } = await admin
          .from('profiles')
          .select('id')
          .eq('email', email)
          .maybeSingle()

        // E-mail já cadastrado: só a holding pode vincular uma conta que já
        // existe a outra empresa (a pessoa pode já estar em outro lugar do
        // grupo, ou ser o próprio super admin). Sem essa trava, um admin de
        // UMA empresa poderia — só sabendo o e-mail — anexar qualquer conta
        // existente (de outra empresa, ou até a de um super admin) ao seu
        // próprio time com o papel que quisesse, e sobrescrever o perfil dela.
        if (existing && !caller.is_super_admin) {
          return json(
            { error: 'Este e-mail já tem uma conta no sistema. Peça ao administrador da holding para vincular esta pessoa à sua empresa.' },
            403,
          )
        }

        let userId = existing?.id as string | undefined
        let created = false

        if (!userId) {
          const { data, error } = await admin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: {
              full_name: String(payload.full_name ?? '').trim(),
              must_change_password: true,
            },
          })
          if (error) return json({ error: error.message }, 400)
          userId = data.user.id
          created = true
        }

        await admin
          .from('profiles')
          .update({
            full_name: String(payload.full_name ?? '').trim() || email.split('@')[0],
            job_title: payload.job_title ?? null,
            phone: payload.phone ?? null,
            is_active: true,
            ...(makeSuperAdmin ? { is_super_admin: true } : {}),
          })
          .eq('id', userId!)

        if (companyId) {
          await admin
            .from('company_members')
            .upsert({ company_id: companyId, user_id: userId!, role }, { onConflict: 'company_id,user_id' })
        }

        await audit(caller.id, companyId, created ? 'user.created' : 'user.linked', userId!, { email, role })

        return json({
          user_id: userId,
          created,
          // A senha padrão volta uma única vez para o admin repassar ao usuário.
          temporary_password: created ? password : null,
        })
      }

      // -------------------------------------------------------- resetar senha
      case 'reset_password': {
        const targetId = String(payload.user_id ?? '')
        if (!targetId) return json({ error: 'user_id obrigatório' }, 400)
        await assertCanManage(caller, companyId)
        await assertTargetInScope(caller, targetId, companyId)

        const password = await defaultPassword()
        const { error } = await admin.auth.admin.updateUserById(targetId, { password })
        if (error) return json({ error: error.message }, 400)

        await admin.from('profiles').update({ must_change_password: true }).eq('id', targetId)
        await audit(caller.id, companyId, 'user.password_reset', targetId)

        return json({ ok: true, temporary_password: password })
      }

      // ------------------------------------------------------- ativar/inativar
      case 'set_active': {
        const targetId = String(payload.user_id ?? '')
        const isActive = Boolean(payload.is_active)
        if (!targetId) return json({ error: 'user_id obrigatório' }, 400)
        if (targetId === caller.id) return json({ error: 'Você não pode inativar a si mesmo.' }, 400)
        await assertCanManage(caller, companyId)
        await assertTargetInScope(caller, targetId, companyId)

        await admin.from('profiles').update({ is_active: isActive }).eq('id', targetId)
        await audit(caller.id, companyId, isActive ? 'user.activated' : 'user.deactivated', targetId)
        return json({ ok: true })
      }

      // ------------------------------------------------------------ papel
      case 'set_role': {
        const targetId = String(payload.user_id ?? '')
        const role: Role = ROLES.includes(payload.role) ? payload.role : 'viewer'
        if (!targetId || !companyId) return json({ error: 'user_id e company_id obrigatórios' }, 400)
        await assertCanManage(caller, companyId)
        await assertTargetInScope(caller, targetId, companyId)

        await admin
          .from('company_members')
          .upsert({ company_id: companyId, user_id: targetId, role }, { onConflict: 'company_id,user_id' })
        await audit(caller.id, companyId, 'user.role_changed', targetId, { role })
        return json({ ok: true })
      }

      // ------------------------------------------------- tirar de uma empresa
      case 'remove_member': {
        const targetId = String(payload.user_id ?? '')
        if (!targetId || !companyId) return json({ error: 'user_id e company_id obrigatórios' }, 400)
        await assertCanManage(caller, companyId)
        await assertTargetInScope(caller, targetId, companyId)

        await admin
          .from('company_members')
          .delete()
          .eq('company_id', companyId)
          .eq('user_id', targetId)
        await audit(caller.id, companyId, 'user.removed_from_company', targetId)
        return json({ ok: true })
      }

      // ---------------------------------------------- excluir do sistema todo
      case 'delete_user': {
        const targetId = String(payload.user_id ?? '')
        if (!targetId) return json({ error: 'user_id obrigatório' }, 400)
        if (!caller.is_super_admin) {
          return json({ error: 'Somente o admin da holding exclui um cadastro.' }, 403)
        }
        if (targetId === caller.id) return json({ error: 'Você não pode excluir a si mesmo.' }, 400)

        const { data: target } = await admin
          .from('profiles')
          .select('email')
          .eq('id', targetId)
          .maybeSingle()

        const { error } = await admin.auth.admin.deleteUser(targetId)
        if (error) return json({ error: error.message }, 400)

        await audit(caller.id, null, 'user.deleted', targetId, { email: target?.email ?? null })
        return json({ ok: true })
      }

      // ------------------------------------------------------- super admin
      case 'set_super_admin': {
        const targetId = String(payload.user_id ?? '')
        if (!caller.is_super_admin) return json({ error: 'Apenas a holding faz isso.' }, 403)
        if (!targetId) return json({ error: 'user_id obrigatório' }, 400)
        if (targetId === caller.id) return json({ error: 'Você não pode rebaixar a si mesmo.' }, 400)

        await admin
          .from('profiles')
          .update({ is_super_admin: Boolean(payload.value) })
          .eq('id', targetId)
        await audit(caller.id, null, 'user.super_admin_changed', targetId, { value: Boolean(payload.value) })
        return json({ ok: true })
      }

      default:
        return json({ error: `Ação desconhecida: ${action}` }, 400)
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erro inesperado' }, 403)
  }
})
