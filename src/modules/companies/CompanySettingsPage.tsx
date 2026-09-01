// Dados da empresa, editáveis por quem administra ela — sem precisar
// passar pelo painel da holding.
import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../core/lib/supabase'
import { useAuth } from '../../core/auth/AuthProvider'
import { useCompany } from '../../core/company/CompanyProvider'
import { Card, EmptyState, ErrorText, PageHeader, Spinner, useToast } from '../../core/ui'
import {
  CompanyFields,
  companyPayload,
  emptyCompanyForm,
  type CompanyFormState,
} from './CompanyFields'

export default function CompanySettingsPage() {
  const { company, isAdmin } = useCompany()
  const { refresh } = useAuth()
  const { notify } = useToast()
  const [form, setForm] = useState<CompanyFormState>(emptyCompanyForm)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setForm({
      name: company.name,
      slug: company.slug,
      legal_name: company.legal_name ?? '',
      tax_id: company.tax_id ?? '',
      sector: company.sector ?? '',
      description: company.description ?? '',
      color: company.color,
      display_order: company.display_order,
      is_active: company.is_active,
    })
  }, [company])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')

    const payload = companyPayload(form)
    if (!payload.name) {
      setError('Informe o nome da empresa.')
      return
    }

    setBusy(true)
    const { error: updateError } = await supabase
      .from('companies')
      .update(payload)
      .eq('id', company.id)
    setBusy(false)

    if (updateError) {
      setError(
        updateError.code === '23505'
          ? 'Já existe uma empresa com esse identificador.'
          : updateError.message,
      )
      return
    }

    notify('Dados da empresa atualizados.')
    await refresh()
  }

  if (!isAdmin) {
    return (
      <EmptyState
        title="Área restrita"
        description="Só administradores desta empresa alteram o cadastro dela."
      />
    )
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={`Dados da empresa · ${company.name}`}
        subtitle="Nome, setor, cor da aba e identificação fiscal."
      />
      <Card>
        <form onSubmit={submit}>
          <CompanyFields form={form} setForm={setForm} />
          {error && (
            <div className="mt-4">
              <ErrorText>{error}</ErrorText>
            </div>
          )}
          <div className="mt-5 flex justify-end">
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy && <Spinner />}
              Salvar alterações
            </button>
          </div>
        </form>
      </Card>
    </div>
  )
}
