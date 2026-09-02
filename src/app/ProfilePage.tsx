import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../core/auth/AuthProvider'
import { supabase } from '../core/lib/supabase'
import { Badge, Card, ErrorText, Field, PageHeader, Spinner, useToast } from '../core/ui'
import { ROLE_LABEL } from '../core/types'

export default function ProfilePage() {
  const { profile, memberships, isSuperAdmin, refresh } = useAuth()
  const { notify } = useToast()
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setFullName(profile?.full_name ?? '')
    setPhone(profile?.phone ?? '')
    setJobTitle(profile?.job_title ?? '')
  }, [profile])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!profile) return
    setError('')
    setBusy(true)
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim(), phone: phone.trim() || null, job_title: jobTitle.trim() || null })
      .eq('id', profile.id)
    setBusy(false)

    if (updateError) {
      setError(updateError.message)
      return
    }
    await refresh()
    notify('Perfil atualizado.')
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Meu perfil" subtitle={profile?.email} />

      <Card title="Dados pessoais">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Nome completo">
            <input
              className="input"
              required
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cargo">
              <input
                className="input"
                value={jobTitle}
                onChange={(event) => setJobTitle(event.target.value)}
              />
            </Field>
            <Field label="Telefone">
              <input
                className="input"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </Field>
          </div>
          {error && <ErrorText>{error}</ErrorText>}
          <div className="flex justify-end">
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy && <Spinner />}
              Salvar
            </button>
          </div>
        </form>
      </Card>

      <Card title="Meus acessos" description="Empresas liberadas para este usuário e o papel em cada uma.">
        {isSuperAdmin && (
          <p className="mb-3 text-sm text-content-muted">
            Você é <strong>administrador da holding</strong> — acessa todas as empresas do grupo.
          </p>
        )}
        <ul className="divide-y divide-line">
          {memberships.map(({ company, role }) => (
            <li key={company.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="flex items-center gap-2 text-sm">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: company.color }}
                />
                {company.name}
              </span>
              <Badge tone={role === 'admin' ? 'violet' : role === 'collaborator' ? 'blue' : 'slate'}>
                {ROLE_LABEL[role]}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
