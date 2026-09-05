// Casca do sistema: abas de empresa no topo (cada aba = uma empresa isolada),
// menu do módulo na lateral e o conteúdo da rota no meio.
import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  Bell,
  Boxes,
  Building2,
  Cable,
  ChevronDown,
  ClipboardList,
  Contact2,
  Gauge,
  LayoutGrid,
  Landmark,
  Layers,
  LogOut,
  ScrollText,
  Monitor,
  Moon,
  Settings,
  Sparkles,
  StickyNote,
  Sun,
  Target,
  Users,
} from 'lucide-react'
import { useAuth } from '../core/auth/AuthProvider'
import CompanySwitcher from './CompanySwitcher'
import { useTheme, type ThemeChoice } from '../core/theme/ThemeProvider'
import { Logo } from '../core/ui/Logo'
import { supabase } from '../core/lib/supabase'
import { formatDateTime, initials } from '../core/lib/format'
import { useClickOutside } from '../core/lib/useClickOutside'
import { useToast } from '../core/ui'
import type { Notification } from '../core/types'

// `matchPrefixes` cobre entradas de menu que, por dentro, viram duas rotas
// distintas com abas internas (Financeiro/Orçamentos) — o item do menu deve
// continuar destacado em ambas, não só na rota que leva o nome dele.
type NavItem = { to: string; label: string; icon: typeof Gauge; end?: boolean; matchPrefixes?: string[] }

const THEMES: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Escuro', icon: Moon },
  { value: 'system', label: 'Automático', icon: Monitor },
]

export default function AppLayout() {
  const { profile, memberships, isSuperAdmin, signOut } = useAuth()
  const { notify } = useToast()
  const { theme, setTheme } = useTheme()
  const { companyId } = useParams<{ companyId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [bellOpen, setBellOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  // null enquanto não sabemos ainda (evita esconder o item e mostrar de
  // novo um instante depois) — só vira false quando a busca confirma que
  // não existe nenhum indicador de nível empresa. Agora que todo indicador
  // de produto/turma nasce de dentro de Produtos, esta entrada de menu só
  // faz sentido pra quem tem algo que não pertence a nenhum produto.
  const [hasCompanyLevelKpis, setHasCompanyLevelKpis] = useState<boolean | null>(null)
  const bellRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useClickOutside(bellRef, bellOpen, () => setBellOpen(false))
  useClickOutside(menuRef, menuOpen, () => setMenuOpen(false))

  const onHolding = location.pathname.startsWith('/holding')
  const activeMembership = memberships.find((item) => item.company.id === companyId)

  useEffect(() => {
    if (!companyId) return
    let active = true
    setHasCompanyLevelKpis(null)
    void supabase
      .from('kpis')
      .select('id')
      .eq('company_id', companyId)
      .is('product_id', null)
      .eq('is_active', true)
      .is('archived_at', null)
      .limit(1)
      .then(({ data }) => {
        if (active) setHasCompanyLevelKpis((data?.length ?? 0) > 0)
      })
    return () => {
      active = false
    }
  }, [companyId])

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
    const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids)
    if (error) {
      notify(error.message, 'error')
      return
    }
    setNotifications((current) =>
      current.map((item) => (item.read_at ? item : { ...item, read_at: new Date().toISOString() })),
    )
  }

  // Clicar numa notificação (não só o botão "Marcar como lidas") também
  // marca ela como lida — sem isso o contador de não lidas nunca baixava
  // de quem só clicava pra navegar até o link.
  const openNotification = async (item: Notification) => {
    setBellOpen(false)
    if (item.link) navigate(item.link)
    if (item.read_at) return
    const readAt = new Date().toISOString()
    setNotifications((current) => current.map((n) => (n.id === item.id ? { ...n, read_at: readAt } : n)))
    const { error } = await supabase.from('notifications').update({ read_at: readAt }).eq('id', item.id)
    if (error) notify(error.message, 'error')
  }

  const navItems = useMemo<NavItem[]>(() => {
    if (onHolding) {
      return [
        { to: '/holding', label: 'Painel da Holding', icon: LayoutGrid, end: true },
        { to: '/holding/tarefas', label: 'Tarefas', icon: ClipboardList },
        { to: '/holding/empresas', label: 'Empresas', icon: Building2 },
        { to: '/holding/usuarios', label: 'Usuários', icon: Users },
        { to: '/holding/notas', label: 'Notas', icon: StickyNote },
        {
          to: '/holding/financeiro',
          label: 'Financeiro',
          icon: Landmark,
          matchPrefixes: ['/holding/orcamentos'],
        },
        { to: '/holding/insights', label: 'Insights de IA', icon: Sparkles },
        { to: '/holding/auditoria', label: 'Auditoria', icon: ScrollText },
        { to: '/holding/configuracoes', label: 'Configurações', icon: Settings },
      ]
    }
    if (!companyId) return []
    const base = `/empresa/${companyId}`
    const items: NavItem[] = [
      { to: base, label: 'Painel', icon: Gauge, end: true },
      { to: `${base}/produtos`, label: 'Produtos', icon: Layers },
      // Indicador de produto/turma nasce de dentro de Produtos — esta
      // entrada só serve pra indicador que não é de nenhum produto (ex.
      // NPS de time, margem consolidada), por isso só aparece quando existe
      // pelo menos um (hasCompanyLevelKpis === null enquanto não sabemos
      // ainda, e por padrão o item fica visível pra não sumir e voltar).
      ...(hasCompanyLevelKpis !== false
        ? [{ to: `${base}/kpis`, label: 'Indicadores da empresa', icon: Target }]
        : []),
      { to: `${base}/tarefas`, label: 'Tarefas', icon: ClipboardList },
      { to: `${base}/areas`, label: 'Áreas', icon: Boxes },
      { to: `${base}/contatos`, label: 'Contatos', icon: Contact2 },
      { to: `${base}/notas`, label: 'Notas', icon: StickyNote },
      {
        to: `${base}/financeiro`,
        label: 'Financeiro',
        icon: Landmark,
        matchPrefixes: [`${base}/orcamentos`],
      },
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
  }, [onHolding, companyId, activeMembership?.role, isSuperAdmin, hasCompanyLevelKpis])

  const tabs = memberships.filter((item) => !item.company.is_holding)
  const holdingCompany = memberships.find((item) => item.company.is_holding)

  return (
    <div className="flex min-h-full flex-col">
      {/* ------------------------------------------------------------ topo */}
      <header className="sticky top-0 z-40 border-b border-line bg-surface text-content">
        <div className="flex items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
          <button type="button" onClick={() => navigate('/')} className="text-left">
            <Logo size={34} withWordmark subtitle="Gestão do grupo" />
          </button>

          <div className="flex items-center gap-2">
            <div ref={bellRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setBellOpen((open) => !open)
                  setMenuOpen(false)
                }}
                className="relative rounded-lg p-2 text-content-soft hover:bg-hover hover:text-content"
                aria-label="Notificações"
                aria-expanded={bellOpen}
              >
                <Bell className="h-4 w-4" />
                {unread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </button>
              {bellOpen && (
                // Fixo em relação à tela (não ao cabeçalho) no celular: assim o
                // painel nunca fica espremido/atrás da barra de troca de empresa
                // nem sai da tela, e o cabeçalho ("Marcar como lidas") continua
                // sempre visível e clicável. A partir de sm volta a ser o menu
                // suspenso normal ancorado no sino.
                <div className="fixed inset-x-3 top-16 z-50 flex max-h-[75vh] flex-col overflow-hidden rounded-xl border border-line bg-elevated text-content shadow-card sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-none sm:w-80">
                  <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-2.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-content-soft">
                      Notificações
                    </span>
                    <button
                      type="button"
                      className="text-xs text-brand-text hover:underline"
                      onClick={() => void markAllRead()}
                    >
                      Marcar como lidas
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto sm:max-h-80 sm:flex-none">
                    {notifications.length === 0 && (
                      <p className="px-4 py-6 text-center text-sm text-content-soft">
                        Nada por aqui ainda.
                      </p>
                    )}
                    {notifications.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => void openNotification(item)}
                        className={`flex w-full items-start gap-2 border-b border-line px-4 py-3 text-left hover:bg-hover ${
                          item.read_at ? '' : 'bg-brand/10'
                        }`}
                      >
                        {/* Bolinha de "não lida" — a tinta de fundo sozinha não
                            é acessível o bastante (só cor, sem texto/ícone). */}
                        <span
                          className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${item.read_at ? '' : 'bg-brand'}`}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">
                            {item.title}
                            {!item.read_at && <span className="sr-only"> (não lida)</span>}
                          </span>
                          {item.body && <span className="block text-xs text-content-soft">{item.body}</span>}
                          <span className="mt-0.5 block text-[11px] text-content-faint">
                            {formatDateTime(item.created_at)}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div ref={menuRef} className="relative min-w-0">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen((open) => !open)
                  setBellOpen(false)
                }}
                className="flex min-w-0 items-center gap-2 rounded-lg py-1.5 pl-1.5 pr-2 hover:bg-hover"
                aria-expanded={menuOpen}
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand/100 text-xs font-semibold">
                  {initials(profile?.full_name || profile?.email || '?')}
                </span>
                <span className="hidden max-w-[10rem] truncate text-sm sm:block">{profile?.full_name}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-content-faint" />
              </button>
              {menuOpen && (
                <div className="fixed inset-x-3 top-16 z-50 max-h-[75vh] overflow-y-auto rounded-xl border border-line bg-elevated text-content shadow-card sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-none sm:w-[17rem] sm:overflow-hidden">
                  <div className="border-b border-line px-4 py-3">
                    <p className="text-sm font-medium">{profile?.full_name}</p>
                    <p className="text-xs text-content-soft">{profile?.email}</p>
                    {isSuperAdmin && (
                      <p className="mt-1 text-[11px] font-medium text-brand-text">
                        Administrador da holding
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    className="block w-full px-4 py-2.5 text-left text-sm hover:bg-hover"
                    onClick={() => {
                      setMenuOpen(false)
                      navigate('/perfil')
                    }}
                  >
                    Meu perfil
                  </button>
                  <button
                    type="button"
                    className="block w-full px-4 py-2.5 text-left text-sm hover:bg-hover"
                    onClick={() => {
                      setMenuOpen(false)
                      navigate('/trocar-senha')
                    }}
                  >
                    Trocar senha
                  </button>
                  <div className="border-t border-line px-4 py-3">
                    <p className="label">Tema</p>
                    <div className="grid grid-cols-3 gap-1">
                      {THEMES.map((item) => (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => setTheme(item.value)}
                          title={item.label}
                          className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] transition ${
                            theme === item.value
                              ? 'border-brand-500 bg-brand/10 font-medium text-brand-text'
                              : 'border-line-strong text-content-muted hover:bg-hover'
                          }`}
                        >
                          <item.icon className="h-3.5 w-3.5" />
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="flex w-full items-center gap-2 border-t border-line px-4 py-2.5 text-left text-sm text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
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
        <CompanySwitcher
          isSuperAdmin={isSuperAdmin}
          onHolding={onHolding}
          holdingCompany={holdingCompany}
          tabs={tabs}
          activeCompanyId={companyId}
        />
      </header>

      {/* -------------------------------------------------------- conteúdo */}
      <div className="flex flex-1 flex-col lg:flex-row">
        {navItems.length > 0 && (
          <aside className="shrink-0 border-b border-line bg-surface lg:w-60 lg:border-b-0 lg:border-r">
            <nav className="flex gap-1 overflow-x-auto p-3 lg:flex-col lg:overflow-visible">
              {navItems.map((item) => {
                const extraActive = item.matchPrefixes?.some((prefix) => location.pathname.startsWith(prefix))
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                        isActive || extraActive
                          ? 'bg-brand/10 font-medium text-brand-text'
                          : 'text-content-muted hover:bg-hover'
                      }`
                    }
                  >
                    <item.icon className="h-4 w-4" />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                )
              })}
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
