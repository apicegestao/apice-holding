// CRM genérico de contatos — Fase 3 (segunda metade) do plano de virar um
// sistema de gestão completo por empresa. Kanban por etapa do funil
// (contact_stages, livre por empresa — sem lista fixa pro grupo inteiro),
// com campos customizáveis por contato (cada empresa/área acompanha coisas
// diferentes de um lead/cliente). Setas avançar/voltar + select de etapa no
// card, mesmo padrão de TasksPage.tsx — só que a "coluna" aqui é dinâmica
// (etapa cadastrada pela empresa), não um enum fixo.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Mail,
  Pencil,
  Phone,
  Plus,
  Trash2,
  User,
  X,
} from 'lucide-react'
import { supabase } from '../../core/lib/supabase'
import { initials } from '../../core/lib/format'
import { useAuth } from '../../core/auth/AuthProvider'
import { useCompany } from '../../core/company/CompanyProvider'
import {
  Badge,
  ConfirmDialog,
  EmptyState,
  ErrorText,
  Field,
  Loading,
  Modal,
  PageHeader,
  Spinner,
  useConfirmDelete,
  useToast,
} from '../../core/ui'
import { COMPANY_PALETTE } from '../companies/CompanyFields'
import type { Contact, ContactStage, Profile } from '../../core/types'

type CustomFieldRow = { key: string; value: string }

type ContactForm = {
  stage_id: string
  name: string
  organization: string
  email: string
  phone: string
  owner_id: string
  notes: string
  custom_fields: CustomFieldRow[]
}

const blankForm = (stageId: string): ContactForm => ({
  stage_id: stageId,
  name: '',
  organization: '',
  email: '',
  phone: '',
  owner_id: '',
  notes: '',
  custom_fields: [],
})

type StageForm = { name: string; color: string }
const blankStageForm: StageForm = { name: '', color: '' }

export default function ContactsPage() {
  const { company, canWrite } = useCompany()
  const { profile } = useAuth()
  const { notify } = useToast()

  const [contacts, setContacts] = useState<Contact[]>([])
  const [stages, setStages] = useState<ContactStage[]>([])
  const [people, setPeople] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  const [modal, setModal] = useState<{ editing: Contact | null } | null>(null)
  const [form, setForm] = useState<ContactForm>(blankForm(''))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [stageModal, setStageModal] = useState<{ editing: ContactStage | null } | null>(null)
  const [stageForm, setStageForm] = useState<StageForm>(blankStageForm)
  const [stageError, setStageError] = useState('')
  const [stageBusy, setStageBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: contactRows }, { data: stageRows }, { data: memberRows }] = await Promise.all([
      supabase.from('contacts').select('*').eq('company_id', company.id).order('display_order'),
      supabase.from('contact_stages').select('*').eq('company_id', company.id).order('display_order'),
      supabase.from('company_members').select('user_id').eq('company_id', company.id),
    ])
    const memberIds = (memberRows ?? []).map((row) => row.user_id)
    const { data: profileRows } = memberIds.length
      ? await supabase.from('profiles').select('*').in('id', memberIds)
      : { data: [] as Profile[] }
    setContacts((contactRows as Contact[]) ?? [])
    setStages((stageRows as ContactStage[]) ?? [])
    setPeople((profileRows as Profile[]) ?? [])
    setLoading(false)
  }, [company.id])

  useEffect(() => {
    void load()
  }, [load])

  const columns = useMemo(
    () => stages.map((stage) => ({ stage, items: contacts.filter((c) => c.stage_id === stage.id) })),
    [stages, contacts],
  )
  const stageIndex = (stageId: string) => stages.findIndex((s) => s.id === stageId)
  const person = (id: string | null) => people.find((item) => item.id === id)

  // ------------------------------------------------------------- contato
  const openCreate = (stageId: string) => {
    setForm(blankForm(stageId))
    setError('')
    setModal({ editing: null })
  }
  const openEdit = (contact: Contact) => {
    setForm({
      stage_id: contact.stage_id,
      name: contact.name,
      organization: contact.organization ?? '',
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      owner_id: contact.owner_id ?? '',
      notes: contact.notes ?? '',
      custom_fields: Object.entries(contact.custom_fields).map(([key, value]) => ({ key, value })),
    })
    setError('')
    setModal({ editing: contact })
  }

  const submitContact = async (event: FormEvent) => {
    event.preventDefault()
    if (!form.name.trim()) {
      setError('Dê um nome ao contato.')
      return
    }
    setError('')
    setBusy(true)
    const customFields = Object.fromEntries(
      form.custom_fields
        .map(({ key, value }) => [key.trim(), value.trim()] as const)
        .filter(([key]) => key.length > 0),
    )
    const payload = {
      company_id: company.id,
      stage_id: form.stage_id,
      name: form.name.trim(),
      organization: form.organization.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      owner_id: form.owner_id || null,
      notes: form.notes.trim() || null,
      custom_fields: customFields,
    }
    const editing = modal?.editing ?? null
    const result = editing
      ? await supabase.from('contacts').update(payload).eq('id', editing.id)
      : await supabase.from('contacts').insert({
          ...payload,
          created_by: profile?.id ?? null,
          display_order: contacts.filter((c) => c.stage_id === form.stage_id).length,
        })
    setBusy(false)
    if (result.error) {
      setError(result.error.message)
      return
    }
    notify(editing ? 'Contato atualizado.' : 'Contato criado.')
    setModal(null)
    await load()
  }

  const changeStage = async (contact: Contact, stageId: string) => {
    const { error: moveError } = await supabase.from('contacts').update({ stage_id: stageId }).eq('id', contact.id)
    if (moveError) {
      notify(moveError.message, 'error')
      return
    }
    await load()
  }

  // Um toque pra mudar de coluna, sem abrir o select — mesmo atalho de
  // TasksPage.tsx pro caso comum de avançar/voltar uma etapa.
  const moveInBoard = (contact: Contact, delta: 1 | -1) => {
    const next = stages[stageIndex(contact.stage_id) + delta]
    if (next) void changeStage(contact, next.id)
  }

  const contactDelete = useConfirmDelete<Contact>(async (contact) => {
    const { error: deleteError } = await supabase.from('contacts').delete().eq('id', contact.id)
    if (deleteError) {
      notify(deleteError.message, 'error')
      return
    }
    notify('Contato excluído.')
    await load()
  })

  // -------------------------------------------------------------- etapa
  const openCreateStage = () => {
    setStageForm(blankStageForm)
    setStageError('')
    setStageModal({ editing: null })
  }
  const openEditStage = (stage: ContactStage) => {
    setStageForm({ name: stage.name, color: stage.color ?? '' })
    setStageError('')
    setStageModal({ editing: stage })
  }

  const submitStage = async (event: FormEvent) => {
    event.preventDefault()
    if (!stageForm.name.trim()) {
      setStageError('Dê um nome à etapa.')
      return
    }
    setStageError('')
    setStageBusy(true)
    const editing = stageModal?.editing ?? null
    const result = editing
      ? await supabase.from('contact_stages').update({ name: stageForm.name.trim() }).eq('id', editing.id)
      : await supabase.from('contact_stages').insert({
          company_id: company.id,
          name: stageForm.name.trim(),
          color: COMPANY_PALETTE[stages.length % COMPANY_PALETTE.length],
          display_order: stages.length,
          created_by: profile?.id ?? null,
        })
    setStageBusy(false)
    if (result.error) {
      setStageError(
        result.error.code === '23505' ? 'Já existe uma etapa com esse nome nesta empresa.' : result.error.message,
      )
      return
    }
    notify(editing ? 'Etapa atualizada.' : 'Etapa criada.')
    setStageModal(null)
    await load()
  }

  const stageDelete = useConfirmDelete<ContactStage>(async (stage) => {
    const { error: deleteError } = await supabase.from('contact_stages').delete().eq('id', stage.id)
    if (deleteError) {
      notify(
        deleteError.code === '23503'
          ? 'Mova ou exclua os contatos desta etapa antes de excluí-la.'
          : deleteError.message,
        'error',
      )
      return
    }
    notify('Etapa excluída.')
    await load()
  })

  const addCustomField = () => setForm((c) => ({ ...c, custom_fields: [...c.custom_fields, { key: '', value: '' }] }))
  const updateCustomField = (index: number, patch: Partial<CustomFieldRow>) =>
    setForm((c) => ({
      ...c,
      custom_fields: c.custom_fields.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }))
  const removeCustomField = (index: number) =>
    setForm((c) => ({ ...c, custom_fields: c.custom_fields.filter((_, i) => i !== index) }))

  if (loading) return <Loading />

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={`Contatos · ${company.name}`}
        subtitle="O funil de relacionamento da empresa — lead, cliente, fornecedor, parceiro. Campos livres pra acompanhar o que importar pra cada um."
        actions={
          canWrite && (
            <button type="button" className="btn-ghost" onClick={openCreateStage}>
              <Plus className="h-4 w-4" /> Nova etapa
            </button>
          )
        }
      />

      {stages.length === 0 ? (
        <EmptyState
          title="Nenhuma etapa cadastrada"
          description='Cadastre as etapas do funil desta empresa — ex.: "Novo lead", "Em contato", "Fechado" — pra começar a organizar os contatos.'
          action={
            canWrite && (
              <button type="button" className="btn-primary" onClick={openCreateStage}>
                <Plus className="h-4 w-4" /> Criar etapa
              </button>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {columns.map(({ stage, items }) => (
            <div key={stage.id} className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-1 px-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: stage.color ?? '#94A3B8' }}
                  />
                  <h2 className="min-w-0 truncate text-sm font-semibold text-content">
                    {stage.name}
                    <span className="ml-1.5 text-xs font-normal text-content-faint">{items.length}</span>
                  </h2>
                </div>
                {canWrite && (
                  <div className="flex shrink-0 gap-0.5">
                    <button
                      type="button"
                      className="rounded p-1 text-content-faint hover:bg-hover hover:text-content"
                      onClick={() => openEditStage(stage)}
                      aria-label={`Editar etapa "${stage.name}"`}
                      title="Editar etapa"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-content-faint hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400"
                      onClick={() => stageDelete.ask(stage)}
                      aria-label={`Excluir etapa "${stage.name}"`}
                      title="Excluir etapa"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-content-faint hover:bg-hover hover:text-content"
                      onClick={() => openCreate(stage.id)}
                      aria-label={`Novo contato em ${stage.name}`}
                      title="Novo contato"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>

              {items.length === 0 && (
                <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-content-faint">
                  vazio
                </p>
              )}

              {items.map((contact) => {
                const owner = person(contact.owner_id)
                const customEntries = Object.entries(contact.custom_fields)
                return (
                  <article key={contact.id} className="card min-w-0 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-medium text-content">{contact.name}</p>
                      {canWrite && (
                        <div className="flex shrink-0 gap-0.5">
                          <button
                            type="button"
                            className="rounded p-1 text-content-faint hover:bg-hover hover:text-content-muted"
                            onClick={() => openEdit(contact)}
                            aria-label={`Editar contato "${contact.name}"`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className="rounded p-1 text-content-faint hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400"
                            onClick={() => contactDelete.ask(contact)}
                            aria-label={`Excluir contato "${contact.name}"`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    {contact.organization && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-content-soft">
                        <Building2 className="h-3 w-3 shrink-0" />
                        <span className="truncate">{contact.organization}</span>
                      </p>
                    )}
                    {contact.email && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-content-soft">
                        <Mail className="h-3 w-3 shrink-0" />
                        <span className="truncate">{contact.email}</span>
                      </p>
                    )}
                    {contact.phone && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-content-soft">
                        <Phone className="h-3 w-3 shrink-0" />
                        <span className="truncate">{contact.phone}</span>
                      </p>
                    )}

                    {customEntries.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {customEntries.map(([key, value]) => (
                          <Badge key={key}>
                            {key}: {value}
                          </Badge>
                        ))}
                      </div>
                    )}

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs text-content-soft" title={owner?.email}>
                        {owner ? (
                          <>
                            <span className="grid h-5 w-5 place-items-center rounded-full bg-hover text-[9px] font-semibold text-content-muted">
                              {initials(owner.full_name || owner.email)}
                            </span>
                            <span className="max-w-24 truncate" title={owner.full_name}>
                              {owner.full_name}
                            </span>
                          </>
                        ) : (
                          <>
                            <User className="h-3.5 w-3.5" /> sem responsável
                          </>
                        )}
                      </span>

                      {canWrite && (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            className="rounded p-1 text-content-faint enabled:hover:bg-hover enabled:hover:text-content disabled:opacity-30"
                            disabled={stageIndex(contact.stage_id) <= 0}
                            onClick={() => moveInBoard(contact, -1)}
                            aria-label={`Voltar "${contact.name}" de etapa`}
                            title="Voltar etapa"
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            className="rounded p-1 text-content-faint enabled:hover:bg-hover enabled:hover:text-content disabled:opacity-30"
                            disabled={stageIndex(contact.stage_id) >= stages.length - 1}
                            onClick={() => moveInBoard(contact, 1)}
                            aria-label={`Avançar "${contact.name}" de etapa`}
                            title="Avançar etapa"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                          <select
                            className="rounded border border-line bg-surface px-1.5 py-1 text-base sm:text-xs"
                            value={contact.stage_id}
                            onChange={(event) => void changeStage(contact, event.target.value)}
                          >
                            {stages.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(modal)}
        title={modal?.editing ? `Editar ${modal.editing.name}` : 'Novo contato'}
        onClose={() => setModal(null)}
        width="max-w-lg"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setModal(null)}>
              Cancelar
            </button>
            <button type="submit" form="contact-form" className="btn-primary" disabled={busy}>
              {busy && <Spinner />}
              {modal?.editing ? 'Salvar' : 'Criar contato'}
            </button>
          </>
        }
      >
        <form id="contact-form" onSubmit={submitContact} className="space-y-4">
          <Field label="Nome">
            <input
              className="input"
              required
              autoFocus
              placeholder="Nome da pessoa ou organização"
              value={form.name}
              onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))}
            />
          </Field>

          <Field label="Etapa">
            <select
              className="input"
              value={form.stage_id}
              onChange={(event) => setForm((c) => ({ ...c, stage_id: event.target.value }))}
            >
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Organização" hint="Opcional.">
              <input
                className="input"
                value={form.organization}
                onChange={(event) => setForm((c) => ({ ...c, organization: event.target.value }))}
              />
            </Field>
            <Field label="Responsável" hint="Opcional.">
              <select
                className="input"
                value={form.owner_id}
                onChange={(event) => setForm((c) => ({ ...c, owner_id: event.target.value }))}
              >
                <option value="">Sem responsável</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="E-mail" hint="Opcional.">
              <input
                className="input"
                type="email"
                value={form.email}
                onChange={(event) => setForm((c) => ({ ...c, email: event.target.value }))}
              />
            </Field>
            <Field label="Telefone" hint="Opcional.">
              <input
                className="input"
                value={form.phone}
                onChange={(event) => setForm((c) => ({ ...c, phone: event.target.value }))}
              />
            </Field>
          </div>

          <Field label="Notas" hint="Opcional.">
            <textarea
              className="input min-h-20"
              value={form.notes}
              onChange={(event) => setForm((c) => ({ ...c, notes: event.target.value }))}
            />
          </Field>

          <Field asGroup label="Campos personalizados" hint="Livre — o que fizer sentido acompanhar deste contato.">
            <div className="space-y-2">
              {form.custom_fields.map((row, index) => (
                <div key={index} className="flex items-center gap-1.5">
                  <input
                    className="input"
                    placeholder="Campo (ex.: Origem)"
                    value={row.key}
                    onChange={(event) => updateCustomField(index, { key: event.target.value })}
                  />
                  <input
                    className="input"
                    placeholder="Valor"
                    value={row.value}
                    onChange={(event) => updateCustomField(index, { value: event.target.value })}
                  />
                  <button
                    type="button"
                    className="shrink-0 rounded p-1.5 text-content-faint hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400"
                    onClick={() => removeCustomField(index)}
                    aria-label="Remover campo personalizado"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button type="button" className="btn-ghost py-1 text-xs" onClick={addCustomField}>
                <Plus className="h-3.5 w-3.5" /> Campo personalizado
              </button>
            </div>
          </Field>

          {error && <ErrorText>{error}</ErrorText>}
        </form>
      </Modal>

      <ConfirmDialog
        open={contactDelete.target !== null}
        title="Excluir contato?"
        danger
        busy={contactDelete.busy}
        confirmLabel="Excluir"
        message={
          <>
            Excluir <strong>{contactDelete.target?.name}</strong>. Não dá pra desfazer.
          </>
        }
        onConfirm={() => void contactDelete.confirm()}
        onCancel={contactDelete.cancel}
      />

      <Modal
        open={Boolean(stageModal)}
        title={stageModal?.editing ? `Editar ${stageModal.editing.name}` : 'Nova etapa'}
        onClose={() => setStageModal(null)}
        width="max-w-md"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setStageModal(null)}>
              Cancelar
            </button>
            <button type="submit" form="contact-stage-form" className="btn-primary" disabled={stageBusy}>
              {stageBusy && <Spinner />}
              {stageModal?.editing ? 'Salvar' : 'Criar etapa'}
            </button>
          </>
        }
      >
        <form id="contact-stage-form" onSubmit={submitStage} className="space-y-4">
          <Field label="Nome da etapa">
            <input
              className="input"
              required
              autoFocus
              placeholder="Novo lead, Em contato, Fechado…"
              value={stageForm.name}
              onChange={(event) => setStageForm((c) => ({ ...c, name: event.target.value }))}
            />
          </Field>
          {stageError && <ErrorText>{stageError}</ErrorText>}
        </form>
      </Modal>

      <ConfirmDialog
        open={stageDelete.target !== null}
        title="Excluir etapa?"
        danger
        busy={stageDelete.busy}
        confirmLabel="Excluir"
        message={
          <>
            Excluir <strong>{stageDelete.target?.name}</strong>. Só é possível se não houver nenhum contato nela.
          </>
        }
        onConfirm={() => void stageDelete.confirm()}
        onCancel={stageDelete.cancel}
      />
    </div>
  )
}
