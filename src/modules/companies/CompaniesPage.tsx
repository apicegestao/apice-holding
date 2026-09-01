// Cadastro das empresas controladas pela holding. Cada empresa vira uma aba.
import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Building2, Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../core/lib/supabase'
import { slugify } from '../../core/lib/format'
import { useAuth } from '../../core/auth/AuthProvider'
import {
  Badge,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorText,
  Field,
  Loading,
  Modal,
  PageHeader,
  Spinner,
  useToast,
} from '../../core/ui'
import type { Company } from '../../core/types'

const PALETTE = ['#0EA5E9', '#6366F1', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#14B8A6', '#EC4899']

const emptyForm = {
  name: '',
  slug: '',
  legal_name: '',
  tax_id: '',
  sector: '',
  description: '',
  color: PALETTE[0],
  display_order: 0,
  is_active: true,
}

export default function CompaniesPage() {
  const { refresh } = useAuth()
  const { notify } = useToast()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Company | null>(null)
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState<Company | null>(null)
  const [form, setForm] = useState(emptyForm)
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
    setForm({ ...emptyForm, color: PALETTE[companies.length % PALETTE.length], display_order: companies.length })
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

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')

    const payload = {
      name: form.name.trim(),
      slug: (form.slug.trim() || slugify(form.name)) || slugify(form.name),
      legal_name: form.legal_name.trim() || null,
      tax_id: form.tax_id.trim() || null,
      sector: form.sector.trim() || null,
      description: form.description.trim() || null,
      color: form.color,
      display_order: Number(form.display_order) || 0,
      is_active: form.is_active,
    }

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
    setCreating(false)
    setEditing(null)
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

  const formFields = (
    <form id="company-form" onSubmit={submit} className="space-y-4">
      <Field label="Nome da empresa">
        <input
          className="input"
          required
          value={form.name}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              name: event.target.value,
              slug: editing ? current.slug : slugify(event.target.value),
            }))
          }
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Identificador" hint="Usado em URLs. Só letras, números e hífen.">
          <input
            className="input"
            value={form.slug}
            onChange={(event) => setForm((c) => ({ ...c, slug: slugify(event.target.value) }))}
          />
        </Field>
        <Field label="Setor">
          <input
            className="input"
            placeholder="Contabilidade, Varejo…"
            value={form.sector}
            onChange={(event) => setForm((c) => ({ ...c, sector: event.target.value }))}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Razão social">
          <input
            className="input"
            value={form.legal_name}
            onChange={(event) => setForm((c) => ({ ...c, legal_name: event.target.value }))}
          />
        </Field>
        <Field label="CNPJ">
          <input
            className="input"
            value={form.tax_id}
            onChange={(event) => setForm((c) => ({ ...c, tax_id: event.target.value }))}
          />
        </Field>
      </div>
      <Field label="Descrição">
        <textarea
          className="input min-h-20"
          value={form.description}
          onChange={(event) => setForm((c) => ({ ...c, description: event.target.value }))}
        />
      </Field>
      <Field label="Cor da aba">
        <div className="flex flex-wrap gap-2">
          {PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => setForm((c) => ({ ...c, color }))}
              className={`h-8 w-8 rounded-full border-2 transition ${
                form.color === color ? 'border-ink-900 scale-110' : 'border-transparent'
              }`}
              style={{ backgroundColor: color }}
              aria-label={`Cor ${color}`}
            />
          ))}
        </div>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ordem na barra de abas">
          <input
            className="input"
            type="number"
            value={form.display_order}
            onChange={(event) => setForm((c) => ({ ...c, display_order: Number(event.target.value) }))}
          />
        </Field>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(event) => setForm((c) => ({ ...c, is_active: event.target.checked }))}
          />
          Empresa ativa
        </label>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
    </form>
  )

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
        <div className="grid gap-4 sm:grid-cols-2">
          {companies.map((company) => (
            <Card key={company.id} className="overflow-hidden">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-white"
                    style={{ backgroundColor: company.color }}
                  >
                    <Building2 className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="font-medium text-ink-900">{company.name}</p>
                    <p className="text-xs text-slate-500">{company.sector || 'Sem setor definido'}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {company.is_holding && <Badge tone="violet">Holding</Badge>}
                      {!company.is_active && <Badge tone="amber">Inativa</Badge>}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    onClick={() => openEdit(company)}
                    aria-label="Editar"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  {!company.is_holding && (
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      onClick={() => setRemoving(company)}
                      aria-label="Excluir"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              {company.description && (
                <p className="mt-3 text-sm text-slate-600">{company.description}</p>
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
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        footer={
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setCreating(false)
                setEditing(null)
              }}
            >
              Cancelar
            </button>
            <button type="submit" form="company-form" className="btn-primary" disabled={busy}>
              {busy && <Spinner />}
              {editing ? 'Salvar' : 'Criar empresa'}
            </button>
          </>
        }
      >
        {formFields}
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
