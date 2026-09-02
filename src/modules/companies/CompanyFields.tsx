// Campos do cadastro de empresa. Compartilhado entre a tela da holding
// (criar/editar qualquer empresa) e a tela de dados dentro da empresa.
import { Field } from '../../core/ui'
import { slugify } from '../../core/lib/format'
import { SECTORS } from '../../core/catalog'

export const COMPANY_PALETTE = [
  '#DE4C22',
  '#2E31B0',
  '#0EA5E9',
  '#10B981',
  '#F59E0B',
  '#8B5CF6',
  '#EC4899',
  '#64748B',
]

export type CompanyFormState = {
  name: string
  slug: string
  legal_name: string
  tax_id: string
  sector: string
  description: string
  color: string
  display_order: number
  is_active: boolean
}

export const emptyCompanyForm: CompanyFormState = {
  name: '',
  slug: '',
  legal_name: '',
  tax_id: '',
  sector: '',
  description: '',
  color: COMPANY_PALETTE[0],
  display_order: 0,
  is_active: true,
}

export function companyPayload(form: CompanyFormState) {
  return {
    name: form.name.trim(),
    slug: form.slug.trim() || slugify(form.name),
    legal_name: form.legal_name.trim() || null,
    tax_id: form.tax_id.trim() || null,
    sector: form.sector.trim() || null,
    description: form.description.trim() || null,
    color: form.color,
    display_order: Number(form.display_order) || 0,
    is_active: form.is_active,
  }
}

export function CompanyFields({
  form,
  setForm,
  lockSlug = false,
  showOrdering = true,
}: {
  form: CompanyFormState
  setForm: (updater: (current: CompanyFormState) => CompanyFormState) => void
  lockSlug?: boolean
  showOrdering?: boolean
}) {
  // "Outro" libera a digitação livre sem sair da lista.
  const knownSector = SECTORS.includes(form.sector as (typeof SECTORS)[number])
  const custom = form.sector !== '' && !knownSector

  return (
    <div className="space-y-4">
      <Field label="Nome da empresa">
        <input
          className="input"
          required
          value={form.name}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              name: event.target.value,
              slug: lockSlug ? current.slug : slugify(event.target.value),
            }))
          }
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Setor">
          <select
            className="input"
            value={custom ? 'Outro' : form.sector}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                sector: event.target.value === 'Outro' ? ' ' : event.target.value,
              }))
            }
          >
            <option value="">Selecione…</option>
            {SECTORS.map((sector) => (
              <option key={sector} value={sector}>
                {sector}
              </option>
            ))}
          </select>
          {custom && (
            <input
              className="input mt-2"
              autoFocus
              placeholder="Qual setor?"
              value={form.sector.trim()}
              onChange={(event) => setForm((c) => ({ ...c, sector: event.target.value || ' ' }))}
            />
          )}
        </Field>

        <Field label="Identificador" hint="Usado nos endereços internos.">
          <input
            className="input"
            value={form.slug}
            onChange={(event) => setForm((c) => ({ ...c, slug: slugify(event.target.value) }))}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

      <Field asGroup label="Cor da aba">
        <div className="flex flex-wrap gap-2">
          {COMPANY_PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => setForm((c) => ({ ...c, color }))}
              className={`h-8 w-8 rounded-full border-2 transition ${
                form.color === color ? 'scale-110 border-content' : 'border-transparent'
              }`}
              style={{ backgroundColor: color }}
              aria-label={`Cor ${color}`}
            />
          ))}
        </div>
      </Field>

      {showOrdering && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Ordem na barra de abas">
            <input
              className="input"
              type="number"
              value={form.display_order}
              onChange={(event) =>
                setForm((c) => ({ ...c, display_order: Number(event.target.value) }))
              }
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
      )}
    </div>
  )
}
