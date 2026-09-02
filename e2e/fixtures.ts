// Dados e mocks compartilhados pelos testes end-to-end. Todo teste roda contra
// a REST/Auth/RPC do Supabase totalmente simulada — sem rede externa — para
// que a suíte rode igual em qualquer máquina e no CI.
import type { Page } from '@playwright/test'

export const USER_ID = '11111111-1111-1111-1111-111111111111'
export const HOLDING_ID = '22222222-2222-2222-2222-222222222222'
export const COMPANY_ID = '33333333-3333-3333-3333-333333333333' // MDD — quase sem dados
export const COMPANY_ID_2 = '33333333-3333-3333-3333-333333333334' // Vibra — cheia de dados

const now = Math.floor(Date.now() / 1000)
const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url')
export const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
  sub: USER_ID,
  role: 'authenticated',
  exp: now + 3600,
  aud: 'authenticated',
})}.sig`

const USER = {
  id: USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'admin@apice.test',
  email_confirmed_at: '2026-01-01T00:00:00Z',
  app_metadata: {},
  user_metadata: { full_name: 'Rafael Portela' },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}
const PROFILE = {
  id: USER_ID,
  email: 'admin@apice.test',
  full_name: 'Rafael Portela',
  phone: null,
  job_title: 'Sócio',
  avatar_url: null,
  is_super_admin: true,
  must_change_password: false,
  is_active: true,
  last_login_at: '2026-09-02T10:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
}

const COMPANIES = [
  {
    id: HOLDING_ID,
    slug: 'apice-holding',
    name: 'Ápice Holding',
    legal_name: null,
    tax_id: null,
    sector: 'Holding',
    description: null,
    color: '#0EA5E9',
    logo_url: null,
    is_holding: true,
    parent_id: null,
    display_order: 0,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: COMPANY_ID,
    slug: 'mdd',
    name: 'MDD',
    legal_name: null,
    tax_id: null,
    sector: 'Consultoria',
    description: null,
    color: '#0EA5E9',
    logo_url: null,
    is_holding: false,
    parent_id: HOLDING_ID,
    display_order: 1,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: COMPANY_ID_2,
    slug: 'vibra',
    name: 'Vibra',
    legal_name: null,
    tax_id: null,
    sector: 'Marketing',
    description: null,
    color: '#F59E0B',
    logo_url: null,
    is_holding: false,
    parent_id: HOLDING_ID,
    display_order: 2,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
]

// KPI sem nenhum lançamento — é exatamente o caso do bug relatado (item 1):
// um KPI cadastrado que não tinha valor nenhum sumia do painel.
const KPI_NOVALUE = '44444444-4444-4444-4444-444444444441'
const KPI_WITH = '44444444-4444-4444-4444-444444444442'
const KPI_EXTRA = ['3', '4', '5'].map((n) => `44444444-4444-4444-4444-44444444444${n}`)

const KPIS = [
  {
    id: KPI_NOVALUE,
    company_id: COMPANY_ID,
    name: 'Faturamento',
    description: 'Receita bruta',
    category: 'Financeiro',
    unit: 'currency',
    direction: 'up',
    frequency: 'monthly',
    target_value: 500000,
    source: 'manual',
    integration_id: null,
    display_order: 0,
    is_active: true,
    created_by: USER_ID,
    created_at: '2026-09-02T00:13:52Z',
    updated_at: '2026-09-02T00:13:52Z',
    due_date: null,
    owner_id: null,
    status: 'active',
  },
  {
    id: KPI_WITH,
    company_id: COMPANY_ID_2,
    name: 'Receita recorrente (MRR)',
    description: 'MRR',
    category: 'Financeiro',
    unit: 'currency',
    direction: 'up',
    frequency: 'monthly',
    target_value: 80000,
    source: 'manual',
    integration_id: null,
    display_order: 0,
    is_active: true,
    created_by: USER_ID,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    // KPI com prazo = também é a meta (KPIs e Metas foram unificados).
    due_date: '2026-12-31',
    owner_id: USER_ID,
    status: 'active',
  },
  ...KPI_EXTRA.map((id, i) => ({
    id,
    company_id: COMPANY_ID_2,
    name: ['Ticket médio', 'Churn', 'Novos clientes'][i],
    description: '',
    category: 'Comercial',
    unit: i === 1 ? 'percent' : 'currency',
    direction: i === 1 ? 'down' : 'up',
    frequency: 'monthly',
    target_value: i === 1 ? 5 : 1000,
    source: 'manual',
    integration_id: null,
    display_order: i + 1,
    is_active: true,
    created_by: USER_ID,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    due_date: null,
    owner_id: null,
    status: 'active',
  })),
]
const LATEST = [
  {
    kpi_id: KPI_WITH,
    company_id: COMPANY_ID_2,
    period_start: '2026-08-01',
    period_end: '2026-08-31',
    value: 92345.67,
    target_value: 80000,
    name: 'Receita recorrente (MRR)',
    unit: 'currency',
    direction: 'up',
    frequency: 'monthly',
    category: 'Financeiro',
    due_date: '2026-12-31',
    owner_id: USER_ID,
    status: 'active',
  },
  ...KPI_EXTRA.map((id, i) => ({
    kpi_id: id,
    company_id: COMPANY_ID_2,
    period_start: '2026-08-01',
    period_end: '2026-08-31',
    value: i === 1 ? 4.2 : 1234.5,
    target_value: i === 1 ? 5 : 1000,
    name: ['Ticket médio', 'Churn', 'Novos clientes'][i],
    unit: i === 1 ? 'percent' : 'currency',
    direction: i === 1 ? 'down' : 'up',
    frequency: 'monthly',
    category: 'Comercial',
    due_date: null as string | null,
    owner_id: null as string | null,
    status: 'active',
  })),
]
const KPI_VALUES = LATEST.map((l) => ({
  id: l.kpi_id + '-v',
  ...l,
  note: null,
  source: 'manual',
  created_by: USER_ID,
  created_at: l.period_start + 'T00:00:00Z',
  updated_at: l.period_start + 'T00:00:00Z',
}))

export const TASKS = [
  {
    id: 't1',
    company_id: COMPANY_ID,
    title: 'Fechar balancete de agosto e conferir conciliação bancária',
    description: null,
    assignee_id: USER_ID,
    created_by: USER_ID,
    due_date: '2026-08-20',
    remind_at: null,
    reminder_sent_at: null,
    priority: 'high',
    status: 'todo',
    visibility: 'company',
    tags: ['financeiro', 'urgente'],
    mind_map_node_id: null,
    kpi_id: null,
    completed_at: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  },
  {
    id: 't2',
    company_id: COMPANY_ID_2,
    title: 'Revisar contrato do cliente',
    description: null,
    assignee_id: null,
    created_by: USER_ID,
    due_date: '2026-09-10',
    remind_at: null,
    reminder_sent_at: null,
    priority: 'medium',
    status: 'doing',
    visibility: 'private',
    tags: [],
    mind_map_node_id: null,
    kpi_id: null,
    completed_at: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  },
  {
    id: 't3',
    company_id: COMPANY_ID_2,
    title: 'Concluída',
    description: null,
    assignee_id: USER_ID,
    created_by: USER_ID,
    due_date: null,
    remind_at: null,
    reminder_sent_at: null,
    priority: 'low',
    status: 'done',
    visibility: 'company',
    tags: [],
    mind_map_node_id: null,
    kpi_id: null,
    completed_at: '2026-08-15T00:00:00Z',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-15T00:00:00Z',
  },
]

export const SNAPSHOTS = [
  {
    company_id: HOLDING_ID,
    company_name: 'Ápice Holding',
    company_color: '#0EA5E9',
    company_slug: 'apice-holding',
    is_holding: true,
    kpis_total: 0,
    kpis_on_target: 0,
    kpis_off_target: 0,
    goals_active: 0,
    goals_at_risk: 0,
    goals_achieved: 0,
    tasks_open: 0,
    tasks_overdue: 0,
    tasks_done_30d: 0,
    members_total: 1,
    last_activity: '2026-09-01T00:00:00Z',
  },
  {
    company_id: COMPANY_ID,
    company_name: 'MDD',
    company_color: '#0EA5E9',
    company_slug: 'mdd',
    is_holding: false,
    kpis_total: 1,
    kpis_on_target: 0,
    kpis_off_target: 0,
    goals_active: 0,
    goals_at_risk: 0,
    goals_achieved: 0,
    tasks_open: 1,
    tasks_overdue: 1,
    tasks_done_30d: 0,
    members_total: 1,
    last_activity: '2026-09-01T00:00:00Z',
  },
  {
    company_id: COMPANY_ID_2,
    company_name: 'Vibra',
    company_color: '#F59E0B',
    company_slug: 'vibra',
    is_holding: false,
    kpis_total: 4,
    kpis_on_target: 2,
    kpis_off_target: 2,
    goals_active: 1,
    goals_at_risk: 0,
    goals_achieved: 0,
    tasks_open: 1,
    tasks_overdue: 0,
    tasks_done_30d: 1,
    members_total: 3,
    last_activity: '2026-09-01T00:00:00Z',
  },
]

const MAP_ID = '88888888-8888-8888-8888-888888888881'
const MAPS = [
  {
    id: MAP_ID,
    company_id: HOLDING_ID,
    title: 'Ideias gerais',
    description: null,
    created_by: USER_ID,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
]
const NODES = [
  {
    id: 'n1',
    map_id: MAP_ID,
    company_id: HOLDING_ID,
    parent_id: null,
    label: 'Expansão 2027',
    notes: null,
    color: '#0EA5E9',
    position_x: 320,
    position_y: 220,
    collapsed: false,
  },
  {
    id: 'n2',
    map_id: MAP_ID,
    company_id: HOLDING_ID,
    parent_id: 'n1',
    label: 'Nova filial em Curitiba',
    notes: 'Estudar viabilidade',
    color: '#10B981',
    position_x: 580,
    position_y: 180,
    collapsed: false,
  },
]

// Dois insights em dias diferentes — dá pra conferir o agrupamento por data
// (item 1 do pedido) sem depender de fuso ou hora exata.
const today = new Date()
const threeDaysAgo = new Date(today.getTime() - 3 * 24 * 3600 * 1000)
export const INSIGHTS = [
  {
    id: 'ins1',
    company_id: null,
    scope: 'holding',
    title: 'Vibra puxa o resultado do grupo',
    body: 'A Vibra responde por 2 dos 4 KPIs na meta do grupo neste ciclo.',
    severity: 'opportunity',
    recommendation: 'Replicar o processo comercial da Vibra nas demais empresas.',
    model: 'gemini-2.5-flash',
    generated_at: today.toISOString(),
    generated_by: USER_ID,
    is_archived: false,
  },
  {
    id: 'ins2',
    company_id: null,
    scope: 'holding',
    title: 'MDD sem lançamento de faturamento há semanas',
    body: 'O KPI Faturamento da MDD não recebe lançamento desde a criação.',
    severity: 'warning',
    recommendation: 'Cobrar o primeiro lançamento do responsável pela MDD.',
    model: 'gemini-2.5-flash',
    generated_at: threeDaysAgo.toISOString(),
    generated_by: USER_ID,
    is_archived: false,
  },
]

const TABLES: Record<string, unknown[]> = {
  profiles: [PROFILE],
  companies: COMPANIES,
  company_members: [
    { company_id: HOLDING_ID, user_id: USER_ID, role: 'admin', created_at: '2026-01-01T00:00:00Z' },
    { company_id: COMPANY_ID, user_id: USER_ID, role: 'admin', created_at: '2026-01-01T00:00:00Z' },
    { company_id: COMPANY_ID_2, user_id: USER_ID, role: 'admin', created_at: '2026-01-01T00:00:00Z' },
  ],
  kpis: KPIS,
  kpi_values: KPI_VALUES,
  kpi_latest_values: LATEST,
  tasks: TASKS,
  task_shares: [],
  kpi_checkpoints: [],
  task_checklist_items: [],
  task_comments: [],
  mind_maps: MAPS,
  mind_map_nodes: NODES,
  integrations: [],
  integration_mappings: [],
  integration_runs: [],
  insights: INSIGHTS,
  notifications: [],
  audit_logs: [],
}

/** Substitui toda a REST/Auth/RPC do Supabase por respostas fixas — nenhuma
 *  rede sai da máquina que roda o teste. */
export async function mockSupabase(page: Page) {
  await page.route('**/*.supabase.co/**', async (route) => {
    const url = new URL(route.request().url())
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

    if (url.pathname.startsWith('/auth/v1/token'))
      return json({ access_token: JWT, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user: USER })
    if (url.pathname === '/auth/v1/user') return json(USER)
    if (url.pathname.startsWith('/auth/v1/logout')) return route.fulfill({ status: 204, body: '' })
    if (url.pathname.startsWith('/rest/v1/rpc/company_snapshots')) return json(SNAPSHOTS)
    if (url.pathname.startsWith('/rest/v1/rpc/tasks_for_company')) {
      const cid = JSON.parse(route.request().postData() || '{}').p_company
      return json(TASKS.filter((t) => t.company_id === cid))
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) return json([])
    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.replace('/rest/v1/', '').split('?')[0]
      if (route.request().method() !== 'GET') return json([])
      const rows = TABLES[table] ?? []
      const accept = route.request().headers()['accept'] ?? ''
      return json(accept.includes('vnd.pgrst.object') ? (rows[0] ?? null) : rows)
    }
    if (url.pathname.startsWith('/functions/v1/')) return json({ settings: {} })
    return json([])
  })
}

export async function login(page: Page) {
  await mockSupabase(page)
  await page.goto('/login')
  await page.fill('input[type=email]', 'admin@apice.test')
  await page.fill('input[type=password]', 'x')
  await page.getByRole('button', { name: /entrar/i }).click()
  await page.waitForURL(/\/(holding|empresa)/)
}

export const ROUTES: [string, string][] = [
  ['/holding', 'Painel da holding'],
  ['/holding/empresas', 'Empresas'],
  ['/holding/usuarios', 'Usuários'],
  ['/holding/insights', 'Insights'],
  ['/holding/mapa-mental', 'Mapa da holding'],
  ['/holding/auditoria', 'Auditoria'],
  ['/holding/configuracoes', 'Configurações'],
  [`/empresa/${COMPANY_ID}`, 'Painel MDD (sem dados)'],
  [`/empresa/${COMPANY_ID_2}`, 'Painel Vibra (com dados)'],
  [`/empresa/${COMPANY_ID_2}/kpis`, 'KPIs e metas'],
  // /metas foi absorvida pelos KPIs — confere que o link antigo ainda cai
  // num lugar de verdade em vez de dar 404.
  [`/empresa/${COMPANY_ID_2}/metas`, 'Metas (link antigo redireciona)'],
  [`/empresa/${COMPANY_ID_2}/tarefas`, 'Tarefas'],
  [`/empresa/${COMPANY_ID_2}/mapa-mental`, 'Mapa mental'],
  [`/empresa/${COMPANY_ID_2}/equipe`, 'Equipe'],
  [`/empresa/${COMPANY_ID_2}/integracoes`, 'Integrações'],
  [`/empresa/${COMPANY_ID_2}/insights`, 'Insights da empresa'],
  [`/empresa/${COMPANY_ID_2}/configuracoes`, 'Dados da empresa'],
  ['/perfil', 'Perfil'],
]
