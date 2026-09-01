// Tipos do domínio. Espelham as tabelas do Supabase e são a fonte única
// de verdade para os módulos — nenhum módulo define shape próprio de linha.

export type Role = 'admin' | 'collaborator' | 'viewer'

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  collaborator: 'Colaborador',
  viewer: 'Usuário',
}

export const ROLE_HINT: Record<Role, string> = {
  admin: 'Configura a empresa, gerencia acessos e integrações.',
  collaborator: 'Lança KPIs, cria tarefas e edita o mapa mental.',
  viewer: 'Só visualiza — e conclui as tarefas atribuídas a ele.',
}

export type Profile = {
  id: string
  email: string
  full_name: string
  phone: string | null
  job_title: string | null
  avatar_url: string | null
  is_super_admin: boolean
  must_change_password: boolean
  is_active: boolean
  last_login_at: string | null
  created_at: string
}

export type Company = {
  id: string
  slug: string
  name: string
  legal_name: string | null
  tax_id: string | null
  sector: string | null
  description: string | null
  color: string
  logo_url: string | null
  is_holding: boolean
  parent_id: string | null
  display_order: number
  is_active: boolean
  created_at: string
}

export type CompanyMember = {
  company_id: string
  user_id: string
  role: Role
  created_at: string
}

export type KpiUnit = 'currency' | 'percent' | 'number' | 'days' | 'ratio'
export type KpiDirection = 'up' | 'down'
export type KpiFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'

export const UNIT_LABEL: Record<KpiUnit, string> = {
  currency: 'R$',
  percent: '%',
  number: 'Número',
  days: 'Dias',
  ratio: 'Índice',
}

export const FREQUENCY_LABEL: Record<KpiFrequency, string> = {
  daily: 'Diário',
  weekly: 'Semanal',
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  yearly: 'Anual',
}

export type Kpi = {
  id: string
  company_id: string
  name: string
  description: string | null
  category: string | null
  unit: KpiUnit
  direction: KpiDirection
  frequency: KpiFrequency
  target_value: number | null
  roll_up: boolean
  source: 'manual' | 'integration'
  integration_id: string | null
  display_order: number
  is_active: boolean
  created_at: string
}

export type KpiValue = {
  id: string
  kpi_id: string
  company_id: string
  period_start: string
  period_end: string
  value: number
  target_value: number | null
  note: string | null
  source: string
  created_at: string
}

export type GoalStatus = 'planned' | 'active' | 'at_risk' | 'achieved' | 'missed'

export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  planned: 'Planejada',
  active: 'Em andamento',
  at_risk: 'Em risco',
  achieved: 'Atingida',
  missed: 'Não atingida',
}

export type Goal = {
  id: string
  company_id: string
  kpi_id: string | null
  title: string
  description: string | null
  target_value: number | null
  current_value: number
  unit: KpiUnit
  start_date: string
  due_date: string | null
  status: GoalStatus
  owner_id: string | null
  created_at: string
}

export type TaskStatus = 'todo' | 'doing' | 'blocked' | 'done' | 'canceled'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'A fazer',
  doing: 'Em andamento',
  blocked: 'Bloqueada',
  done: 'Concluída',
  canceled: 'Cancelada',
}

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  urgent: 'Urgente',
}

export type Task = {
  id: string
  company_id: string
  title: string
  description: string | null
  assignee_id: string | null
  created_by: string | null
  due_date: string | null
  remind_at: string | null
  reminder_sent_at: string | null
  priority: TaskPriority
  status: TaskStatus
  tags: string[]
  mind_map_node_id: string | null
  goal_id: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export type MindMap = {
  id: string
  company_id: string
  title: string
  description: string | null
  created_at: string
  updated_at: string
}

export type MindMapNode = {
  id: string
  map_id: string
  company_id: string
  parent_id: string | null
  label: string
  notes: string | null
  color: string
  position_x: number
  position_y: number
  collapsed: boolean
}

export type IntegrationStatus = 'idle' | 'running' | 'success' | 'error'

export type Integration = {
  id: string
  company_id: string
  name: string
  provider: string
  base_url: string
  http_method: 'GET' | 'POST'
  request_body: unknown
  headers: Record<string, string>
  auth_type: 'none' | 'bearer' | 'api_key' | 'basic'
  auth_header: string
  sync_interval_minutes: number
  is_active: boolean
  last_run_at: string | null
  last_status: IntegrationStatus
  last_error: string | null
  created_at: string
}

export type IntegrationMapping = {
  id: string
  integration_id: string
  company_id: string
  kpi_id: string
  json_path: string
  multiplier: number
  period_mode: 'current_day' | 'current_week' | 'current_month' | 'current_quarter' | 'current_year'
}

export type IntegrationRun = {
  id: string
  integration_id: string
  company_id: string
  status: IntegrationStatus
  started_at: string
  finished_at: string | null
  records: number
  error: string | null
  trigger_source: string
}

export type InsightSeverity = 'info' | 'opportunity' | 'warning' | 'critical'

export type Insight = {
  id: string
  company_id: string | null
  scope: 'company' | 'holding'
  title: string
  body: string
  severity: InsightSeverity
  recommendation: string | null
  model: string | null
  generated_at: string
  is_archived: boolean
}

export type Notification = {
  id: string
  user_id: string
  company_id: string | null
  kind: string
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

export type AuditLog = {
  id: number
  company_id: string | null
  actor_id: string | null
  action: string
  entity: string
  entity_id: string | null
  meta: Record<string, unknown>
  created_at: string
}

// Retorno da RPC company_snapshots() — o consolidado da holding.
export type CompanySnapshot = {
  company_id: string
  company_name: string
  company_color: string
  company_slug: string
  is_holding: boolean
  kpis_total: number
  kpis_on_target: number
  kpis_off_target: number
  goals_active: number
  goals_at_risk: number
  goals_achieved: number
  tasks_open: number
  tasks_overdue: number
  tasks_done_30d: number
  members_total: number
  last_activity: string
}

export type KpiLatestValue = {
  kpi_id: string
  company_id: string
  period_start: string
  period_end: string
  value: number
  target_value: number | null
  name: string
  unit: KpiUnit
  direction: KpiDirection
  frequency: KpiFrequency
  category: string | null
  roll_up: boolean
}
