import { useState, type FormEvent } from 'react'
import { useAuth } from '../core/auth/AuthProvider'
import { Logo } from '../core/ui/Logo'
import { ErrorText, Field, Spinner } from '../core/ui'

export default function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      await signIn(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar.')
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-ink-900 p-10 text-white lg:flex">
        <Logo size={40} withWordmark tone="light" />
        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight">
            Uma visão só, para todas as empresas do grupo.
          </h1>
          <p className="mt-4 text-slate-300">
            KPIs, metas, tarefas e mapas mentais de cada empresa, isolados entre si — e
            consolidados no painel da holding.
          </p>
        </div>
        <p className="text-xs text-slate-500">Acesso restrito a usuários cadastrados pelo admin.</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="card w-full max-w-sm p-6">
          <Logo size={48} className="mb-4 lg:hidden" />
          <h2 className="text-lg font-semibold">Entrar</h2>
          <p className="mt-1 text-sm text-slate-500">
            Use o e-mail cadastrado pelo administrador.
          </p>

          <div className="mt-5 space-y-4">
            <Field label="E-mail">
              <input
                className="input"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="voce@empresa.com.br"
              />
            </Field>
            <Field label="Senha">
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
              />
            </Field>
            {error && <ErrorText>{error}</ErrorText>}
            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy && <Spinner />}
              Entrar
            </button>
          </div>

          <p className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-500">
            Primeiro acesso? Use a senha padrão informada pelo administrador — o sistema pede a
            troca em seguida. Esqueceu a senha? O administrador reseta para você.
          </p>
        </form>
      </div>
    </div>
  )
}
