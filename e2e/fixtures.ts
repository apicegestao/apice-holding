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
export const KPI_WITH = '44444444-4444-4444-4444-444444444442'
const KPI_EXTRA = ['3', '4', '5'].map((n) => `44444444-4444-4444-4444-44444444444${n}`)
// Cadeia produto → sub-produto: "Entre Donos" (produto, sem edição) nunca
// lança direto — o valor dele é a soma das turmas. "Imersão Set/2026" é a
// turma, com lançamento próprio e parent_kpi_id apontando pro produto.
export const KPI_PRODUCT = '44444444-4444-4444-4444-444444444446'
export const KPI_EDITION = '44444444-4444-4444-4444-444444444447'
export const PRODUCT_ID = '55555555-5555-5555-5555-555555555551'
export const EDITION_ID = '55555555-5555-5555-5555-555555555561'
// Turma sem meta própria ainda — cobre o estado vazio ("+ Meta desta turma").
export const EDITION_ID_2 = '55555555-5555-5555-5555-555555555562'

export const KPIS = [
  {
    id: KPI_NOVALUE,
    company_id: COMPANY_ID,
    name: 'Faturamento',
    description: 'Receita bruta',
    category: 'Financeiro',
    unit: 'currency',
    direction: 'up',
    frequency: 'monthly',
    source: 'manual',
    integration_id: null,
    display_order: 0,
    is_active: true,
    created_by: USER_ID,
    created_at: '2026-09-02T00:13:52Z',
    updated_at: '2026-09-02T00:13:52Z',
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
    source: 'manual',
    integration_id: null,
    display_order: 0,
    is_active: true,
    created_by: USER_ID,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
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
    source: 'manual',
    integration_id: null,
    display_order: i + 1,
    is_active: true,
    created_by: USER_ID,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  })),
  {
    id: KPI_PRODUCT,
    company_id: COMPANY_ID_2,
    name: 'Faturamento Entre Donos',
    description: 'Soma das turmas',
    category: 'Financeiro',
    unit: 'currency',
    direction: 'up',
    frequency: 'yearly',
    source: 'manual',
    integration_id: null,
    display_order: 4,
    is_active: true,
    created_by: USER_ID,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    product_id: PRODUCT_ID,
    product_edition_id: null,
    parent_kpi_id: null,
    archived_at: null,
    entry_frequency: null,
  },
  {
    id: KPI_EDITION,
    company_id: COMPANY_ID_2,
    name: 'Faturamento Imersão Set/2026',
    description: '',
    category: 'Financeiro',
    unit: 'currency',
    direction: 'up',
    frequency: 'monthly',
    source: 'manual',
    integration_id: null,
    display_order: 5,
    is_active: true,
    created_by: USER_ID,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    product_id: PRODUCT_ID,
    product_edition_id: EDITION_ID,
    parent_kpi_id: KPI_PRODUCT,
    archived_at: null,
    entry_frequency: null,
  },
]

// Uma meta por indicador (o caso comum hoje) — a tabela suporta várias por
// KPI, mas nenhum teste depende disso ainda. Só KPI_WITH tem prazo/
// responsável de verdade; os outros têm só um alvo (meta sem prazo). Alvo
// agora existe em todo nível — META_PRODUCT/META_EDITION cobrem produto e
// turma (KPI_PRODUCT/KPI_EDITION), lado a lado com os alvos de empresa.
const META_NOVALUE = '66666666-6666-6666-6666-666666666661'
const META_WITH = '66666666-6666-6666-6666-666666666662'
const META_EXTRA = ['3', '4', '5'].map((n) => `66666666-6666-6666-6666-66666666666${n}`)
const META_PRODUCT = '66666666-6666-6666-6666-666666666666'
const META_EDITION = '66666666-6666-6666-6666-666666666667'

export const METAS = [
  {
    id: META_NOVALUE,
    company_id: COMPANY_ID,
    kpi_id: KPI_NOVALUE,
    target_value: 500000,
    due_date: null,
    owner_id: null,
    status: 'active',
    archived_at: null,
    created_at: '2026-09-02T00:13:52Z',
    updated_at: '2026-09-02T00:13:52Z',
  },
  {
    id: META_WITH,
    company_id: COMPANY_ID_2,
    kpi_id: KPI_WITH,
    target_value: 80000,
    due_date: '2026-12-31',
    owner_id: USER_ID,
    status: 'active',
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  ...KPI_EXTRA.map((kpiId, i) => ({
    id: META_EXTRA[i],
    company_id: COMPANY_ID_2,
    kpi_id: kpiId,
    target_value: i === 1 ? 5 : 1000,
    due_date: null,
    owner_id: null,
    status: 'active',
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  })),
  // Alvo de produto e de turma — a mesma cadeia "Entre Donos" cobrindo os
  // dois níveis abaixo de empresa, pra exercitar alvo em todo nível.
  {
    id: META_PRODUCT,
    company_id: COMPANY_ID_2,
    kpi_id: KPI_PRODUCT,
    target_value: 400000,
    due_date: '2026-12-31',
    owner_id: null,
    status: 'active',
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: META_EDITION,
    company_id: COMPANY_ID_2,
    kpi_id: KPI_EDITION,
    target_value: 35000,
    due_date: '2026-09-17',
    owner_id: null,
    status: 'at_risk',
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
]

export const PRODUCTS = [
  {
    id: PRODUCT_ID,
    company_id: COMPANY_ID_2,
    name: 'Entre Donos',
    description: 'Imersão presencial em turmas',
    color: '#8B5CF6',
    display_order: 0,
    is_active: true,
    created_by: USER_ID,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
]

export const PRODUCT_EDITIONS = [
  {
    id: EDITION_ID,
    product_id: PRODUCT_ID,
    company_id: COMPANY_ID_2,
    name: 'Imersão Setembro 2026',
    start_date: '2026-09-15',
    end_date: '2026-09-17',
    status: 'em_andamento',
    created_by: USER_ID,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: EDITION_ID_2,
    product_id: PRODUCT_ID,
    company_id: COMPANY_ID_2,
    name: 'Imersão Outubro 2026',
    start_date: '2026-10-15',
    end_date: '2026-10-17',
    status: 'planejamento',
    created_by: USER_ID,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
]
const LATEST = [
  {
    kpi_id: KPI_WITH,
    company_id: COMPANY_ID_2,
    period_start: '2026-08-01',
    period_end: '2026-08-31',
    value: 92345.67,
    name: 'Receita recorrente (MRR)',
    unit: 'currency',
    direction: 'up',
    frequency: 'monthly',
    category: 'Financeiro',
    product_id: null as string | null,
    product_edition_id: null as string | null,
    parent_kpi_id: null as string | null,
    archived_at: null as string | null,
  },
  ...KPI_EXTRA.map((id, i) => ({
    kpi_id: id,
    company_id: COMPANY_ID_2,
    period_start: '2026-08-01',
    period_end: '2026-08-31',
    value: i === 1 ? 4.2 : 1234.5,
    name: ['Ticket médio', 'Churn', 'Novos clientes'][i],
    unit: i === 1 ? 'percent' : 'currency',
    direction: i === 1 ? 'down' : 'up',
    frequency: 'monthly',
    category: 'Comercial',
    product_id: null as string | null,
    product_edition_id: null as string | null,
    parent_kpi_id: null as string | null,
    archived_at: null as string | null,
  })),
  // Só a turma tem lançamento — o produto ("Faturamento Entre Donos") não
  // aparece aqui de propósito: o valor dele vem só da soma desta linha,
  // calculada no cliente, não de um lançamento próprio.
  {
    kpi_id: KPI_EDITION,
    company_id: COMPANY_ID_2,
    period_start: '2026-08-01',
    period_end: '2026-08-31',
    value: 32000,
    name: 'Faturamento Imersão Set/2026',
    unit: 'currency',
    direction: 'up',
    frequency: 'monthly',
    category: 'Financeiro',
    product_id: PRODUCT_ID as string | null,
    product_edition_id: EDITION_ID as string | null,
    parent_kpi_id: KPI_PRODUCT as string | null,
    archived_at: null as string | null,
  },
]
const KPI_VALUES = LATEST.map((l) => ({
  id: l.kpi_id + '-v',
  ...l,
  note: null,
  source: 'manual',
  created_by: USER_ID,
  created_at: l.period_start + 'T00:00:00Z',
  updated_at: l.period_start + 'T00:00:00Z',
  occurred_at: l.period_start + 'T00:00:00Z',
}))

// Uma linha por META (view meta_latest_values), lida pelo painel da holding —
// junta metas + kpis + kpi_latest_values. KPI_NOVALUE entra aqui com
// value: null (nunca teve lançamento).
const META_LATEST_VALUES = [
  {
    meta_id: META_NOVALUE,
    kpi_id: KPI_NOVALUE,
    company_id: COMPANY_ID,
    name: 'Faturamento',
    unit: 'currency',
    direction: 'up',
    product_id: null as string | null,
    product_edition_id: null as string | null,
    parent_kpi_id: null as string | null,
    value: null as number | null,
    period_start: null as string | null,
    period_end: null as string | null,
    target_value: 500000,
    due_date: null as string | null,
    owner_id: null as string | null,
    status: 'active',
    archived_at: null as string | null,
  },
  {
    meta_id: META_WITH,
    kpi_id: KPI_WITH,
    company_id: COMPANY_ID_2,
    name: 'Receita recorrente (MRR)',
    unit: 'currency',
    direction: 'up',
    product_id: null as string | null,
    product_edition_id: null as string | null,
    parent_kpi_id: null as string | null,
    value: 92345.67,
    period_start: '2026-08-01' as string | null,
    period_end: '2026-08-31' as string | null,
    target_value: 80000,
    due_date: '2026-12-31' as string | null,
    owner_id: USER_ID as string | null,
    status: 'active',
    archived_at: null as string | null,
  },
  ...KPI_EXTRA.map((kpiId, i) => ({
    meta_id: META_EXTRA[i],
    kpi_id: kpiId,
    company_id: COMPANY_ID_2,
    name: ['Ticket médio', 'Churn', 'Novos clientes'][i],
    unit: i === 1 ? 'percent' : 'currency',
    direction: i === 1 ? 'down' : 'up',
    product_id: null as string | null,
    product_edition_id: null as string | null,
    parent_kpi_id: null as string | null,
    value: i === 1 ? 4.2 : 1234.5,
    period_start: '2026-08-01' as string | null,
    period_end: '2026-08-31' as string | null,
    target_value: i === 1 ? 5 : 1000,
    due_date: null as string | null,
    owner_id: null as string | null,
    status: 'active',
    archived_at: null as string | null,
  })),
  // Alvo de produto — KPI_PRODUCT não tem lançamento próprio (o valor dele
  // vem só da soma da turma, calculada no cliente), por isso value: null
  // aqui — mesmo comportamento de qualquer meta pai sem lançamento direto.
  {
    meta_id: META_PRODUCT,
    kpi_id: KPI_PRODUCT,
    company_id: COMPANY_ID_2,
    name: 'Faturamento Entre Donos',
    unit: 'currency',
    direction: 'up',
    product_id: PRODUCT_ID as string | null,
    product_edition_id: null as string | null,
    parent_kpi_id: null as string | null,
    value: null as number | null,
    period_start: null as string | null,
    period_end: null as string | null,
    target_value: 400000,
    due_date: '2026-12-31' as string | null,
    owner_id: null as string | null,
    status: 'active',
    archived_at: null as string | null,
  },
  // Alvo de turma.
  {
    meta_id: META_EDITION,
    kpi_id: KPI_EDITION,
    company_id: COMPANY_ID_2,
    name: 'Faturamento Imersão Set/2026',
    unit: 'currency',
    direction: 'up',
    product_id: PRODUCT_ID as string | null,
    product_edition_id: EDITION_ID as string | null,
    parent_kpi_id: KPI_PRODUCT as string | null,
    value: 32000,
    period_start: '2026-08-01' as string | null,
    period_end: '2026-08-31' as string | null,
    target_value: 35000,
    due_date: '2026-09-17' as string | null,
    owner_id: null as string | null,
    status: 'at_risk',
    archived_at: null as string | null,
  },
]

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

// Nota é privada de quem escreveu (RLS: user_id = auth.uid()) — como o mock
// da REST não simula RLS, a fixture já representa o que o próprio USER_ID
// enxergaria: só as notas dele.
export const NOTES = [
  {
    id: 'note1',
    company_id: HOLDING_ID,
    user_id: USER_ID,
    title: 'Ideias para 2027',
    body: 'Expansão para Curitiba — estudar viabilidade antes do orçamento anual.',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
]

export const BUDGET_ID = '99999999-9999-9999-9999-999999999991'
const BUDGETS = [
  {
    id: BUDGET_ID,
    company_id: COMPANY_ID_2,
    title: 'Imersão 2027',
    description: 'Evento anual com convidados e mentoria.',
    event_date: '2027-03-15',
    status: 'planejamento',
    owner_id: USER_ID,
    created_by: USER_ID,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  },
]
const BUDGET_ITEMS = [
  {
    id: 'bi1',
    budget_id: BUDGET_ID,
    company_id: COMPANY_ID_2,
    kind: 'despesa',
    category: 'Alimentação',
    title: 'Buffet do evento',
    vendor: 'Fornecedor Sabor & Cia',
    status: 'cotado',
    planned_amount: 18000,
    actual_amount: null,
    due_date: '2027-03-10',
    notes: null,
    created_by: USER_ID,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  },
  {
    id: 'bi2',
    budget_id: BUDGET_ID,
    company_id: COMPANY_ID_2,
    kind: 'receita',
    category: 'Ingressos',
    title: 'Venda de ingressos',
    vendor: null,
    status: 'previsto',
    planned_amount: 50000,
    actual_amount: 12000,
    due_date: '2027-02-20',
    notes: null,
    created_by: USER_ID,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
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
    body: 'A Vibra responde por 2 das 4 metas no alvo do grupo neste ciclo.',
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
    body: 'A meta Faturamento da MDD não recebe lançamento desde a criação.',
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
  metas: METAS,
  meta_latest_values: META_LATEST_VALUES,
  products: PRODUCTS,
  product_editions: PRODUCT_EDITIONS,
  tasks: TASKS,
  task_shares: [],
  kpi_checkpoints: [],
  task_checklist_items: [],
  task_comments: [],
  notes: NOTES,
  budgets: BUDGETS,
  budget_items: BUDGET_ITEMS,
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
  ['/holding/tarefas', 'Tarefas da holding'],
  ['/holding/empresas', 'Empresas'],
  ['/holding/usuarios', 'Usuários'],
  ['/holding/insights', 'Insights'],
  ['/holding/notas', 'Notas da holding'],
  ['/holding/orcamentos', 'Orçamentos da holding'],
  ['/holding/auditoria', 'Auditoria'],
  ['/holding/configuracoes', 'Configurações'],
  [`/empresa/${COMPANY_ID}`, 'Painel MDD (sem dados)'],
  [`/empresa/${COMPANY_ID_2}`, 'Painel Vibra (com dados)'],
  [`/empresa/${COMPANY_ID_2}/kpis`, 'Metas'],
  // /metas foi absorvida pelos KPIs — confere que o link antigo ainda cai
  // num lugar de verdade em vez de dar 404.
  [`/empresa/${COMPANY_ID_2}/metas`, 'Metas (link antigo redireciona)'],
  [`/empresa/${COMPANY_ID_2}/tarefas`, 'Tarefas'],
  [`/empresa/${COMPANY_ID_2}/produtos`, 'Produtos'],
  [`/empresa/${COMPANY_ID_2}/notas`, 'Notas'],
  [`/empresa/${COMPANY_ID_2}/orcamentos`, 'Orçamentos'],
  [`/empresa/${COMPANY_ID_2}/equipe`, 'Equipe'],
  [`/empresa/${COMPANY_ID_2}/integracoes`, 'Integrações'],
  [`/empresa/${COMPANY_ID_2}/insights`, 'Insights da empresa'],
  [`/empresa/${COMPANY_ID_2}/configuracoes`, 'Dados da empresa'],
  ['/perfil', 'Perfil'],
]
