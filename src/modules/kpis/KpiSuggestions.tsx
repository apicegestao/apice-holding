// Sugestões prontas de meta: escolher e usar, sem preencher formulário.
// O caminho de criar uma meta própria continua ao lado, intacto.
import { useMemo, useState } from 'react'
import { Check, Search } from 'lucide-react'
import { KPI_CATALOG, KPI_CATEGORIES, type KpiTemplate } from '../../core/catalog'
import { unitAffix } from '../../core/lib/format'
import { FREQUENCY_LABEL } from '../../core/types'

export default function KpiSuggestions({
  existingNames,
  selected,
  onToggle,
}: {
  existingNames: string[]
  selected: string[]
  onToggle: (template: KpiTemplate) => void
}) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>('')

  const already = useMemo(
    () => new Set(existingNames.map((name) => name.trim().toLowerCase())),
    [existingNames],
  )

  const results = useMemo(() => {
    const term = search.trim().toLowerCase()
    return KPI_CATALOG.filter((item) => {
      if (category && item.category !== category) return false
      if (!term) return true
      return (
        item.name.toLowerCase().includes(term) ||
        item.category.toLowerCase().includes(term) ||
        item.description.toLowerCase().includes(term)
      )
    })
  }, [search, category])

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-faint" />
        <input
          className="input pl-9"
          placeholder="Buscar meta…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setCategory('')}
          className={`chip border ${
            category === ''
              ? 'border-brand-500 bg-brand/15 text-brand-text'
              : 'border-line-strong bg-surface text-content-muted'
          }`}
        >
          Todas
        </button>
        {KPI_CATEGORIES.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setCategory(item)}
            className={`chip border ${
              category === item
                ? 'border-brand-500 bg-brand/15 text-brand-text'
                : 'border-line-strong bg-surface text-content-muted'
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      {results.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong px-4 py-8 text-center text-sm text-content-soft">
          Nenhuma sugestão com esse termo. Você pode criar a meta do zero na outra aba.
        </p>
      ) : (
        <ul className="grid grid-cols-1 max-h-[46vh] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {results.map((template) => {
            const added = already.has(template.name.toLowerCase())
            const on = selected.includes(template.name)
            return (
              <li key={template.name}>
                <button
                  type="button"
                  disabled={added}
                  onClick={() => onToggle(template)}
                  className={`flex w-full gap-2.5 rounded-lg border p-3 text-left transition ${
                    added
                      ? 'cursor-not-allowed border-line bg-hover opacity-60'
                      : on
                        ? 'border-brand-500 bg-brand/10'
                        : 'border-line hover:border-line-strong hover:bg-hover'
                  }`}
                >
                  <span
                    className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border ${
                      on ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong bg-surface'
                    }`}
                  >
                    {on && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-content">
                      {template.name}
                      {added && (
                        <span className="ml-1.5 text-xs font-normal text-content-faint">
                          já cadastrada
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-content-soft">
                      {template.description}
                    </span>
                    <span className="mt-1 block text-[11px] text-content-faint">
                      {template.category} · {FREQUENCY_LABEL[template.frequency]} ·{' '}
                      {template.direction === 'up' ? 'quanto maior, melhor' : 'quanto menor, melhor'}
                      {unitAffix(template.unit).prefix && ` · em ${unitAffix(template.unit).prefix}`}
                      {unitAffix(template.unit).suffix && ` · em ${unitAffix(template.unit).suffix}`}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
