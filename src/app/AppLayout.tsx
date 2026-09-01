// Casca do sistema: abas de empresa no topo (cada aba = uma empresa isolada),
// menu do módulo na lateral e o conteúdo da rota no meio.
import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  Bell,
  Building2,
  Cable,
  ChevronDown,
  ClipboardList,
  Gauge,
  LayoutGrid,
  ListChecks,
  LogOut,
  Network,
  ScrollText,
  Settings,
  Sparkles,
  Target,
  Users,
} from 'lucide-react'
import { useAuth } from '../core/auth/AuthProvider'
import { Logo } from '../core/ui/Logo'
import { supabase } from '../core/lib/supabase'
import { formatDateTime, initials } from '../core/lib/format'
import { ROLE_LABEL, type Notification } from '../core/types'

type NavItem = { to: string; label: string; icon: typeof Gauge; end?: boolean }

export default function AppLayout() {
  const { profile, memberships, isSuperAdmin, signOut } = useAuth()
  const { companyId } = useParams<{ companyId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [bellOpen, setBellOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])

  const onHolding = location.pathname.startsWith('/holding')
  const activeMembership = memberships.find((item) => item.company.id === companyId)

  useEffect(() => {
    let active = true
    const load = async () => {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20)
      if (active) setNotifications((data as Notification[]) ?? [])
    }
    void load()
    const timer = setInterval(load, 120_000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])

  const unread = notifications.filter((item) => !item.read_at).length

  const markAllRead = async () => {
    const ids = notifications.filter((item) => !item.read_at).map((item) => item.id)
    if (!ids.length) return
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids)
    setNotifications((current) =>
      current.map((item) => (item.read_at ? item : { ...item, read_at: new Date().toISOString() })),
    )
  }

  const navItems = useMemo<NavItem[]>(() => {
    if (onHolding) {
      return [
        { to: '/holding', label: 'Painel da holding', icon: LayoutGrid, end: true },
        { to: '/holding/empresas', label: 'Empresas', icon: Building2 },
        { to: '/holding/usuarios', label: 'Usuários', icon: Users },
        { to: '/holding/insights', label: 'Insights de IA', icon: Sparkles },
        { to: '/holding/auditoria', label: 'Auditoria', icon: ScrollText },
        { to: '/holding/configuracoes', label: 'Configurações', icon: Settings },
      ]
    }
    if (!companyId) return []
    const base = `/empresa/${companyId}`
    const items: NavItem[] = [
      { to: base, label: 'Painel', icon: Gauge, end: true },
      { to: `${base}/kpis`, label: 'KPIs', icon: ListChecks },
      { to: `${base}/metas`, label: 'Metas', icon: Target },
      { to: `${base}/tarefas`, label: 'Tarefas', icon: ClipboardList },
      { to: `${base}/mapa-mental`, label: 'Mapa mental', icon: Network },
      { to: `${base}/equipe`, label: 'Equipe', icon: Users },
    ]
    if (activeMembership?.role === 'admin' || isSuperAdmin) {
      items.push(
        { to: `${base}/integracoes`, label: 'Integrações', icon: Cable },
        { to: `${base}/insights`, label: 'Insights de IA', icon: Sparkles },
        { to: `${base}/auditoria`, label: 'Auditoria', icon: ScrollText },
        { to: `${base}/configuracoes`, label: 'Dados da empresa', icon: Settings },
      )
    }
    return items
  }, [onHolding, companyId, activeMembership?.role, isSuperAdmin])

  const tabs = memberships.filter((item) => !item.company.is_holding)
  const holdingCompany = memberships.find((item) => item.company.is_holding)

  return (
    <div className="flex min-h-full flex-col">
      {/* ------------------------------------------------------------ topo */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-slate-50 text-ink-900">
        <div className="flex items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
          <button type="button" onClick={() => navigate('/')} className="text-left">
            <Logo size={28} withWordmark subtitle="Gestão do grupo" />
          </button>

          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setBellOpen((open) => !open)
                  setMenuOpen(false)
                }}
                className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-ink-900"
                aria-label="Notificações"
              >
                <Bell className="h-4 w-4" />
                {unread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </button>
              {bellOpen && (
                <div className="absolute right-0 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white text-ink-900 shadow-card">
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Notificações
                    </span>
                    <button
                      type="button"
                      className="text-xs text-brand-600 hover:underline"
                      onClick={() => void markAllRead()}
                    >
                      Marcar como lidas
                    </button>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifications.length === 0 && (
                      <p className="px-4 py-6 text-center text-sm text-slate-500">
                        Nada por aqui ainda.
                      </p>
                    )}
                    {notifications.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setBellOpen(false)
                          if (item.link) navigate(item.link)
                        }}
                        className={`block w-full border-b border-slate-50 px-4 py-3 text-left hover:bg-slate-50 ${
                          item.read_at ? '' : 'bg-brand-50/50'
                        }`}
                      >
                        <p className="text-sm font-medium">{item.title}</p>
                        {item.body && <p className="text-xs text-slate-500">{item.body}</p>}
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          {formatDateTime(item.created_at)}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen((open) => !open)
                  setBellOpen(false)
                }}
                className="flex items-center gap-2 rounded-lg py-1.5 pl-1.5 pr-2 hover:bg-slate-100"
              >
                <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-500 text-xs font-semibold">
                  {initials(profile?.full_name || profile?.email || '?')}
                </span>
                <span className="hidden text-sm sm:block">{profile?.full_name}</span>
                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white text-ink-900 shadow-card">
                  <div className="border-b border-slate-100 px-4 py-3">
                    <p className="text-sm font-medium">{profile?.full_name}</p>
                    <p className="text-xs text-slate-500">{profile?.email}</p>
                    {isSuperAdmin && (
                      <p className="mt-1 text-[11px] font-medium text-brand-600">
                        Administrador da holding
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    className="block w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50"
                    onClick={() => {
                      setMenuOpen(false)
                      navigate('/perfil')
                    }}
                  >
                    Meu perfil
                  </button>
                  <button
                    type="button"
                    className="block w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50"
                    onClick={() => {
                      setMenuOpen(false)
                      navigate('/trocar-senha')
                    }}
                  >
                    Trocar senha
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-left text-sm text-rose-600 hover:bg-rose-50"
                    onClick={() => void signOut()}
                  >
                    <LogOut className="h-4 w-4" /> Sair
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* --------------------------------------------------- abas de empresa */}
        <nav className="flex gap-1 overflow-x-auto px-2 sm:px-4">
          {(isSuperAdmin || holdingCompany) && (
            <NavLink
              to="/holding"
              className={() =>
                `flex shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-sm transition ${
                  onHolding
                    ? 'border-brand-500 font-semibold text-ink-900'
                    : 'border-transparent text-slate-500 hover:text-ink-900'
                }`
              }
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Holding
            </NavLink>
          )}
          {tabs.map(({ company, role }) => {
            const active = company.id === companyId
            return (
              <NavLink
                key={company.id}
                to={`/empresa/${company.id}`}
                title={`${company.name} — ${ROLE_LABEL[role]}`}
                className={`flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm transition ${
                  active
                    ? 'border-brand-500 font-semibold text-ink-900'
                    : 'border-transparent text-slate-500 hover:text-ink-900'
                }`}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: company.color }}
                />
                {company.name}
              </NavLink>
            )
          })}
          {isSuperAdmin && (
            <NavLink
              to="/holding/empresas"
              className="flex shrink-0 items-center gap-1 border-b-2 border-transparent px-3 py-2.5 text-sm text-slate-500 hover:text-ink-900"
            >
              + Empresa
            </NavLink>
          )}
        </nav>
      </header>

      {/* -------------------------------------------------------- conteúdo */}
      <div className="flex flex-1 flex-col lg:flex-row">
        {navItems.length > 0 && (
          <aside className="shrink-0 border-b border-slate-200 bg-white lg:w-60 lg:border-b-0 lg:border-r">
            <nav className="flex gap-1 overflow-x-auto p-3 lg:flex-col lg:overflow-visible">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                      isActive
                        ? 'bg-brand-50 font-medium text-brand-700'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`
                  }
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </aside>
        )}

        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
