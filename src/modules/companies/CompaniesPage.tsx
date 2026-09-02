// Cadastro das empresas controladas pela holding. Cada empresa vira uma aba.
import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Building2, Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../core/lib/supabase'
import { useAuth } from '../../core/auth/AuthProvider'
import {
  Badge,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorText,
  Loading,
  Modal,
  PageHeader,
  Spinner,
  useToast,
} from '../../core/ui'
import type { Company } from '../../core/types'
import {
  COMPANY_PALETTE,
  CompanyFields,
  companyPayload,
  emptyCompanyForm,
  type CompanyFormState,
} from './CompanyFields'

export default function CompaniesPage() {
  const { refresh } = useAuth()
  const { notify } = useToast()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Company | null>(null)
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState<Company | null>(null)
  const [form, setForm] = useState<CompanyFormState>(emptyCompanyForm)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('companies')
      .select('*')
      .order('is_holding', { ascending: false })
      .order('display_order')
      .order('name')
    setCompanies((data as Company[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const openCreate = () => {
    setForm({
      ...emptyCompanyForm,
      color: COMPANY_PALETTE[companies.length % COMPANY_PALETTE.length],
      display_order: companies.length,
    })
    setError('')
    setCreating(true)
  }

  const openEdit = (company: Company) => {
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
    setError('')
    setEditing(company)
  }

  const close = () => {
    setCreating(false)
    setEditing(null)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')

    const payload = companyPayload(form)
    if (!payload.name) {
      setError('Informe o nome da empresa.')
      return
    }

    setBusy(true)
    const result = editing
      ? await supabase.from('companies').update(payload).eq('id', editing.id)
      : await supabase.from('companies').insert(payload)
    setBusy(false)

    if (result.error) {
      setError(
        result.error.code === '23505'
          ? 'Já existe uma empresa com esse identificador (slug).'
          : result.error.message,
      )
      return
    }

    notify(editing ? 'Empresa atualizada.' : 'Empresa criada.')
    close()
    await load()
    await refresh()
  }

  const confirmRemove = async () => {
    if (!removing) return
    setBusy(true)
    const { error: deleteError } = await supabase.from('companies').delete().eq('id', removing.id)
    setBusy(false)

    if (deleteError) {
      notify(deleteError.message, 'error')
      return
    }
    notify('Empresa excluída.')
    setRemoving(null)
    await load()
    await refresh()
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Empresas do grupo"
        subtitle="Cada empresa é um ambiente isolado: dados, KPIs e acessos próprios."
        actions={
          <button type="button" className="btn-primary" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Nova empresa
          </button>
        }
      />

      {loading ? (
        <Loading />
      ) : companies.length === 0 ? (
        <EmptyState
          title="Nenhuma empresa cadastrada"
          description="Crie a primeira empresa para começar a organizar KPIs, metas e tarefas."
          action={
            <button type="button" className="btn-primary" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Nova empresa
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {companies.map((company) => (
            <Card key={company.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-white"
                    style={{ backgroundColor: company.color }}
                  >
                    <Building2 className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="font-medium text-content">{company.name}</p>
                    <p className="text-xs text-content-soft">
                      {company.sector || 'Sem setor definido'}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {company.is_holding && <Badge tone="violet">Holding</Badge>}
                      {!company.is_active && <Badge tone="amber">Inativa</Badge>}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-content-faint hover:bg-hover hover:text-content"
                    onClick={() => openEdit(company)}
                    aria-label="Editar"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  {!company.is_holding && (
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-content-faint hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400"
                      onClick={() => setRemoving(company)}
                      aria-label="Excluir"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              {company.description && (
                <p className="mt-3 text-sm text-content-muted">{company.description}</p>
              )}
              <div className="mt-4 flex gap-2">
                <Link to={`/empresa/${company.id}`} className="btn-ghost">
                  Abrir painel
                </Link>
                <Link to={`/empresa/${company.id}/equipe`} className="btn-ghost">
                  Equipe
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={creating || Boolean(editing)}
        title={editing ? `Editar ${editing.name}` : 'Nova empresa'}
        description="A empresa aparece como uma aba no topo para quem tiver acesso."
        onClose={close}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={close}>
              Cancelar
            </button>
            <button type="submit" form="company-form" className="btn-primary" disabled={busy}>
              {busy && <Spinner />}
              {editing ? 'Salvar' : 'Criar empresa'}
            </button>
          </>
        }
      >
        <form id="company-form" onSubmit={submit}>
          <CompanyFields form={form} setForm={setForm} lockSlug={Boolean(editing)} />
          {error && (
            <div className="mt-4">
              <ErrorText>{error}</ErrorText>
            </div>
          )}
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(removing)}
        title="Excluir empresa"
        danger
        busy={busy}
        confirmLabel="Excluir definitivamente"
        message={
          <>
            Excluir <strong>{removing?.name}</strong> apaga junto todos os KPIs, metas, tarefas,
            mapas mentais e integrações dela. Esta ação não tem volta.
          </>
        }
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoving(null)}
      />
    </div>
  )
}
