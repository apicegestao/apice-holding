// Escopo de empresa. Tudo abaixo de /empresa/:companyId roda dentro deste
// contexto — nenhum módulo lê companyId da rota por conta própria.
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { Navigate, Outlet, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../ui'
import type { Company, Role } from '../types'

type CompanyValue = {
  company: Company
  role: Role
  canWrite: boolean
  isAdmin: boolean
}

const CompanyContext = createContext<CompanyValue | null>(null)

export function CompanyProvider({ children }: { children?: ReactNode }) {
  const { companyId } = useParams<{ companyId: string }>()
  const { memberships, loading, roleIn } = useAuth()

  const membership = useMemo(
    () => memberships.find((item) => item.company.id === companyId),
    [memberships, companyId],
  )

  if (loading) return <Loading />

  // Empresa fora do alcance do usuário: não existe atalho por URL.
  if (!membership) return <Navigate to="/" replace />

  const role = roleIn(membership.company.id) ?? membership.role

  const value: CompanyValue = {
    company: membership.company,
    role,
    canWrite: role === 'admin' || role === 'collaborator',
    isAdmin: role === 'admin',
  }

  return (
    <CompanyContext.Provider value={value}>{children ?? <Outlet />}</CompanyContext.Provider>
  )
}

export function useCompany() {
  const context = useContext(CompanyContext)
  if (!context) throw new Error('useCompany precisa estar dentro de <CompanyProvider>')
  return context
}
