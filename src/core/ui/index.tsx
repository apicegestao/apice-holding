// Kit de interface compartilhado. Todo módulo consome daqui — assim um ajuste
// visual acontece em um lugar só.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from 'lucide-react'

export { NumberInput } from './NumberInput'
export { Logo } from './Logo'

// ------------------------------------------------------------------ blocos
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-content">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-content-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Card({
  title,
  description,
  actions,
  children,
  className = '',
}: {
  title?: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            {title && <h2 className="text-sm font-semibold text-content">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-content-soft">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  )
}

export function Field({
  label,
  hint,
  children,
  className = '',
  asGroup = false,
}: {
  label: string
  hint?: string
  children: ReactNode
  className?: string
  /** Para conjuntos de botões ou chips: <label> colaria o texto do rótulo
   *  no nome acessível de cada botão. */
  asGroup?: boolean
}) {
  const content = (
    <>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-content-faint">{hint}</span>}
    </>
  )

  if (asGroup) {
    return (
      <div role="group" aria-label={label} className={`block ${className}`}>
        {content}
      </div>
    )
  }

  return <label className={`block ${className}`}>{content}</label>
}

export function Badge({
  tone = 'slate',
  children,
}: {
  tone?: 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'violet'
  children: ReactNode
}) {
  const tones: Record<string, string> = {
    slate: 'bg-hover text-content',
    green: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-rose-100 text-rose-700',
    blue: 'bg-sky-100 text-sky-700',
    violet: 'bg-violet-100 text-violet-700',
  }
  return <span className={`chip ${tones[tone]}`}>{children}</span>
}

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`h-4 w-4 animate-spin ${className}`} />
}

export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-content-soft">
      <Spinner /> {label}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong px-6 py-10 text-center">
      <p className="text-sm font-medium text-content">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-content-soft">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <p className="flex items-start gap-1.5 text-sm text-rose-600 dark:text-rose-400">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

// ------------------------------------------------------------------- modal
export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/50 p-4 backdrop-blur-[2px] sm:p-8">
      {/* overflow-x-hidden como rede de segurança: mesmo que algum conteúdo
          futuro esqueça o min-w-0 num flex item (a causa mais comum de
          rolagem lateral), o modal nunca mais vaza para o lado — na pior
          das hipóteses o texto é cortado, nunca a tela rola. */}
      <div className={`card w-full ${width} my-auto overflow-x-hidden bg-elevated`}>
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-content">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-content-soft">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-content-faint hover:bg-hover hover:text-content-muted"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      width="max-w-md"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className={danger ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy && <Spinner />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm text-content-muted">{message}</div>
    </Modal>
  )
}

// Padroniza o "clica, confirma, só então exclui" em qualquer lugar do
// sistema: guarda o alvo pendente, cuida do estado de carregando e só chama
// a ação de verdade depois do usuário confirmar na janela padrão.
// Uso: const del = useConfirmDelete<Item>(async (item) => { ...excluir... })
// del.ask(item) no botão de lixeira, e <ConfirmDialog open={!!del.target}
// busy={del.busy} onConfirm={del.confirm} onCancel={del.cancel} .../> perto do fim do JSX.
export function useConfirmDelete<T>(action: (target: T) => Promise<void> | void) {
  const [target, setTarget] = useState<T | null>(null)
  const [busy, setBusy] = useState(false)

  const confirm = useCallback(async () => {
    if (target === null) return
    setBusy(true)
    await action(target)
    setBusy(false)
    setTarget(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  return {
    target,
    busy,
    ask: (value: T) => setTarget(value),
    cancel: () => setTarget(null),
    confirm,
  }
}

// ------------------------------------------------------------------ toasts
type Toast = { id: number; kind: 'success' | 'error' | 'info'; message: string }

const ToastContext = createContext<{
  notify: (message: string, kind?: Toast['kind']) => void
} | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const notify = useCallback((message: string, kind: Toast['kind'] = 'success') => {
    const id = Date.now() + Math.random()
    setToasts((current) => [...current, { id, kind, message }])
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 5200)
  }, [])

  const value = useMemo(() => ({ notify }), [notify])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-4 py-3 text-sm shadow-card ${
              toast.kind === 'error'
                ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-200'
                : toast.kind === 'info'
                  ? 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-200'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200'
            }`}
          >
            {toast.kind === 'error' ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            ) : toast.kind === 'info' ? (
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span className="flex-1">{toast.message}</span>
            <button
              type="button"
              onClick={() => setToasts((current) => current.filter((t) => t.id !== toast.id))}
              className="text-current opacity-60 hover:opacity-100"
              aria-label="Fechar aviso"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast precisa estar dentro de <ToastProvider>')
  return context
}
