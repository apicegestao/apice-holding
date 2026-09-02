// Escolha de empresa. Em telas médias para cima é a barra de abas de sempre;
// no celular vira um botão com menu suspenso, para não gastar a largura da
// tela com uma fileira de abas que rola de lado.
import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Building2, ChevronDown, LayoutGrid } from 'lucide-react'
import { ROLE_LABEL, type Company, type Role } from '../core/types'

type Membership = { company: Company; role: Role }

export default function CompanySwitcher({
  isSuperAdmin,
  onHolding,
  holdingCompany,
  tabs,
  activeCompanyId,
}: {
  isSuperAdmin: boolean
  onHolding: boolean
  holdingCompany: Membership | undefined
  tabs: Membership[]
  activeCompanyId: string | undefined
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  // Fecha o menu ao trocar de rota por qualquer outro caminho (voltar do navegador etc).
  useEffect(() => {
    setOpen(false)
  }, [activeCompanyId, onHolding])

  const activeTab = tabs.find((item) => item.company.id === activeCompanyId)
  const currentLabel = onHolding ? 'Holding' : (activeTab?.company.name ?? 'Selecionar empresa')
  const currentColor = onHolding ? null : activeTab?.company.color

  const tabClass = (active: boolean) =>
    `flex shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-sm transition ${
      active
        ? 'border-brand-500 font-semibold text-content'
        : 'border-transparent text-content-soft hover:text-content'
    }`

  const itemClass = (active: boolean) =>
    `flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm ${
      active ? 'bg-brand/10 font-semibold text-brand-text' : 'text-content hover:bg-hover'
    }`

  const go = (to: string) => {
    setOpen(false)
    navigate(to)
  }

  return (
    <>
      {/* md e acima: a barra de abas. */}
      <nav className="hidden gap-1 overflow-x-auto px-2 sm:px-4 md:flex">
        {(isSuperAdmin || holdingCompany) && (
          <NavLink to="/holding" className={() => tabClass(onHolding)}>
            <LayoutGrid className="h-3.5 w-3.5" />
            Holding
          </NavLink>
        )}
        {tabs.map(({ company, role }) => (
          <NavLink
            key={company.id}
            to={`/empresa/${company.id}`}
            title={`${company.name} — ${ROLE_LABEL[role]}`}
            className={tabClass(company.id === activeCompanyId)}
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: company.color }}
            />
            {company.name}
          </NavLink>
        ))}
        {isSuperAdmin && (
          <NavLink
            to="/holding/empresas"
            className="flex shrink-0 items-center gap-1 border-b-2 border-transparent px-3 py-2.5 text-sm text-content-soft hover:text-content"
          >
            + Empresa
          </NavLink>
        )}
      </nav>

      {/* Abaixo de md: botão com o menu suspenso. */}
      <div ref={rootRef} className="relative border-b border-line px-3 py-2 md:hidden">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm"
        >
          <span className="flex min-w-0 items-center gap-2">
            {currentColor ? (
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: currentColor }}
              />
            ) : (
              <LayoutGrid className="h-3.5 w-3.5 shrink-0 text-content-soft" />
            )}
            <span className="truncate font-medium text-content">{currentLabel}</span>
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-content-soft transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {open && (
          <div className="absolute inset-x-3 top-full z-40 mt-1 max-h-[70vh] overflow-y-auto rounded-lg border border-line bg-elevated shadow-card">
            {(isSuperAdmin || holdingCompany) && (
              <button type="button" onClick={() => go('/holding')} className={itemClass(onHolding)}>
                <LayoutGrid className="h-3.5 w-3.5 shrink-0" />
                Holding
              </button>
            )}
            {tabs.map(({ company, role }) => (
              <button
                key={company.id}
                type="button"
                onClick={() => go(`/empresa/${company.id}`)}
                className={itemClass(company.id === activeCompanyId)}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: company.color }}
                />
                <span className="min-w-0 flex-1 truncate">{company.name}</span>
                <span className="shrink-0 text-xs text-content-faint">{ROLE_LABEL[role]}</span>
              </button>
            ))}
            {isSuperAdmin && (
              <button
                type="button"
                onClick={() => go('/holding/empresas')}
                className="flex w-full items-center gap-1.5 border-t border-line px-3.5 py-2.5 text-left text-sm text-content-soft hover:bg-hover"
              >
                <Building2 className="h-3.5 w-3.5" />
                + Empresa
              </button>
            )}
          </div>
        )}
      </div>
    </>
  )
}
