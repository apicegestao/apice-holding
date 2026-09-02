// Tema claro, escuro ou o que o sistema operacional estiver usando.
// A escolha fica no navegador de cada pessoa, então não depende de servidor.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type ThemeChoice = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'apice-holding:tema'

function readStored(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // navegador sem storage (janela anônima, cookies bloqueados)
  }
  return 'system'
}

function systemPrefersDark() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

const ThemeContext = createContext<{
  theme: ThemeChoice
  resolved: 'light' | 'dark'
  setTheme: (theme: ThemeChoice) => void
} | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>(readStored)
  const [systemDark, setSystemDark] = useState(systemPrefersDark)

  // No modo automático, seguir o sistema em tempo real — sem recarregar a página.
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const resolved: 'light' | 'dark' =
    theme === 'system' ? (systemDark ? 'dark' : 'light') : theme

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolved === 'dark' ? '#0D0E13' : '#F6F7F9')
  }, [resolved])

  const setTheme = useCallback((next: ThemeChoice) => {
    setThemeState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // sem storage, a escolha vale só para esta sessão
    }
  }, [])

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme precisa estar dentro de <ThemeProvider>')
  return context
}

/** Cores dos gráficos que mudam com o tema — o Recharts recebe valor, não classe. */
export function useChartTheme() {
  const { resolved } = useTheme()
  return useMemo(
    () =>
      resolved === 'dark'
        ? {
            grid: '#333542',
            tick: '#A3A9B9',
            axis: '#4C4F5F',
            reference: '#6B7280',
            tooltipBg: '#20212B',
            tooltipBorder: '#4C4F5F',
            tooltipText: '#EDEFF5',
            label: '#B2B7C6',
          }
        : {
            grid: '#E2E6EC',
            tick: '#5A6476',
            axis: '#BDC4CF',
            reference: '#94A3B8',
            tooltipBg: '#FFFFFF',
            tooltipBorder: '#E2E6EC',
            tooltipText: '#14141C',
            label: '#475569',
          },
    [resolved],
  )
}
