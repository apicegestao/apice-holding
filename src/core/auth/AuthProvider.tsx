// Sessão, perfil e vínculos com empresas. É aqui que o app descobre
// "quem sou eu, em quais empresas eu entro e com qual papel".
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Company, Profile, Role } from '../types'

type Membership = { company: Company; role: Role }

type AuthValue = {
  session: Session | null
  profile: Profile | null
  memberships: Membership[]
  loading: boolean
  isSuperAdmin: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  changePassword: (newPassword: string) => Promise<void>
  refresh: () => Promise<void>
  roleIn: (companyId: string | null | undefined) => Role | null
  canWrite: (companyId: string | null | undefined) => boolean
  isCompanyAdmin: (companyId: string | null | undefined) => boolean
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [loading, setLoading] = useState(true)
  const loadedFor = useRef<string | null>(null)

  const loadContext = useCallback(async (userId: string) => {
    const [{ data: profileRow }, { data: memberRows }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('company_members').select('role, company_id').eq('user_id', userId),
    ])

    const nextProfile = (profileRow as Profile | null) ?? null
    setProfile(nextProfile)

    // A RLS já limita o SELECT às empresas visíveis; o super admin enxerga todas.
    const { data: companyRows } = await supabase
      .from('companies')
      .select('*')
      .eq('is_active', true)
      .order('is_holding', { ascending: false })
      .order('display_order', { ascending: true })
      .order('name', { ascending: true })

    const roleByCompany = new Map((memberRows ?? []).map((row) => [row.company_id, row.role as Role]))

    setMemberships(
      (companyRows ?? []).map((company) => ({
        company: company as Company,
        role: nextProfile?.is_super_admin ? 'admin' : (roleByCompany.get(company.id) ?? 'viewer'),
      })),
    )
  }, [])

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      if (!data.session) setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (!nextSession) {
        loadedFor.current = null
        setProfile(null)
        setMemberships([])
        setLoading(false)
      }
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const userId = session?.user?.id
    if (!userId) return
    // O onAuthStateChange dispara também em refresh de token; recarregar
    // o contexto inteiro a cada disparo faria a tela piscar sem motivo.
    if (loadedFor.current === userId) return

    loadedFor.current = userId
    setLoading(true)
    loadContext(userId)
      .catch(() => {
        setProfile(null)
        setMemberships([])
      })
      .finally(() => setLoading(false))
  }, [session?.user?.id, loadContext])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    if (error) {
      throw new Error(
        error.message === 'Invalid login credentials'
          ? 'E-mail ou senha incorretos.'
          : error.message,
      )
    }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const changePassword = useCallback(
    async (newPassword: string) => {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw new Error(error.message)

      const userId = session?.user?.id
      if (userId) {
        await supabase
          .from('profiles')
          .update({ must_change_password: false, last_login_at: new Date().toISOString() })
          .eq('id', userId)
        await loadContext(userId)
      }
    },
    [session?.user?.id, loadContext],
  )

  const refresh = useCallback(async () => {
    const userId = session?.user?.id
    if (userId) await loadContext(userId)
  }, [session?.user?.id, loadContext])

  const roleIn = useCallback(
    (companyId: string | null | undefined): Role | null => {
      if (!companyId) return null
      if (profile?.is_super_admin) return 'admin'
      return memberships.find((m) => m.company.id === companyId)?.role ?? null
    },
    [memberships, profile?.is_super_admin],
  )

  const value = useMemo<AuthValue>(
    () => ({
      session,
      profile,
      memberships,
      loading,
      isSuperAdmin: Boolean(profile?.is_super_admin),
      signIn,
      signOut,
      changePassword,
      refresh,
      roleIn,
      canWrite: (companyId) => {
        const role = roleIn(companyId)
        return role === 'admin' || role === 'collaborator'
      },
      isCompanyAdmin: (companyId) => roleIn(companyId) === 'admin',
    }),
    [session, profile, memberships, loading, signIn, signOut, changePassword, refresh, roleIn],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth precisa estar dentro de <AuthProvider>')
  return context
}
