// Acessos: o admin cadastra o e-mail, o sistema entrega a senha padrão e
// obriga a troca no primeiro login. Reset e exclusão também moram aqui.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { KeyRound, Plus, ShieldCheck, Trash2, UserMinus, UserX } from 'lucide-react'
import { supabase } from '../../core/lib/supabase'
import { callFunction } from '../../core/lib/supabase'
import { formatDateTime, initials } from '../../core/lib/format'
import { useAuth } from '../../core/auth/AuthProvider'
import { useCompany } from '../../core/company/CompanyProvider'
import {
  Badge,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorText,
  Field,
  Loading,
  Modal,
  PageHeader,
  Spinner,
  useToast,
} from '../../core/ui'
import { ROLE_HINT, ROLE_LABEL, type Company, type Profile, type Role } from '../../core/types'

type MemberRow = { user_id: string; company_id: string; role: Role }

const ROLES: Role[] = ['admin', 'collaborator', 'viewer']

function roleTone(role: Role) {
  return role === 'admin' ? 'violet' : role === 'collaborator' ? 'blue' : 'slate'
}

/** Mostra a senha temporária uma única vez, para o admin repassar. */
function TemporaryPassword({ value, onClose }: { value: string; onClose: () => void }) {
  return (
    <Modal
      open
      title="Senha padrão gerada"
      description="Anote agora — ela não é exibida de novo."
      onClose={onClose}
      width="max-w-md"
      footer={
        <button type="button" className="btn-primary" onClick={onClose}>
          Entendi
        </button>
      }
    >
      <p className="text-sm text-content-muted">
        Passe esta senha para o usuário. No primeiro login o sistema obriga a troca.
      </p>
      <p className="mt-3 rounded-lg border border-line bg-hover px-4 py-3 text-center font-mono text-lg">
        {value}
      </p>
    </Modal>
  )
}

// ---------------------------------------------------------------- formulário
function CreateUserModal({
  open,
  onClose,
  onCreated,
  companies,
  fixedCompanyId,
  allowSuperAdmin,
}: {
  open: boolean
  onClose: () => void
  onCreated: (temporaryPassword: string | null) => void
  companies: Company[]
  fixedCompanyId?: string
  allowSuperAdmin: boolean
}) {
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [companyId, setCompanyId] = useState(fixedCompanyId ?? '')
  const [role, setRole] = useState<Role>('viewer')
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setEmail('')
    setFullName('')
    setJobTitle('')
    setRole('viewer')
    setIsSuperAdmin(false)
    setError('')
    setCompanyId(fixedCompanyId ?? companies[0]?.id ?? '')
  }, [open, fixedCompanyId, companies])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const result = await callFunction<{ temporary_password: string | null; created: boolean }>(
        'admin-users',
        {
          action: 'create_user',
          email,
          full_name: fullName,
          job_title: jobTitle || null,
          company_id: companyId || null,
          role,
          is_super_admin: isSuperAdmin,
        },
      )
      onCreated(result.temporary_password)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar o acesso.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Novo acesso"
      description="O usuário entra com a senha padrão e troca no primeiro login."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="new-user-form" className="btn-primary" disabled={busy}>
            {busy && <Spinner />}
            Criar acesso
          </button>
        </>
      }
    >
      <form id="new-user-form" onSubmit={submit} className="space-y-4">
        <Field label="E-mail">
          <input
            className="input"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="pessoa@empresa.com.br"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome completo">
            <input
              className="input"
              required
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          </Field>
          <Field label="Cargo">
            <input
              className="input"
              value={jobTitle}
              onChange={(event) => setJobTitle(event.target.value)}
            />
          </Field>
        </div>

        {!fixedCompanyId && (
          <Field label="Empresa">
            <select
              className="input"
              value={companyId}
              onChange={(event) => setCompanyId(event.target.value)}
            >
              <option value="">Nenhuma por enquanto</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Papel nesta empresa" hint={ROLE_HINT[role]}>
          <select
            className="input"
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
          >
            {ROLES.map((item) => (
              <option key={item} value={item}>
                {ROLE_LABEL[item]}
              </option>
            ))}
          </select>
        </Field>

        {allowSuperAdmin && (
          <label className="flex items-start gap-2 rounded-lg border border-line bg-hover p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={isSuperAdmin}
              onChange={(event) => setIsSuperAdmin(event.target.checked)}
            />
            <span>
              <strong>Administrador da holding</strong>
              <span className="block text-xs text-content-soft">
                Enxerga e edita todas as empresas do grupo. Use com parcimônia.
              </span>
            </span>
          </label>
        )}

        {error && <ErrorText>{error}</ErrorText>}
      </form>
    </Modal>
  )
}

// ------------------------------------------------------------------ empresa
function CompanyUsers() {
  const { company, isAdmin } = useCompany()
  const { profile } = useAuth()
  const { notify } = useToast()
  const [members, setMembers] = useState<MemberRow[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const [pending, setPending] = useState<{ kind: 'reset' | 'remove'; user: Profile } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: memberRows } = await supabase
      .from('company_members')
      .select('user_id, company_id, role')
      .eq('company_id', company.id)

    const ids = (memberRows ?? []).map((row) => row.user_id)
    const { data: profileRows } = ids.length
      ? await supabase.from('profiles').select('*').in('id', ids)
      : { data: [] as Profile[] }

    setMembers((memberRows as MemberRow[]) ?? [])
    setProfiles((profileRows as Profile[]) ?? [])
    setLoading(false)
  }, [company.id])

  useEffect(() => {
    void load()
  }, [load])

  const rows = useMemo(
    () =>
      members
        .map((member) => ({
          member,
          user: profiles.find((item) => item.id === member.user_id),
        }))
        .filter((row): row is { member: MemberRow; user: Profile } => Boolean(row.user))
        .sort((a, b) => a.user.full_name.localeCompare(b.user.full_name)),
    [members, profiles],
  )

  const run = async (body: Record<string, unknown>, successMessage: string) => {
    setBusy(true)
    try {
      const result = await callFunction<{ temporary_password?: string }>('admin-users', body)
      notify(successMessage)
      if (result?.temporary_password) setTempPassword(result.temporary_password)
      await load()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Falhou.', 'error')
    } finally {
      setBusy(false)
      setPending(null)
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={`Equipe · ${company.name}`}
        subtitle="Quem enxerga esta empresa — e o que cada um pode fazer."
        actions={
          isAdmin && (
            <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Novo acesso
            </button>
          )
        }
      />

      <Card>
        {loading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Ninguém vinculado ainda"
            description="Cadastre o e-mail da pessoa para liberar o acesso a esta empresa."
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map(({ member, user }) => (
              <li key={user.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-hover text-xs font-semibold text-content-muted">
                  {initials(user.full_name || user.email)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-content">
                    {user.full_name}
                    {user.id === profile?.id && (
                      <span className="ml-1.5 text-xs font-normal text-content-faint">(você)</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-content-soft">{user.email}</p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {user.is_super_admin && <Badge tone="violet">Holding</Badge>}
                  {!user.is_active && <Badge tone="amber">Inativo</Badge>}
                  {user.must_change_password && <Badge tone="blue">1º acesso pendente</Badge>}
                </div>

                {isAdmin && user.id !== profile?.id ? (
                  <select
                    className="input w-auto py-1.5 text-xs"
                    value={member.role}
                    disabled={busy}
                    onChange={(event) =>
                      void run(
                        {
                          action: 'set_role',
                          company_id: company.id,
                          user_id: user.id,
                          role: event.target.value,
                        },
                        'Papel atualizado.',
                      )
                    }
                  >
                    {ROLES.map((item) => (
                      <option key={item} value={item}>
                        {ROLE_LABEL[item]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Badge tone={roleTone(member.role)}>{ROLE_LABEL[member.role]}</Badge>
                )}

                {isAdmin && user.id !== profile?.id && (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-content-faint hover:bg-hover hover:text-content"
                      title="Resetar senha"
                      onClick={() => setPending({ kind: 'reset', user })}
                    >
                      <KeyRound className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-content-faint hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400"
                      title="Remover desta empresa"
                      onClick={() => setPending({ kind: 'remove', user })}
                    >
                      <UserMinus className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <CreateUserModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(password) => {
          if (password) setTempPassword(password)
          notify('Acesso criado.')
          void load()
        }}
        companies={[company]}
        fixedCompanyId={company.id}
        allowSuperAdmin={false}
      />

      <ConfirmDialog
        open={pending?.kind === 'reset'}
        title="Resetar senha"
        busy={busy}
        confirmLabel="Resetar"
        message={
          <>
            A senha de <strong>{pending?.user.full_name}</strong> volta para a senha padrão e o
            sistema exige uma nova no próximo login.
          </>
        }
        onConfirm={() =>
          void run(
            { action: 'reset_password', company_id: company.id, user_id: pending?.user.id },
            'Senha resetada.',
          )
        }
        onCancel={() => setPending(null)}
      />

      <ConfirmDialog
        open={pending?.kind === 'remove'}
        title="Remover da empresa"
        danger
        busy={busy}
        confirmLabel="Remover"
        message={
          <>
            <strong>{pending?.user.full_name}</strong> deixa de ver os dados de {company.name}. O
            cadastro continua existindo para as outras empresas.
          </>
        }
        onConfirm={() =>
          void run(
            { action: 'remove_member', company_id: company.id, user_id: pending?.user.id },
            'Usuário removido da empresa.',
          )
        }
        onCancel={() => setPending(null)}
      />

      {tempPassword && (
        <TemporaryPassword value={tempPassword} onClose={() => setTempPassword(null)} />
      )}
    </div>
  )
}

// ------------------------------------------------------------------ holding
function HoldingUsers() {
  const { profile } = useAuth()
  const { notify } = useToast()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [members, setMembers] = useState<MemberRow[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const [pending, setPending] = useState<{
    kind: 'reset' | 'delete' | 'deactivate'
    user: Profile
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: profileRows }, { data: memberRows }, { data: companyRows }] = await Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('company_members').select('user_id, company_id, role'),
      supabase.from('companies').select('*').eq('is_active', true).order('name'),
    ])
    setProfiles((profileRows as Profile[]) ?? [])
    setMembers((memberRows as MemberRow[]) ?? [])
    setCompanies((companyRows as Company[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (body: Record<string, unknown>, successMessage: string) => {
    setBusy(true)
    try {
      const result = await callFunction<{ temporary_password?: string }>('admin-users', body)
      notify(successMessage)
      if (result?.temporary_password) setTempPassword(result.temporary_password)
      await load()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Falhou.', 'error')
    } finally {
      setBusy(false)
      setPending(null)
    }
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return profiles
    return profiles.filter(
      (item) =>
        item.full_name.toLowerCase().includes(term) || item.email.toLowerCase().includes(term),
    )
  }, [profiles, search])

  const companyName = (id: string) => companies.find((item) => item.id === id)?.name ?? '—'

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Usuários do grupo"
        subtitle="Todo cadastro do sistema, com as empresas que cada um enxerga."
        actions={
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Novo acesso
          </button>
        }
      />

      <Card>
        <input
          className="input mb-4 max-w-sm"
          placeholder="Buscar por nome ou e-mail…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        {loading ? (
          <Loading />
        ) : filtered.length === 0 ? (
          <EmptyState title="Nenhum usuário encontrado" />
        ) : (
          <ul className="divide-y divide-line">
            {filtered.map((user) => {
              const userCompanies = members.filter((item) => item.user_id === user.id)
              const isSelf = user.id === profile?.id
              return (
                <li key={user.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-hover text-xs font-semibold text-content-muted">
                      {initials(user.full_name || user.email)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-content">
                        {user.full_name}
                        {isSelf && (
                          <span className="ml-1.5 text-xs font-normal text-content-faint">(você)</span>
                        )}
                      </p>
                      <p className="truncate text-xs text-content-soft">
                        {user.email} · último acesso {formatDateTime(user.last_login_at)}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {user.is_super_admin && <Badge tone="violet">Admin da holding</Badge>}
                      {!user.is_active && <Badge tone="amber">Inativo</Badge>}
                      {user.must_change_password && <Badge tone="blue">1º acesso pendente</Badge>}
                    </div>

                    {!isSelf && (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="rounded-md p-1.5 text-content-faint hover:bg-hover hover:text-content"
                          title={
                            user.is_super_admin
                              ? 'Tirar admin da holding'
                              : 'Tornar admin da holding'
                          }
                          onClick={() =>
                            void run(
                              {
                                action: 'set_super_admin',
                                user_id: user.id,
                                value: !user.is_super_admin,
                              },
                              'Permissão atualizada.',
                            )
                          }
                        >
                          <ShieldCheck
                            className={`h-4 w-4 ${user.is_super_admin ? 'text-violet-600' : ''}`}
                          />
                        </button>
                        <button
                          type="button"
                          className="rounded-md p-1.5 text-content-faint hover:bg-hover hover:text-content"
                          title="Resetar senha"
                          onClick={() => setPending({ kind: 'reset', user })}
                        >
                          <KeyRound className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="rounded-md p-1.5 text-content-faint hover:bg-amber-500/10 hover:text-amber-600 dark:text-amber-400"
                          title={user.is_active ? 'Inativar' : 'Reativar'}
                          onClick={() =>
                            user.is_active
                              ? setPending({ kind: 'deactivate', user })
                              : void run(
                                  { action: 'set_active', user_id: user.id, is_active: true },
                                  'Usuário reativado.',
                                )
                          }
                        >
                          <UserX className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="rounded-md p-1.5 text-content-faint hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400"
                          title="Excluir cadastro"
                          onClick={() => setPending({ kind: 'delete', user })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5 pl-12">
                    {userCompanies.length === 0 && !user.is_super_admin && (
                      <span className="text-xs text-content-faint">Sem empresa vinculada</span>
                    )}
                    {userCompanies.map((membership) => (
                      <Badge key={membership.company_id} tone={roleTone(membership.role)}>
                        {companyName(membership.company_id)} · {ROLE_LABEL[membership.role]}
                      </Badge>
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <CreateUserModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(password) => {
          if (password) setTempPassword(password)
          notify('Acesso criado.')
          void load()
        }}
        companies={companies}
        allowSuperAdmin
      />

      <ConfirmDialog
        open={pending?.kind === 'reset'}
        title="Resetar senha"
        busy={busy}
        confirmLabel="Resetar"
        message={
          <>
            A senha de <strong>{pending?.user.full_name}</strong> volta para a senha padrão e o
            sistema exige uma nova no próximo login.
          </>
        }
        onConfirm={() => void run({ action: 'reset_password', user_id: pending?.user.id }, 'Senha resetada.')}
        onCancel={() => setPending(null)}
      />

      <ConfirmDialog
        open={pending?.kind === 'deactivate'}
        title="Inativar usuário"
        busy={busy}
        confirmLabel="Inativar"
        message={
          <>
            <strong>{pending?.user.full_name}</strong> perde o acesso ao sistema, mas o histórico
            e os vínculos continuam preservados.
          </>
        }
        onConfirm={() =>
          void run(
            { action: 'set_active', user_id: pending?.user.id, is_active: false },
            'Usuário inativado.',
          )
        }
        onCancel={() => setPending(null)}
      />

      <ConfirmDialog
        open={pending?.kind === 'delete'}
        title="Excluir cadastro"
        danger
        busy={busy}
        confirmLabel="Excluir definitivamente"
        message={
          <>
            O cadastro de <strong>{pending?.user.full_name}</strong> some do sistema e de todas as
            empresas. Se você só quer bloquear o acesso, prefira inativar.
          </>
        }
        onConfirm={() => void run({ action: 'delete_user', user_id: pending?.user.id }, 'Cadastro excluído.')}
        onCancel={() => setPending(null)}
      />

      {tempPassword && (
        <TemporaryPassword value={tempPassword} onClose={() => setTempPassword(null)} />
      )}
    </div>
  )
}

export default function UsersPage({ scope }: { scope: 'company' | 'holding' }) {
  return scope === 'company' ? <CompanyUsers /> : <HoldingUsers />
}
