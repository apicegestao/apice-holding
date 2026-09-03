// Bloco de notas — veio no lugar do mapa mental, que quase ninguém usava.
// Aqui é só "escrever e guardar": sem canvas, sem arrastar nó, sem organizar
// layout. A diferença que importa não é a interface — é que cada nota é
// privada de quem escreveu. Nem outro admin da mesma empresa enxerga a nota
// de alguém (RLS: user_id = auth.uid(), não app.is_member como todo o resto
// do sistema — ver migração 0029_notes_replace_mindmap.sql).
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { supabase } from '../../core/lib/supabase'
import { formatDateTime } from '../../core/lib/format'
import { useAuth } from '../../core/auth/AuthProvider'
import { useCompany } from '../../core/company/CompanyProvider'
import {
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Loading,
  Modal,
  PageHeader,
  Spinner,
  useConfirmDelete,
  useToast,
} from '../../core/ui'
import type { Note } from '../../core/types'

type NoteForm = { title: string; body: string }
const blankForm: NoteForm = { title: '', body: '' }

/** O board em si — recebe a empresa (comum ou a linha da holding, que é só
 *  mais uma empresa na mesma tabela) e monta a lista de notas daquele
 *  contexto, sempre restrita a quem está logado. */
function NotesBoard({ companyId, companyName }: { companyId: string; companyName: string }) {
  const { profile } = useAuth()
  const { notify } = useToast()

  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  const [editing, setEditing] = useState<Note | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<NoteForm>(blankForm)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    // A RLS já garante que só voltam notas minhas — o filtro por empresa
    // aqui é só pra separar o bloco desta empresa do de outra, não segurança.
    const { data } = await supabase
      .from('notes')
      .select('*')
      .eq('company_id', companyId)
      .order('updated_at', { ascending: false })
    setNotes((data as Note[]) ?? [])
    setLoading(false)
  }, [companyId])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return notes
    return notes.filter(
      (note) => note.title.toLowerCase().includes(q) || note.body.toLowerCase().includes(q),
    )
  }, [notes, query])

  const openCreate = () => {
    setForm(blankForm)
    setEditing(null)
    setModalOpen(true)
  }
  const openEdit = (note: Note) => {
    setForm({ title: note.title, body: note.body })
    setEditing(note)
    setModalOpen(true)
  }
  const close = () => {
    setModalOpen(false)
    setEditing(null)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    const payload = { title: form.title.trim() || 'Sem título', body: form.body }
    const result = editing
      ? await supabase.from('notes').update(payload).eq('id', editing.id)
      : await supabase.from('notes').insert({ ...payload, company_id: companyId, user_id: profile!.id })
    setBusy(false)
    if (result.error) {
      notify(result.error.message, 'error')
      return
    }
    notify(editing ? 'Nota atualizada.' : 'Nota criada.')
    close()
    await load()
  }

  const removeNote = useConfirmDelete<Note>(async (note) => {
    const { error } = await supabase.from('notes').delete().eq('id', note.id)
    if (error) {
      notify(error.message, 'error')
      return
    }
    notify('Nota excluída.')
    await load()
  })

  if (loading) return <Loading />

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={`Notas · ${companyName}`}
        subtitle="Só você enxerga estas notas — nem outro administrador desta empresa vê."
        actions={
          <button type="button" className="btn-primary" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Nova nota
          </button>
        }
      />

      {notes.length === 0 ? (
        <EmptyState
          title="Nenhuma nota ainda"
          description="Um bloco de notas pessoal — anote o que quiser, ninguém mais vê."
          action={
            <button type="button" className="btn-primary" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Escrever a primeira
            </button>
          }
        />
      ) : (
        <>
          <div className="relative mb-4 max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-faint" />
            <input
              className="input pl-9"
              placeholder="Buscar nas notas…"
              aria-label="Buscar nas notas"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          {filtered.length === 0 ? (
            <EmptyState title="Nada encontrado" description="Tente outro termo de busca." />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((note) => (
                <Card key={note.id} className="flex flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 break-words text-sm font-semibold text-content">{note.title}</p>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        className="rounded-md p-1.5 text-content-faint hover:bg-hover hover:text-content"
                        onClick={() => openEdit(note)}
                        aria-label={`Editar nota "${note.title}"`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className="rounded-md p-1.5 text-content-faint hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400"
                        onClick={() => removeNote.ask(note)}
                        aria-label={`Excluir nota "${note.title}"`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  {note.body && (
                    <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs text-content-soft">{note.body}</p>
                  )}
                  <p className="mt-auto pt-3 text-xs text-content-faint">
                    Atualizada {formatDateTime(note.updated_at)}
                  </p>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      <Modal
        open={modalOpen}
        title={editing ? 'Editar nota' : 'Nova nota'}
        onClose={close}
        width="max-w-lg"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={close}>
              Cancelar
            </button>
            <button type="submit" form="note-form" className="btn-primary" disabled={busy}>
              {busy && <Spinner />}
              Salvar
            </button>
          </>
        }
      >
        <form id="note-form" onSubmit={submit} className="space-y-4">
          <Field label="Título">
            <input
              className="input"
              autoFocus
              placeholder="Título da nota"
              value={form.title}
              onChange={(event) => setForm((c) => ({ ...c, title: event.target.value }))}
            />
          </Field>
          <Field label="Anotação">
            <textarea
              className="input min-h-40"
              placeholder="Escreva aqui…"
              value={form.body}
              onChange={(event) => setForm((c) => ({ ...c, body: event.target.value }))}
            />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={removeNote.target !== null}
        title="Excluir nota?"
        danger
        busy={removeNote.busy}
        confirmLabel="Excluir"
        message="Não dá pra desfazer."
        onConfirm={() => void removeNote.confirm()}
        onCancel={removeNote.cancel}
      />
    </div>
  )
}

function CompanyNotes() {
  const { company } = useCompany()
  return <NotesBoard companyId={company.id} companyName={company.name} />
}

function HoldingNotes() {
  const { memberships } = useAuth()
  const holding = memberships.find((item) => item.company.is_holding)?.company

  if (!holding) {
    return (
      <EmptyState
        title="Empresa controladora não encontrada"
        description="Cadastre a empresa marcada como holding para usar as notas do grupo."
      />
    )
  }

  return <NotesBoard companyId={holding.id} companyName={holding.name} />
}

export default function NotesPage({ scope = 'company' }: { scope?: 'company' | 'holding' }) {
  return scope === 'holding' ? <HoldingNotes /> : <CompanyNotes />
}
