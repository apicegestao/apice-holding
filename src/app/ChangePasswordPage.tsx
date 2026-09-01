import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../core/auth/AuthProvider'
import { Card, ErrorText, Field, PageHeader, Spinner, useToast } from '../core/ui'

const MIN_LENGTH = 8

export default function ChangePasswordPage({ firstAccess = false }: { firstAccess?: boolean }) {
  const { changePassword, signOut, profile } = useAuth()
  const { notify } = useToast()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')

    if (password.length < MIN_LENGTH) {
      setError(`A senha precisa ter pelo menos ${MIN_LENGTH} caracteres.`)
      return
    }
    if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
      setError('Use pelo menos uma letra e um número.')
      return
    }
    if (password !== confirmation) {
      setError('As duas senhas não são iguais.')
      return
    }

    setBusy(true)
    try {
      await changePassword(password)
      notify('Senha atualizada.')
      if (!firstAccess) navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível trocar a senha.')
    } finally {
      setBusy(false)
    }
  }

  const form = (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Nova senha" hint={`Mínimo de ${MIN_LENGTH} caracteres, com letra e número.`}>
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>
      <Field label="Repita a nova senha">
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          required
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </Field>
      {error && <ErrorText>{error}</ErrorText>}
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy && <Spinner />}
        Salvar nova senha
      </button>
    </form>
  )

  if (firstAccess) {
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <div className="card w-full max-w-sm p-6">
          <h1 className="text-lg font-semibold">Defina sua senha</h1>
          <p className="mt-1 text-sm text-slate-500">
            Este é o primeiro acesso de <strong>{profile?.email}</strong>. Troque a senha padrão
            para continuar.
          </p>
          <div className="mt-5">{form}</div>
          <button
            type="button"
            className="mt-4 w-full text-xs text-slate-500 hover:underline"
            onClick={() => void signOut()}
          >
            Sair
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Trocar senha" subtitle="Vale para todas as empresas do grupo." />
      <Card>{form}</Card>
    </div>
  )
}
