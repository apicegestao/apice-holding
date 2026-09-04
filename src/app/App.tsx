import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from '../core/auth/AuthProvider'
import { CompanyProvider } from '../core/company/CompanyProvider'
import { Loading } from '../core/ui'
import AppLayout from './AppLayout'
import LoginPage from './LoginPage'
import ChangePasswordPage from './ChangePasswordPage'
import ProfilePage from './ProfilePage'
import HoldingDashboard from '../modules/dashboard/HoldingDashboard'
import CompanyDashboard from '../modules/dashboard/CompanyDashboard'
import CompaniesPage from '../modules/companies/CompaniesPage'
import CompanySettingsPage from '../modules/companies/CompanySettingsPage'
import KpisPage from '../modules/kpis/KpisPage'
import TasksPage from '../modules/tasks/TasksPage'
import HoldingTasksPage from '../modules/tasks/HoldingTasksPage'
import NotesPage from '../modules/notes/NotesPage'
import BudgetsPage from '../modules/budgets/BudgetsPage'
import FinancialsPage from '../modules/financials/FinancialsPage'
import ProductsPage from '../modules/products/ProductsPage'
import ProductDashboard from '../modules/dashboard/ProductDashboard'
import DepartmentsPage from '../modules/departments/DepartmentsPage'
import DepartmentDashboard from '../modules/dashboard/DepartmentDashboard'
import IntegrationsPage from '../modules/integrations/IntegrationsPage'
import InsightsPage from '../modules/insights/InsightsPage'
import UsersPage from '../modules/users/UsersPage'
import SettingsPage from '../modules/settings/SettingsPage'
import AuditPage from '../modules/audit/AuditPage'

function HomeRedirect() {
  const { isSuperAdmin, memberships } = useAuth()
  if (isSuperAdmin) return <Navigate to="/holding" replace />
  const first = memberships[0]
  if (!first) return <Navigate to="/sem-acesso" replace />
  return <Navigate to={`/empresa/${first.company.id}`} replace />
}

function NoAccess() {
  const { signOut, profile } = useAuth()
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="card max-w-md p-6 text-center">
        <h1 className="text-lg font-semibold">Nenhuma empresa liberada</h1>
        <p className="mt-2 text-sm text-content-muted">
          O acesso de <strong>{profile?.email}</strong> ainda não foi vinculado a nenhuma empresa.
          Peça ao administrador da holding para liberar.
        </p>
        <button type="button" className="btn-ghost mt-4" onClick={() => void signOut()}>
          Sair
        </button>
      </div>
    </div>
  )
}

/** Só o admin da holding entra nas telas consolidadas. */
function HoldingOnly({ children }: { children: JSX.Element }) {
  const { isSuperAdmin } = useAuth()
  return isSuperAdmin ? children : <Navigate to="/" replace />
}

export default function App() {
  const { session, profile, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <Loading label="Abrindo o Ápice Holding…" />
      </div>
    )
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location }} />} />
      </Routes>
    )
  }

  // Senha padrão ainda não trocada: o sistema não libera mais nada antes disso.
  if (profile?.must_change_password) {
    return (
      <Routes>
        <Route path="/trocar-senha" element={<ChangePasswordPage firstAccess />} />
        <Route path="*" element={<Navigate to="/trocar-senha" replace />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/sem-acesso" element={<NoAccess />} />

      <Route element={<AppLayout />}>
        <Route index element={<HomeRedirect />} />
        <Route path="/perfil" element={<ProfilePage />} />
        <Route path="/trocar-senha" element={<ChangePasswordPage />} />

        <Route
          path="/holding"
          element={
            <HoldingOnly>
              <HoldingDashboard />
            </HoldingOnly>
          }
        />
        <Route
          path="/holding/tarefas"
          element={
            <HoldingOnly>
              <HoldingTasksPage />
            </HoldingOnly>
          }
        />
        <Route
          path="/holding/empresas"
          element={
            <HoldingOnly>
              <CompaniesPage />
            </HoldingOnly>
          }
        />
        <Route
          path="/holding/usuarios"
          element={
            <HoldingOnly>
              <UsersPage scope="holding" />
            </HoldingOnly>
          }
        />
        <Route
          path="/holding/notas"
          element={
            <HoldingOnly>
              <NotesPage scope="holding" />
            </HoldingOnly>
          }
        />
        {/* /mapa-mental virou /notas — link antigo ainda cai num lugar de
            verdade em vez de dar 404. */}
        <Route
          path="/holding/mapa-mental"
          element={
            <HoldingOnly>
              <Navigate to="/holding/notas" replace />
            </HoldingOnly>
          }
        />
        <Route
          path="/holding/orcamentos"
          element={
            <HoldingOnly>
              <BudgetsPage scope="holding" />
            </HoldingOnly>
          }
        />
        <Route
          path="/holding/financeiro"
          element={
            <HoldingOnly>
              <FinancialsPage scope="holding" />
            </HoldingOnly>
          }
        />
        <Route
          path="/holding/insights"
          element={
            <HoldingOnly>
              <InsightsPage scope="holding" />
            </HoldingOnly>
          }
        />
        <Route
          path="/holding/auditoria"
          element={
            <HoldingOnly>
              <AuditPage scope="holding" />
            </HoldingOnly>
          }
        />
        <Route
          path="/holding/configuracoes"
          element={
            <HoldingOnly>
              <SettingsPage />
            </HoldingOnly>
          }
        />

        <Route path="/empresa/:companyId" element={<CompanyProvider />}>
          <Route index element={<CompanyDashboard />} />
          {/* Visão Geral (lista) e Detalhe (drill-down por breadcrumb) são a
              mesma tela — KpisPage decide qual mostrar pelo :kpiId. */}
          <Route path="kpis" element={<KpisPage />} />
          <Route path="kpis/:kpiId" element={<KpisPage />} />
          {/* /metas foi absorvida pelos KPIs — todo indicador com prazo já é
              uma meta. Link antigo (favorito, notificação já entregue) ainda
              cai num lugar de verdade em vez de dar 404. */}
          <Route path="metas" element={<Navigate to="../kpis" replace />} />
          <Route path="tarefas" element={<TasksPage />} />
          <Route path="produtos" element={<ProductsPage />} />
          {/* Painel escopado a uma frente de produto ou a uma turma dela —
              mesmo tipo de retrato do painel da empresa (indicadores, alvos,
              tarefas, orçamento), só que filtrado a este produto/turma.
              Mesmo componente decide o escopo pela presença de :editionId. */}
          <Route path="produtos/:productId" element={<ProductDashboard />} />
          <Route path="produtos/:productId/turmas/:editionId" element={<ProductDashboard />} />
          {/* Áreas — Fase 2 do mesmo plano: mesma ideia de painel escopado,
              agora por área/departamento interno em vez de produto. */}
          <Route path="areas" element={<DepartmentsPage />} />
          <Route path="areas/:departmentId" element={<DepartmentDashboard />} />
          <Route path="notas" element={<NotesPage />} />
          {/* /mapa-mental virou /notas — mesmo tratamento do link de /metas
              logo acima: cai num lugar de verdade, não em 404. */}
          <Route path="mapa-mental" element={<Navigate to="../notas" replace />} />
          <Route path="orcamentos" element={<BudgetsPage />} />
          <Route path="financeiro" element={<FinancialsPage />} />
          <Route path="integracoes" element={<IntegrationsPage />} />
          <Route path="insights" element={<InsightsPage scope="company" />} />
          <Route path="equipe" element={<UsersPage scope="company" />} />
          <Route path="auditoria" element={<AuditPage scope="company" />} />
          <Route path="configuracoes" element={<CompanySettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
