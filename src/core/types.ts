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
  collaborator: 'Lança metas e cria tarefas.',
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

// ---------------------------------------------------------- produtos/frentes
// Dentro de uma empresa, várias frentes de produto ou serviço (ex.: numa
// empresa de eventos e cursos, "Entre Donos", "Imersão", "Mentoria", "Club").
// Frente recorrente (Entre Donos, Imersão) cadastra uma edição por turma;
// frente contínua (Mentoria, Club) pode não ter edição nenhuma — o produto
// funciona sozinho. KPI, tarefa e orçamento se ligam a um produto (e,
// quando existe, a uma edição) por uma coluna opcional — nada muda pra quem
// não usa.
export type Product = {
  id: string
  company_id: string
  name: string
  description: string | null
  color: string | null
  display_order: number
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export type ProductEditionStatus = 'planejamento' | 'em_andamento' | 'encerrado'

export const PRODUCT_EDITION_STATUS_LABEL: Record<ProductEditionStatus, string> = {
  planejamento: 'Planejamento',
  em_andamento: 'Em andamento',
  encerrado: 'Encerrado',
}

export type ProductEdition = {
  id: string
  product_id: string
  company_id: string
  name: string
  start_date: string | null
  end_date: string | null
  status: ProductEditionStatus
  created_by: string | null
  created_at: string
  updated_at: string
}

export type KpiUnit = 'currency' | 'percent' | 'number' | 'days' | 'ratio'
export type KpiDirection = 'up' | 'down'
export type KpiFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'

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
  biweekly: 'Quinzenal',
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  yearly: 'Anual',
}

// Frequência PRINCIPAL do KPI — nunca inclui 'daily'. O período de um KPI
// diário é, por definição, um único dia (period_start = period_end): não tem
// como "somar" lançamentos de dias diferentes num período que já é um dia só,
// então quem escolhe 'daily' como frequência principal nunca consegue ver o
// total de uma meta lançada dia a dia (ex. vendas até uma data) — o painel
// sempre mostra a leitura do dia mais recente, ignorando os outros dias. Pra
// esse caso ('eu lanço todo dia e quero que some'), 'daily' continua
// disponível como entry_frequency (cadência mais fina) de qualquer frequência
// mais larga — ali sim os lançamentos somam de verdade (gatilho em
// 0026_kpi_lifecycle.sql). Reforçado no banco por uma constraint (migração
// 0030) — nenhuma tela nova pode reintroduzir o problema por engano.
//
// Ordem em que as frequências aparecem em qualquer seletor — da mais fina pra
// mais larga. Um único lugar pra isso; nenhuma tela lista `Object.keys` e
// arrisca uma ordem diferente da outra.
export const FREQUENCIES: KpiFrequency[] = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']

/** Cadências que cabem como entry_frequency dentro de cada frequency — só as
 *  mais finas que ela fazem sentido (não dá pra "lançar por ano" uma meta
 *  mensal). Usado pra montar a lista de opções na hora de configurar o KPI. */
export const FINER_FREQUENCIES: Record<KpiFrequency, KpiFrequency[]> = {
  daily: [],
  weekly: ['daily'],
  biweekly: ['daily', 'weekly'],
  monthly: ['daily', 'weekly', 'biweekly'],
  quarterly: ['daily', 'weekly', 'biweekly', 'monthly'],
  yearly: ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly'],
}

// AVISO DE NOMENCLATURA: no texto que o usuário vê, o tipo `Kpi` aparece
// como "Meta" (a coisa medida) e o tipo `Meta` aparece como "Alvo" (o
// alvo/prazo/responsável de uma meta). Os nomes técnicos abaixo (tipos,
// tabelas, colunas) continuam os mesmos de sempre — é só o texto da tela
// que mudou.
//
// Indicador: o que se mede (unidade, direção, frequência, de qual
// produto/edição é, histórico via kpi_values) — a ferramenta de medição.
// A meta (alvo, prazo, responsável, andamento) mora em `Meta`, à parte: um
// indicador pode ter zero, uma ou várias metas ao mesmo tempo (ex. meta
// mensal e meta anual de "Faturamento", sem duplicar o indicador nem
// lançar o valor duas vezes).
export type Kpi = {
  id: string
  company_id: string
  name: string
  description: string | null
  category: string | null
  unit: KpiUnit
  direction: KpiDirection
  frequency: KpiFrequency
  source: 'manual' | 'integration'
  integration_id: string | null
  display_order: number
  is_active: boolean
  created_at: string
  // Frente de produto/serviço (ex. "Entre Donos") e, se ela roda em turmas,
  // a edição específica (ex. "Turma 12") — os dois opcionais, um KPI segue
  // podendo ser só "da empresa" sem nenhum dos dois.
  product_id: string | null
  product_edition_id: string | null
  // null = ativo. Arquivar não apaga nada, só tira da tela principal — só
  // manual agora (arquivar/desarquivar na tela de KPIs); o indicador nunca
  // mais arquiva sozinho por causa de uma meta vencida — só a meta em si
  // (Meta.archived_at) arquiva automaticamente.
  archived_at: string | null
  // KPI da frente principal (ex. "Entre Donos", product_edition_id nulo) que
  // este KPI de sub-produto/turma contribui — o valor do pai soma o dos
  // filhos (soma de valor medido, independente de qualquer meta). Sem teto
  // de profundidade fixo — só sem ciclo (checado no banco).
  parent_kpi_id: string | null
  // Quando preenchida, é a cadência REAL do lançamento (mais fina que
  // frequency) — ex. total anual (frequency) lançado mês a mês
  // (entry_frequency). null = lança direto no período de frequency, como
  // sempre foi.
  entry_frequency: KpiFrequency | null
}

// Meta: alvo, prazo, responsável e andamento sobre UM indicador — várias
// metas podem apontar pro mesmo `kpi_id` (mesmo indicador, mais de um
// objetivo ao mesmo tempo). "Meta de empresa/produto/turma" não é campo
// aqui: vem do indicador que ela referencia (kpis.product_id/
// product_edition_id) — uma meta herda o nível de quem ela mede.
export type Meta = {
  id: string
  company_id: string
  kpi_id: string
  target_value: number | null
  due_date: string | null
  owner_id: string | null
  status: GoalStatus
  // null = ativa. Arquiva sozinha quando due_date passa (cron diário) —
  // sem tocar no indicador nem no histórico de valores dele.
  archived_at: string | null
  created_at: string
  updated_at: string
}

// Periodicidade de repartição de um alvo — independente de KpiFrequency:
// aquela é "de quanto em quanto tempo o indicador é medido", esta é "em
// quantos pedaços o CRONOGRAMA do alvo se divide" (dá pra medir um
// indicador mensalmente e ainda repartir o alvo anual dele por trimestre).
export type CheckpointFrequency =
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'bimonthly'
  | 'quarterly'
  | 'semiannual'
  | 'yearly'

export const CHECKPOINT_FREQUENCY_LABEL: Record<CheckpointFrequency, string> = {
  daily: 'Dia',
  weekly: 'Semana',
  biweekly: 'Quinzena',
  monthly: 'Mês',
  bimonthly: 'Bimestre',
  quarterly: 'Trimestre',
  semiannual: 'Semestre',
  yearly: 'Ano',
}

// Ordem da mais fina pra mais larga — mesma convenção de FREQUENCIES.
export const CHECKPOINT_FREQUENCIES: CheckpointFrequency[] = [
  'daily',
  'weekly',
  'biweekly',
  'monthly',
  'bimonthly',
  'quarterly',
  'semiannual',
  'yearly',
]

/** Uma parcela do alvo de uma meta — "esse mês precisa de X" em vez de só o
 *  número final. Opcional; gerada sob pedido. Cada parcela é uma COTA do
 *  próprio período (alvo de 100 em 4 meses = 4 parcelas de 25), não mais um
 *  acumulado — comparável contra o que foi lançado naquele período. */
export type KpiCheckpoint = {
  id: string
  meta_id: string
  company_id: string
  seq: number
  period_start: string
  period_end: string
  target_value: number
  frequency: CheckpointFrequency
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

// Status de um KPI que também é meta (tem due_date). Um KPI sem prazo não
// usa este campo pra nada — fica em 'active' por padrão e ninguém olha.
export type GoalStatus = 'planned' | 'active' | 'at_risk' | 'achieved' | 'missed'

export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  planned: 'Planejada',
  active: 'Em andamento',
  at_risk: 'Em risco',
  achieved: 'Atingida',
  missed: 'Não atingida',
}

export type TaskStatus = 'todo' | 'doing' | 'blocked' | 'done' | 'canceled'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TaskVisibility = 'private' | 'company' | 'shared'

export const VISIBILITY_LABEL: Record<TaskVisibility, string> = {
  private: 'Só minha',
  company: 'Da empresa',
  shared: 'Compartilhada',
}

export const VISIBILITY_HINT: Record<TaskVisibility, string> = {
  private: 'Ninguém mais vê esta tarefa — nem o admin da holding.',
  company: 'Todos que têm acesso a esta empresa enxergam.',
  shared: 'Só quem você escolher: empresas e/ou pessoas específicas.',
}

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
  // Lembretes padrão: N dias antes do prazo e no próprio dia, sempre no
  // mesmo horário. remind_at é calculado pelo banco a partir destes três —
  // nunca digitado direto.
  remind_days_before: number | null
  remind_time: string
  due_reminder_sent_at: string | null
  priority: TaskPriority
  status: TaskStatus
  visibility: TaskVisibility
  tags: string[]
  kpi_id: string | null
  product_id: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export type TaskShare = {
  id: string
  task_id: string
  company_id: string | null
  user_id: string | null
  created_by: string | null
  created_at: string
}

export type TaskChecklistItem = {
  id: string
  task_id: string
  company_id: string
  title: string
  done: boolean
  position: number
  created_by: string | null
  created_at: string
}

export type TaskComment = {
  id: string
  task_id: string
  company_id: string
  author_id: string | null
  body: string
  created_at: string
}

// Bloco de notas pessoal — veio no lugar do mapa mental. A diferença que
// importa não é a interface (lista simples em vez de canvas), é a
// privacidade: RLS restringe leitura e escrita a user_id = auth.uid(), nem
// outro admin da mesma empresa enxerga a nota de alguém.
export type Note = {
  id: string
  company_id: string
  user_id: string
  title: string
  body: string
  created_at: string
  updated_at: string
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
  products_active: number
  last_activity: string
}

// ------------------------------------------------------------- orçamentos
export type BudgetStatus = 'planejamento' | 'aprovado' | 'em_andamento' | 'encerrado'
export type BudgetItemKind = 'receita' | 'despesa'
export type BudgetItemStatus = 'previsto' | 'cotado' | 'aprovado' | 'pago' | 'cancelado'

export const BUDGET_STATUS_LABEL: Record<BudgetStatus, string> = {
  planejamento: 'Planejamento',
  aprovado: 'Aprovado',
  em_andamento: 'Em andamento',
  encerrado: 'Encerrado',
}

export const BUDGET_ITEM_STATUS_LABEL: Record<BudgetItemKind, Record<BudgetItemStatus, string>> = {
  despesa: {
    previsto: 'Previsto',
    cotado: 'Cotado',
    aprovado: 'Aprovado',
    pago: 'Pago',
    cancelado: 'Cancelado',
  },
  receita: {
    previsto: 'Previsto',
    cotado: 'Em negociação',
    aprovado: 'Confirmado',
    pago: 'Recebido',
    cancelado: 'Cancelado',
  },
}

export type Budget = {
  id: string
  company_id: string
  title: string
  description: string | null
  event_date: string | null
  status: BudgetStatus
  owner_id: string | null
  product_id: string | null
  product_edition_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type BudgetItem = {
  id: string
  budget_id: string
  company_id: string
  kind: BudgetItemKind
  category: string
  title: string
  vendor: string | null
  status: BudgetItemStatus
  planned_amount: number
  actual_amount: number | null
  due_date: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

// Uma linha por INDICADOR (view kpi_latest_values) — só medição, sem meta
// nenhuma embutida. Pra saber se um indicador tem meta e como ela anda,
// ver `MetaLatestValue`.
export type KpiLatestValue = {
  kpi_id: string
  company_id: string
  period_start: string
  period_end: string
  value: number
  name: string
  unit: KpiUnit
  direction: KpiDirection
  frequency: KpiFrequency
  category: string | null
  product_id: string | null
  product_edition_id: string | null
  parent_kpi_id: string | null
  archived_at: string | null
}

// Uma linha por META (view meta_latest_values) — o "KpiLatestValue de
// antes", só que um kpi_id pode aparecer mais de uma vez (uma vez por meta
// que aquele indicador tem). `value` vem sempre do último lançamento do
// indicador (kpi_latest_values por trás), null se ainda não tem nenhum.
export type MetaLatestValue = {
  meta_id: string
  kpi_id: string
  company_id: string
  name: string
  unit: KpiUnit
  direction: KpiDirection
  product_id: string | null
  product_edition_id: string | null
  parent_kpi_id: string | null
  value: number | null
  period_start: string | null
  period_end: string | null
  target_value: number | null
  due_date: string | null
  owner_id: string | null
  status: GoalStatus
  archived_at: string | null
}

/** Um lançamento fino (entry_frequency) — várias destas somam pro período
 *  "grosso" (frequency) do mesmo KPI em kpi_values, via trigger no banco.
 *  A tela nunca escreve em kpi_values quando entry_frequency está preenchida:
 *  escreve aqui, e o banco recalcula a soma sozinho. */
export type KpiValueEntry = {
  id: string
  kpi_id: string
  company_id: string
  period_start: string
  period_end: string
  value: number
  note: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}
