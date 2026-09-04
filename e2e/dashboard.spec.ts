// Suíte de regressão do painel: mesma rota, mesmos dados simulados, rodando
// nos dois projetos configurados em playwright.config.ts (Desktop e Mobile
// 390px) — assim qualquer recurso novo entra automaticamente na cobertura
// dos dois formatos, sem depender de alguém lembrar de testar o celular.
import { expect, test } from '@playwright/test'
import {
  COMPANY_ID,
  COMPANY_ID_2,
  CONTACT_ID,
  CONTACT_STAGE_ID,
  CONTACT_STAGE_ID_2,
  CONTACT_STAGES,
  CONTACTS,
  DEPARTMENT_ID,
  DEPARTMENTS,
  EDITION_ID,
  EDITION_ID_2,
  FINANCIAL_ENTRIES,
  FINANCIAL_ENTRY_ID,
  HOLDING_ID,
  KPI_EDITION,
  KPI_PRODUCT,
  KPI_WITH,
  KPIS,
  login,
  META_LATEST_VALUES,
  METAS,
  mockSupabase,
  NOTES,
  PRODUCT_EDITIONS,
  PRODUCT_ID,
  PRODUCTS,
  PROFILE,
  ROUTES,
  TASKS,
  USER_ID,
} from './fixtures'

// Todo input/select/textarea precisa ter pelo menos 16px no celular — abaixo
// disso o Safari do iOS dá zoom sozinho ao focar o campo, e como as trocas de
// tela são navegação de SPA (sem recarregar a página), o zoom fica grudado na
// tela seguinte. Um helper só, usado em toda parte que precisa conferir isso.
// Caixa de seleção, rádio, cor, faixa e arquivo abrem um controle nativo do
// sistema (não um cursor de texto) — só esses tipos de <input> ficam de fora,
// porque só quem aceita texto digitado é que o Safari dá zoom ao focar.
const NON_TEXT_INPUT_TYPES = new Set(['checkbox', 'radio', 'range', 'color', 'file', 'button', 'submit', 'reset'])

const checkNoTinyFormFields = async (page: import('@playwright/test').Page) => {
  const tiny = await page.evaluate((skipTypes) => {
    const problems: string[] = []
    document.querySelectorAll('input, select, textarea').forEach((el) => {
      const type = (el as HTMLInputElement).type
      if (skipTypes.includes(type)) return
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return // não visível, não conta
      const size = parseFloat(getComputedStyle(el).fontSize)
      if (size < 16) {
        problems.push(`${el.tagName.toLowerCase()}(${size}px): ${el.outerHTML.slice(0, 80)}`)
      }
    })
    return problems
  }, [...NON_TEXT_INPUT_TYPES])
  expect(tiny, tiny.join('\n')).toEqual([])
}

test.describe('painel', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  // Item 2: nenhuma rota pode forçar rolagem lateral no documento — nem no
  // desktop, nem no celular.
  for (const [path, label] of ROUTES) {
    test(`sem rolagem lateral — ${label}`, async ({ page }) => {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement
        return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth }
      })
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)
    })
  }

  // Nenhum campo pode abrir com zoom no celular (ver checkNoTinyFormFields).
  for (const [path, label] of ROUTES) {
    test(`nenhum campo abre com zoom no celular — ${label}`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'Mobile 390', 'só faz sentido no celular')
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await checkNoTinyFormFields(page)
    })
  }

  // Item 1: uma meta cadastrada sem nenhum valor lançado ainda é uma meta de
  // verdade — não pode desaparecer do painel da empresa.
  test('meta sem lançamento aparece no painel (não some)', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID}`)
    await page.waitForLoadState('networkidle')
    // Âncora no início ("^") pra não colidir com "Faturamento Entre Donos"
    // (produto da Vibra, também sem lançamento direto — o mock de REST não
    // filtra por empresa, então as duas aparecem na mesma consulta).
    await expect(page.getByRole('link', { name: /^Faturamento —/ })).toBeVisible()
  })

  // Itens 4 e 5: gráficos comparativos aparecem quando há o que comparar.
  test('gráficos comparativos aparecem no painel da empresa', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Metas: realizado x alvo')).toBeVisible()
    await expect(page.getByText('Tarefas por situação')).toBeVisible()
  })

  test('gráfico comparativo entre empresas aparece no painel da holding', async ({ page }) => {
    await page.goto('/holding')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Metas x realizado')).toBeVisible()
    // Ranking de faturamento por produto no grupo — substituiu o gráfico
    // "Metas no alvo por empresa" (redundante com a barrinha compacta que
    // passou a viver dentro de cada cartão de empresa).
    await expect(page.getByText('Faturamento por produto no grupo')).toBeVisible()
  })

  // Bug relatado pelo usuário: o card de empresa no painel da Holding não
  // mostrava o valor de uma meta de empresa cujo lançamento só existe dois
  // níveis abaixo (produto → turma) — a página lia direto de
  // meta_latest_values (view que só traz linha com valor pra KPI com
  // lançamento PRÓPRIO) em vez de somar a cadeia parent_kpi_id no
  // cliente, do jeito que CompanyDashboard/ProductsPage já faziam.
  // KPI_PRODUCT/KPI_EDITION (fixtures) sozinhos não reproduzem o caso: o
  // painel da Holding só olha meta de indicador de empresa inteira
  // (product_id null, filtrado no load()), e KPI_PRODUCT tem product_id
  // preenchido. Por isso este teste cria um indicador de empresa novo e
  // reparenta KPI_PRODUCT por baixo dele, formando uma cadeia de 3
  // níveis (empresa → produto → turma).
  test('meta de empresa aparece na holding quando o valor só existe dois níveis abaixo (produto → turma)', async ({ page }) => {
    const ROOT_KPI = 'kpi-holding-rollup-teste'
    const ROOT_META = 'meta-holding-rollup-teste'
    const kpis = KPIS.map((item) => (item.id === KPI_PRODUCT ? { ...item, parent_kpi_id: ROOT_KPI } : item)).concat({
      id: ROOT_KPI,
      company_id: COMPANY_ID_2,
      name: 'Faturamento total do grupo (teste)',
      description: '',
      category: 'Financeiro',
      unit: 'currency',
      direction: 'up',
      frequency: 'yearly',
      source: 'manual',
      integration_id: null,
      display_order: 6,
      is_active: true,
      created_by: USER_ID,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      product_id: null,
      product_edition_id: null,
      parent_kpi_id: null,
      archived_at: null,
      entry_frequency: null,
    })
    // Espelha exatamente o que a view meta_latest_values de verdade
    // devolveria: value null, porque este indicador nunca lança direto —
    // o valor de verdade é a soma de KPI_PRODUCT → KPI_EDITION (32000),
    // calculada no cliente.
    // O cartão de empresa só mostra as 4 primeiras metas da lista
    // (companyMetas.slice(0, 4)) — a Vibra já tem 4 outras metas nas
    // fixtures (WITH + os 3 KPI_EXTRA), então sem esse filtro a nova meta
    // deste teste ficaria de fora do corte antes mesmo de chegar à tela.
    // Mantém só a meta de MRR (KPI_WITH) da Vibra, ao lado da nova.
    const metaLatest = META_LATEST_VALUES.filter(
      (row) => row.company_id !== COMPANY_ID_2 || row.kpi_id === KPI_WITH,
    ).concat({
      meta_id: ROOT_META,
      kpi_id: ROOT_KPI,
      company_id: COMPANY_ID_2,
      name: 'Faturamento total do grupo (teste)',
      unit: 'currency',
      direction: 'up',
      product_id: null,
      product_edition_id: null,
      parent_kpi_id: null,
      value: null,
      period_start: null,
      period_end: null,
      target_value: 500000,
      due_date: '2026-12-31',
      owner_id: null,
      status: 'active',
      archived_at: null,
    })
    await page.route('**/rest/v1/kpis*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(kpis) })
    })
    await page.route('**/rest/v1/meta_latest_values*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(metaLatest) })
    })

    await page.goto('/holding')
    await page.waitForLoadState('networkidle')

    const row = page.locator('li', { hasText: 'Faturamento total do grupo (teste)' })
    await expect(row).toBeVisible()
    // 32000 é o valor lançado só em KPI_EDITION (turma), duas cadeias
    // parent_kpi_id abaixo — se a soma no cliente quebrar, volta a
    // mostrar "—" (o value: null vindo direto da view). O valor aparece
    // duas vezes na linha (destaque + legenda "de R$ 500.000,00").
    await expect(row.getByText('R$ 32.000,00').first()).toBeVisible()
  })

  // Item 3: no celular a troca de empresa é um menu suspenso; no desktop
  // continua sendo as abas no topo. O mesmo componente decide sozinho pela
  // largura da tela — nenhuma lógica duplicada entre as duas versões.
  test('seletor de empresa: abas no desktop, menu suspenso no celular', async ({ page }, testInfo) => {
    await page.goto('/holding')
    await page.waitForLoadState('networkidle')
    const isMobile = testInfo.project.name === 'Mobile 390'
    const desktopTabs = page.locator('nav.md\\:flex a', { hasText: 'Vibra' })
    const mobileToggle = page.locator('div.md\\:hidden button').first()
    if (isMobile) {
      await expect(mobileToggle).toBeVisible()
      await expect(desktopTabs).toBeHidden()
    } else {
      await expect(desktopTabs).toBeVisible()
      await expect(mobileToggle).toBeHidden()
    }
  })

  // Item 2 (rodada de capitalização): "Insights da Holding" com H maiúsculo
  // e "Ver Todos" como botão de verdade, não link de texto solto.
  test('card de insights da holding: título e botão corretos', async ({ page }) => {
    await page.goto('/holding')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Insights da Holding', { exact: true })).toBeVisible()
    const verTodos = page.getByRole('link', { name: 'Ver Todos' })
    await expect(verTodos).toBeVisible()
    await expect(verTodos).toHaveClass(/btn-ghost/)
  })

  // Item 1 (rodada de usabilidade): abrir o sino de notificações e depois
  // clicar em qualquer outro lugar da tela fecha o menu — antes só fechava
  // clicando de novo no próprio sino.
  test('dropdown de notificações fecha ao clicar fora', async ({ page }) => {
    await page.goto('/holding')
    await page.waitForLoadState('networkidle')
    await page.getByLabel('Notificações').click()
    await expect(page.getByText('Nada por aqui ainda.')).toBeVisible()
    await page.locator('main').click({ position: { x: 10, y: 10 } })
    await expect(page.getByText('Nada por aqui ainda.')).toBeHidden()
  })

  // Item 1: a lista completa de insights aparece organizada por data, com
  // um insight de hoje e outro de alguns dias atrás em grupos separados.
  test('insights aparecem organizados por data', async ({ page }) => {
    await page.goto('/holding/insights')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Hoje', { exact: true })).toBeVisible()
    await expect(page.getByText('Vibra puxa o resultado do grupo')).toBeVisible()
    await expect(page.getByText('MDD sem lançamento de faturamento há semanas')).toBeVisible()
  })

  // Pedido do usuário: quando uma meta é desativada (na tela de Metas), ela
  // some dos números do painel — mas não em silêncio: um aviso discreto
  // avisa quantas existem, sem trazer os dados delas de volta.
  test('card "metas desativadas" aparece no painel quando há alguma', async ({ page }) => {
    const inactiveKpi = {
      ...KPIS[0],
      id: 'kpi-desativado-teste',
      company_id: COMPANY_ID_2,
      name: 'Indicador desativado (teste)',
      is_active: false,
    }
    // O mock padrão de `kpis` não filtra por query string — aqui precisa
    // filtrar de verdade por `is_active`, senão a consulta que busca só
    // desativados voltaria com a tabela inteira (inclusive ativos).
    await page.route('**/rest/v1/kpis*', async (route) => {
      const isInactiveQuery = new URL(route.request().url()).searchParams.get('is_active') === 'eq.false'
      const body = isInactiveQuery ? [inactiveKpi] : KPIS
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })

    await page.goto(`/empresa/${COMPANY_ID_2}`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('1 meta(s) desativada(s) — não entram nos números acima.')).toBeVisible()
  })
})

// Sugestão do usuário no lugar do card "Metas" (removido, redundante com
// "Produtos"/"Alvos"): faturamento de cada produto, mês a mês, no mesmo
// gráfico — mesmo truque de "folha da árvore" que productRevenue já usa no
// painel da Holding (kpiRollup.ts), aplicado como série no tempo em vez de
// ranking de um instante só.
test.describe('comparação de produtos no painel da empresa', () => {
  test('mostra uma linha por produto quando há faturamento em mais de um mês', async ({ page }) => {
    await login(page)

    const MENTORIA_ID = 'produto-mentoria-teste'
    const KPI_MENTORIA = 'kpi-mentoria-teste'
    const products = PRODUCTS.concat({
      id: MENTORIA_ID,
      company_id: COMPANY_ID_2,
      name: 'Mentoria',
      description: null,
      color: '#10B981',
      display_order: 1,
      is_active: true,
      created_by: USER_ID,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })
    const kpis = KPIS.concat({
      id: KPI_MENTORIA,
      company_id: COMPANY_ID_2,
      name: 'Faturamento Mentoria',
      description: '',
      category: 'Financeiro',
      unit: 'currency',
      direction: 'up',
      frequency: 'monthly',
      source: 'manual',
      integration_id: null,
      display_order: 6,
      is_active: true,
      created_by: USER_ID,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      product_id: MENTORIA_ID,
      product_edition_id: null,
      parent_kpi_id: null,
      archived_at: null,
      entry_frequency: null,
    })
    // Dois meses pra cada produto — "Entre Donos" via KPI_EDITION (a folha
    // real, ligada por parent_kpi_id a KPI_PRODUCT), "Mentoria" via um kpi
    // sem filho nenhum (ele mesmo já é folha).
    const kpiValues = [
      { kpi_id: KPI_EDITION, period_start: '2026-07-01', value: 20000 },
      { kpi_id: KPI_EDITION, period_start: '2026-08-01', value: 32000 },
      { kpi_id: KPI_MENTORIA, period_start: '2026-07-01', value: 5000 },
      { kpi_id: KPI_MENTORIA, period_start: '2026-08-01', value: 7000 },
    ].map((row, i) => ({
      id: `v-teste-${i}`,
      company_id: COMPANY_ID_2,
      period_end: `${row.period_start.slice(0, 7)}-28`,
      target_value: null,
      note: null,
      source: 'manual',
      created_by: USER_ID,
      created_at: `${row.period_start}T00:00:00Z`,
      updated_at: `${row.period_start}T00:00:00Z`,
      occurred_at: `${row.period_start}T00:00:00Z`,
      ...row,
    }))

    await page.route('**/rest/v1/products*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(products) }),
    )
    await page.route('**/rest/v1/kpis*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(kpis) }),
    )
    await page.route('**/rest/v1/kpi_values*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(kpiValues) }),
    )

    await page.goto(`/empresa/${COMPANY_ID_2}`)
    await page.waitForLoadState('networkidle')

    const chartCard = page.locator('section', { has: page.getByRole('heading', { name: 'Comparação entre produtos' }) })
    await expect(chartCard.getByText('Entre Donos')).toBeVisible()
    await expect(chartCard.getByText('Mentoria')).toBeVisible()
    // O card "Metas" antigo não existe mais — só o resto que ele cobria
    // (indicador sem lançamento) continua, num card à parte.
    await expect(page.getByRole('heading', { name: 'Metas', exact: true })).toHaveCount(0)
  })
})

// Pedido do usuário: "clico em Felipe e tenho um painel de controle com
// todas as metas direcionadas e de responsabilidade dele" — atalho a
// partir do card "Equipe" (empresa) e "Equipe do grupo" (Holding), levando
// pra uma tela só da pessoa, cruzando toda empresa em comum.
test.describe('atalho de performance por responsável', () => {
  const TEAMMATE_ID = '11111111-1111-1111-1111-111111111199'
  const TEAMMATE_PROFILE = {
    id: TEAMMATE_ID,
    email: 'felipe@apice.test',
    full_name: 'Felipe Nunes',
    phone: null,
    job_title: 'Gerente comercial',
    avatar_url: null,
    is_super_admin: false,
    must_change_password: false,
    is_active: true,
    last_login_at: null,
    created_at: '2026-01-01T00:00:00Z',
  }
  const TEAMMATE_META = {
    id: 'meta-teammate-teste',
    company_id: COMPANY_ID_2,
    kpi_id: KPI_WITH,
    target_value: 100000,
    due_date: '2026-10-31',
    owner_id: TEAMMATE_ID,
    status: 'at_risk',
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
  const TEAMMATE_META_LATEST = {
    meta_id: 'meta-teammate-teste',
    kpi_id: KPI_WITH,
    company_id: COMPANY_ID_2,
    name: 'Receita recorrente (MRR)',
    unit: 'currency',
    direction: 'up',
    product_id: null as string | null,
    product_edition_id: null as string | null,
    parent_kpi_id: null as string | null,
    value: 92345.67,
    period_start: '2026-08-01',
    period_end: '2026-08-31',
    target_value: 100000,
    due_date: '2026-10-31',
    owner_id: TEAMMATE_ID,
    status: 'at_risk',
    archived_at: null as string | null,
  }
  const TEAMMATE_TASK = {
    id: 'task-teammate-teste',
    company_id: COMPANY_ID_2,
    title: 'Follow-up com o cliente X',
    description: null,
    assignee_id: TEAMMATE_ID,
    created_by: USER_ID,
    due_date: '2020-01-01',
    remind_at: null,
    reminder_sent_at: null,
    priority: 'high',
    status: 'todo',
    visibility: 'company',
    tags: [],
    kpi_id: null,
    completed_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }

  test.beforeEach(async ({ page }) => {
    await login(page)

    // Rotas com filtro de verdade — o catch-all padrão devolve a tabela
    // inteira ignorando query string (ver comentário no topo de fixtures.ts),
    // mas PersonDashboard.tsx filtra por owner_id/assignee_id/id de
    // propósito, então o mock precisa respeitar isso aqui. `matchesId`
    // cobre tanto `.eq('id', x)` (id=eq.x) quanto `.in('id', [...])`
    // (id=in.(x,y)) — CompanyDashboard usa o segundo pra achar profiles a
    // partir de company_members.
    const matchesId = (filter: string | null, id: string) => {
      if (!filter) return true
      if (filter.startsWith('in.')) return filter.slice(4, -1).split(',').includes(id)
      return filter === `eq.${id}`
    }
    await page.route('**/rest/v1/profiles*', async (route) => {
      const idFilter = new URL(route.request().url()).searchParams.get('id')
      const rows = [PROFILE, TEAMMATE_PROFILE].filter((p) => matchesId(idFilter, p.id))
      const accept = route.request().headers()['accept'] ?? ''
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(accept.includes('vnd.pgrst.object') ? (rows[0] ?? null) : rows),
      })
    })
    // Felipe vira membro da Vibra — sem isso, o card "Equipe" (que só
    // considera quem já é company_members desta empresa) nunca chegaria a
    // olhar pra ele.
    await page.route('**/rest/v1/company_members*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { company_id: HOLDING_ID, user_id: USER_ID, role: 'admin', created_at: '2026-01-01T00:00:00Z' },
          { company_id: COMPANY_ID, user_id: USER_ID, role: 'admin', created_at: '2026-01-01T00:00:00Z' },
          { company_id: COMPANY_ID_2, user_id: USER_ID, role: 'admin', created_at: '2026-01-01T00:00:00Z' },
          { company_id: COMPANY_ID_2, user_id: TEAMMATE_ID, role: 'collaborator', created_at: '2026-01-01T00:00:00Z' },
        ]),
      }),
    )
    await page.route('**/rest/v1/metas*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(METAS.concat(TEAMMATE_META)),
      }),
    )
    await page.route('**/rest/v1/meta_latest_values*', async (route) => {
      const ownerFilter = new URL(route.request().url()).searchParams.get('owner_id')
      const all = META_LATEST_VALUES.concat(TEAMMATE_META_LATEST)
      const rows = ownerFilter ? all.filter((m) => ownerFilter === `eq.${m.owner_id}`) : all
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) })
    })
    await page.route('**/rest/v1/tasks*', async (route) => {
      const assigneeFilter = new URL(route.request().url()).searchParams.get('assignee_id')
      const all = TASKS.concat(TEAMMATE_TASK)
      const rows = assigneeFilter ? all.filter((t) => assigneeFilter === `eq.${t.assignee_id}`) : all
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) })
    })
  })

  test('card "Equipe" no painel da empresa mostra quem precisa de atenção e leva à performance dela', async ({
    page,
  }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}`)
    await page.waitForLoadState('networkidle')

    // Rafael (admin da fixture) também aparece no ranking — tem uma tarefa
    // vencida dele mesmo (mock global, sem filtro de empresa de verdade) —
    // por isso a linha do Felipe é buscada por nome pra não colidir com a
    // dele na mesma checagem de badge.
    const teamCard = page.locator('section', { has: page.getByRole('heading', { name: 'Equipe' }) })
    const felipeRow = teamCard.getByRole('link', { name: /Felipe Nunes/ })
    await expect(felipeRow).toBeVisible()
    await expect(felipeRow.getByText('1 vencida(s)')).toBeVisible()

    await felipeRow.click()
    await page.waitForURL(`**/equipe/${TEAMMATE_ID}`)
    await expect(page.getByRole('heading', { name: 'Felipe Nunes', level: 1 })).toBeVisible()
    await expect(page.getByText('Receita recorrente (MRR)')).toBeVisible()
    await expect(page.getByText('Follow-up com o cliente X')).toBeVisible()
  })

  test('"Equipe do grupo" no painel da Holding mostra quem está em risco em qualquer empresa', async ({ page }) => {
    await page.goto('/holding')
    await page.waitForLoadState('networkidle')

    const teamCard = page.locator('section', { has: page.getByRole('heading', { name: 'Equipe do grupo' }) })
    await expect(teamCard.getByText('Felipe Nunes')).toBeVisible()
    await expect(teamCard.getByText('1 em risco')).toBeVisible()

    await teamCard.getByText('Felipe Nunes').click()
    await page.waitForURL(`**/holding/usuarios/${TEAMMATE_ID}`)
    await expect(page.getByRole('heading', { name: 'Felipe Nunes', level: 1 })).toBeVisible()
  })
})

// Busca no seletor de empresa (celular): só aparece com empresas de sobra
// pra valer a pena, filtra sem acento/caixa, e mostra o "nenhuma encontrada"
// quando a busca não bate com nada. Mock com mais empresas que o padrão da
// suíte (2) — é isso que liga a busca.
test.describe('seletor de empresa: busca', () => {
  test('filtra a lista e ignora acento/caixa', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'Mobile 390', 'o seletor em menu suspenso só existe no celular')
    await login(page)

    const manyCompanies = [
      { id: HOLDING_ID, name: 'Ápice Holding', slug: 'apice-holding', is_holding: true, parent_id: null },
      { id: COMPANY_ID, name: 'MDD', slug: 'mdd', is_holding: false, parent_id: HOLDING_ID },
      { id: COMPANY_ID_2, name: 'Vibra', slug: 'vibra', is_holding: false, parent_id: HOLDING_ID },
      { id: 'c-orbita', name: 'Órbita Consultoria', slug: 'orbita', is_holding: false, parent_id: HOLDING_ID },
      { id: 'c-nexus', name: 'Nexus Tech', slug: 'nexus', is_holding: false, parent_id: HOLDING_ID },
      { id: 'c-fortaleza', name: 'Fortaleza Log', slug: 'fortaleza', is_holding: false, parent_id: HOLDING_ID },
      { id: 'c-aurora', name: 'Aurora Eventos', slug: 'aurora', is_holding: false, parent_id: HOLDING_ID },
    ].map((c) => ({
      ...c,
      legal_name: null,
      tax_id: null,
      sector: null,
      description: null,
      color: '#0EA5E9',
      logo_url: null,
      display_order: 0,
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }))

    await page.route('**/rest/v1/companies*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(manyCompanies) })
    })
    await page.route('**/rest/v1/company_members*', async (route) => {
      const rows = manyCompanies.map((c) => ({ company_id: c.id, user_id: USER_ID, role: 'admin', created_at: c.created_at }))
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) })
    })

    await page.goto('/holding')
    await page.waitForLoadState('networkidle')

    // Escopado no próprio seletor — a holding tem tarefas de outras empresas
    // na tela por trás, e "Vibra" também aparece lá.
    const switcher = page.locator('div.md\\:hidden').first()
    await switcher.locator('button').first().click()

    const search = switcher.getByPlaceholder('Buscar empresa…')
    await expect(search).toBeVisible()

    await search.fill('vib')
    await expect(switcher.getByRole('button', { name: /Vibra/ })).toBeVisible()
    await expect(switcher.getByRole('button', { name: /^MDD/ })).toBeHidden()

    // Sem acento e sem caixa acha "Órbita" mesmo assim.
    await search.fill('orbita')
    await expect(switcher.getByRole('button', { name: /Órbita/ })).toBeVisible()

    await search.fill('empresa que não existe')
    await expect(switcher.getByText('Nenhuma empresa encontrada.')).toBeVisible()
  })

  test('não aparece com poucas empresas', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'Mobile 390', 'o seletor em menu suspenso só existe no celular')
    await login(page)
    await page.goto('/holding')
    await page.waitForLoadState('networkidle')
    const switcher = page.locator('div.md\\:hidden').first()
    await switcher.locator('button').first().click()
    await expect(switcher.getByPlaceholder('Buscar empresa…')).toBeHidden()
  })
})

// Item 3: subtarefas e notas vivem dentro da própria tarefa, editáveis ali.
// Mock com estado próprio (checklist/notas persistem entre as chamadas desta
// suíte) para exercitar o ciclo real de criar e ver aparecer.
test.describe('subtarefas e notas', () => {
  test('adicionar subtarefa e nota na tarefa', async ({ page }) => {
    await login(page)

    const checklist: Record<string, unknown>[] = []
    const notes: Record<string, unknown>[] = []
    const parseId = (url: string) => new URL(url).searchParams.get('id')?.replace('eq.', '') ?? ''

    await page.route('**/rest/v1/task_checklist_items*', async (route) => {
      const req = route.request()
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}')
        checklist.push({ id: `chk${checklist.length + 1}`, done: false, created_at: new Date().toISOString(), ...body })
      } else if (req.method() === 'PATCH') {
        const item = checklist.find((c) => c.id === parseId(req.url()))
        if (item) Object.assign(item, JSON.parse(req.postData() || '{}'))
      } else if (req.method() === 'DELETE') {
        const id = parseId(req.url())
        const idx = checklist.findIndex((c) => c.id === id)
        if (idx >= 0) checklist.splice(idx, 1)
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(checklist) })
    })

    await page.route('**/rest/v1/task_comments*', async (route) => {
      const req = route.request()
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}')
        notes.push({ id: `note${notes.length + 1}`, created_at: new Date().toISOString(), author_id: USER_ID, ...body })
      } else if (req.method() === 'DELETE') {
        const id = parseId(req.url())
        const idx = notes.findIndex((n) => n.id === id)
        if (idx >= 0) notes.splice(idx, 1)
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(notes) })
    })

    await page.goto(`/empresa/${COMPANY_ID}/tarefas`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Editar' }).first().click()
    await page.waitForTimeout(300)

    await page.getByPlaceholder('Adicionar subtarefa…').fill('Conferir extrato bancário')
    await page.getByPlaceholder('Adicionar subtarefa…').press('Enter')
    const item = page.locator('li', { hasText: 'Conferir extrato bancário' })
    await expect(item).toBeVisible()
    await item.getByRole('checkbox').check()

    // Item 2: um título sem nenhum espaço (não pode quebrar linha) já causou
    // rolagem lateral no modal antes — flex-1 sem min-w-0 não encolhe abaixo
    // do conteúdo. Regressão direta para não voltar a acontecer.
    const longTitle = 'Conciliacaobancariacompletadetodasasfilialiseregionaisdoprimeirotrimestre'
    await page.getByPlaceholder('Adicionar subtarefa…').fill(longTitle)
    await page.getByPlaceholder('Adicionar subtarefa…').press('Enter')
    await expect(page.locator('li', { hasText: longTitle })).toBeVisible()

    await page.getByPlaceholder('Escreva uma nota sobre o andamento…').fill('Falei com o financeiro hoje.')
    await page.locator('textarea + button').click()
    await expect(page.getByText('Falei com o financeiro hoje.')).toBeVisible()

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth }
    })
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)
  })
})

// Item 4: um quadro só, com todas as empresas, acessível pelo menu da holding.
test.describe('tarefas da holding', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('atalho na sidebar leva ao quadro consolidado', async ({ page }) => {
    await page.goto('/holding')
    await page.waitForLoadState('networkidle')
    // Escopado no menu do módulo (aside) — a página também tem um link
    // "Tarefas" por cartão de empresa, com o mesmo texto.
    await page.locator('aside nav a', { hasText: 'Tarefas' }).click()
    await expect(page).toHaveURL(/\/holding\/tarefas$/)
    await expect(page.getByText('Tarefas da Holding')).toBeVisible()
  })

  test('mostra tarefas de mais de uma empresa no mesmo quadro', async ({ page }) => {
    await page.goto('/holding/tarefas')
    await page.waitForLoadState('networkidle')
    const mddTask = page.locator('article', { hasText: 'Fechar balancete de agosto' })
    const vibraTask = page.locator('article', { hasText: 'Revisar contrato do cliente' })
    await expect(mddTask).toBeVisible()
    await expect(vibraTask).toBeVisible()
    await expect(mddTask.getByText('MDD', { exact: true })).toBeVisible()
    await expect(vibraTask.getByText('Vibra', { exact: true })).toBeVisible()
  })
})

// Item 1: lembrete por menu suspenso (dias antes) + horário, não mais uma
// data e hora digitadas por extenso.
test.describe('lembretes de tarefa', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('escolher dias antes e horário do lembrete', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID}/tarefas`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Editar' }).first().click()
    await page.waitForTimeout(300)

    await expect(page.getByLabel('Lembrar quantos dias antes')).toBeVisible()
    await expect(page.getByLabel('Horário do lembrete')).toBeVisible()
    await page.getByLabel('Lembrar quantos dias antes').selectOption('3')
    await expect(page.getByLabel('Lembrar quantos dias antes')).toHaveValue('3')
  })
})

// Item 82: o mapa mental virou um bloco de notas simples — privado por
// usuário (RLS, coberto por teste de RLS direto no banco, não aqui: o mock
// da REST roda sempre como um único usuário). Aqui cobrimos só o CRUD e o
// aviso de privacidade na tela.
test.describe('notas', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('lista a nota existente e avisa que é só do usuário', async ({ page }) => {
    await page.goto('/holding/notas')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Ideias para 2027', { exact: true })).toBeVisible()
    await expect(page.getByText('Só você enxerga estas notas')).toBeVisible()
  })

  test('cria uma nota nova e ela aparece na lista', async ({ page }) => {
    // Mock com estado próprio (como em "subtarefas e notas" acima) — a nota
    // criada precisa aparecer na recarga que a página faz depois de salvar,
    // e o mock estático de TABLES não persiste POST nenhum.
    const notes: Record<string, unknown>[] = [...NOTES]
    await page.route('**/rest/v1/notes*', async (route) => {
      const req = route.request()
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}')
        notes.push({ id: `note${notes.length + 1}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...body })
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(notes) })
    })

    await page.goto('/holding/notas')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Nova nota' }).click()
    await page.getByLabel('Título').fill('Reunião de sócios')
    await page.getByLabel('Anotação').fill('Pauta: revisão do orçamento anual.')
    await page.getByRole('button', { name: 'Salvar' }).click()
    await expect(page.getByRole('heading', { name: 'Nova nota' })).not.toBeVisible()
    await expect(page.getByText('Reunião de sócios', { exact: true })).toBeVisible()
  })

  test('editar nota abre o modal preenchido', async ({ page }) => {
    await page.goto('/holding/notas')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Editar nota' }).click()
    await expect(page.getByLabel('Título')).toHaveValue('Ideias para 2027')
  })

  test('pedir exclusão de nota abre confirmação, não exclui direto', async ({ page }) => {
    await page.goto('/holding/notas')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Excluir nota' }).click()
    await expect(page.getByText('Excluir nota?')).toBeVisible()
  })
})

// Item 5: orçamento por evento/projeto, com totais previsto x realizado
// calculados a partir das linhas de verdade — confere a matemática e que o
// modal (tabela larga) não estoura a tela nem no celular.
test.describe('orçamentos', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('abre o orçamento e mostra os totais calculados corretamente', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}/orcamentos`)
    await page.waitForLoadState('networkidle')
    await page.getByText('Imersão 2027', { exact: true }).click()

    // bi1: despesa prevista 18.000 (sem realizado). bi2: receita prevista
    // 50.000, realizada 12.000. Saldo previsto = 50.000 - 18.000 = 32.000;
    // saldo realizado = 12.000 - 0 = 12.000 (despesa sem valor lançado não entra).
    await expect(page.getByText('Receita prevista')).toBeVisible()
    await expect(page.getByText(/R\$\s?50\.000,00/).first()).toBeVisible()
    await expect(page.getByText(/R\$\s?18\.000,00/).first()).toBeVisible()
    await expect(page.getByText(/R\$\s?32\.000,00/).first()).toBeVisible()
    await expect(page.getByText(/R\$\s?12\.000,00/).first()).toBeVisible()

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth }
    })
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)
  })

  test('pedir exclusão de orçamento abre confirmação, não exclui direto', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}/orcamentos`)
    await page.waitForLoadState('networkidle')
    await page.getByText('Imersão 2027', { exact: true }).click()
    await page.getByRole('button', { name: 'Excluir' }).click()
    await expect(page.getByText('Excluir orçamento?')).toBeVisible()
  })
})

// Financeiro (livro de lançamentos) — Fase 3 do plano de gestão completa.
// Diferente de Orçamentos (previsto x realizado de um evento), aqui é
// receita/despesa avulsa do dia a dia da empresa.
test.describe('financeiro', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('mostra os totais do mês e o saldo geral calculados corretamente', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}/financeiro`)
    await page.waitForLoadState('networkidle')

    // Os dois lançamentos da fixture (receita 15.000, despesa 4.000) caem
    // no mês corrente (occurred_at é sempre "hoje") — saldo = 11.000.
    await expect(page.getByText('Receita no mês')).toBeVisible()
    await expect(page.getByText('R$ 15.000,00').first()).toBeVisible()
    await expect(page.getByText('R$ 4.000,00').first()).toBeVisible()
    await expect(page.getByText('R$ 11.000,00').first()).toBeVisible()
    await expect(page.getByText('saldo geral: R$ 11.000,00')).toBeVisible()

    // Só um mês de lançamento — a tabela de fluxo de caixa por mês só
    // aparece quando há mais de um mês pra comparar.
    await expect(page.getByText('Fluxo de caixa por mês')).toHaveCount(0)

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth }
    })
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)
  })

  test('lista os lançamentos com tipo e vínculo formatados', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}/financeiro`)
    await page.waitForLoadState('networkidle')

    const row = page.getByRole('row', { name: /Recebimento de cliente/ })
    await expect(row.getByText('Receita')).toBeVisible()
    await expect(row.getByText('Vendas')).toBeVisible()
    await expect(row).toContainText('R$ 15.000,00')

    const expenseRow = page.getByRole('row', { name: /Pagamento de fornecedor/ })
    await expect(expenseRow.getByText('Despesa')).toBeVisible()
    await expect(expenseRow).toContainText('-R$ 4.000,00')
    // Nenhum dos dois lançamentos da fixture está vinculado a área/produto/turma.
    await expect(row.getByText('—')).toBeVisible()
  })

  test('criar lançamento com vínculo de área e produto', async ({ page }) => {
    const entries = [...FINANCIAL_ENTRIES]
    await page.route('**/rest/v1/financial_entries*', async (route) => {
      const req = route.request()
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}')
        entries.push({ id: 'novo-lancamento', notes: null, ...body })
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(entries) })
    })

    await page.goto(`/empresa/${COMPANY_ID_2}/financeiro`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Novo lançamento' }).click()

    await expect(page.getByRole('heading', { name: 'Novo lançamento' })).toBeVisible()
    await page.getByRole('button', { name: 'Receita' }).click()
    await page.getByLabel('Descrição').fill('Venda de curso avulso')
    await page.getByLabel('Valor').fill('2500')
    await page.getByLabel('Área').selectOption('Comercial')
    await page.getByLabel('Produto').selectOption('Entre Donos')
    await page.getByLabel('Turma').selectOption('Imersão Setembro 2026')
    await page.getByRole('button', { name: 'Criar lançamento' }).click()

    await expect(page.getByText('Lançamento criado.')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const newRow = page.getByRole('row', { name: /Venda de curso avulso/ })
    await expect(newRow).toContainText('Comercial')
    await expect(newRow).toContainText('Entre Donos')
    await expect(newRow).toContainText('Imersão Setembro 2026')
  })

  test('editar lançamento existente', async ({ page }) => {
    const entries = FINANCIAL_ENTRIES.map((entry) => ({ ...entry }))
    await page.route('**/rest/v1/financial_entries*', async (route) => {
      const req = route.request()
      if (req.method() === 'PATCH') {
        const body = JSON.parse(req.postData() || '{}')
        const target = entries.find((entry) => entry.id === FINANCIAL_ENTRY_ID)
        if (target) Object.assign(target, body)
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(entries) })
    })

    await page.goto(`/empresa/${COMPANY_ID_2}/financeiro`)
    await page.waitForLoadState('networkidle')
    const row = page.getByRole('row', { name: /Recebimento de cliente/ })
    await row.getByRole('button', { name: 'Editar lançamento' }).click()

    await expect(page.getByRole('heading', { name: 'Editar lançamento' })).toBeVisible()
    await page.getByLabel('Descrição').fill('Recebimento de cliente (ajustado)')
    await page.getByRole('button', { name: 'Salvar' }).click()

    await expect(page.getByText('Lançamento atualizado.')).toBeVisible()
    await expect(page.getByText('Recebimento de cliente (ajustado)')).toBeVisible()
  })

  test('pedir exclusão de lançamento abre confirmação, não exclui direto', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}/financeiro`)
    await page.waitForLoadState('networkidle')
    const row = page.getByRole('row', { name: /Recebimento de cliente/ })
    await row.getByRole('button', { name: 'Excluir lançamento' }).click()
    await expect(page.getByText('Excluir lançamento?')).toBeVisible()
  })
})

// CRM genérico de contatos — Fase 3, segunda metade. Kanban por etapa
// (contact_stages, livre por empresa), setas avançar/voltar + select no
// card, mesmo padrão de Tarefas.
test.describe('contatos', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('mostra as etapas com os contatos e campos certos', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}/contatos`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: 'Novo lead' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Em contato' })).toBeVisible()

    const anaCard = page.locator('article', { hasText: 'Ana Beatriz' })
    await expect(anaCard).toContainText('Consultoria ABZ')
    await expect(anaCard).toContainText('ana@abz.com')
    await expect(anaCard).toContainText('Rafael Portela')
    await expect(anaCard).toContainText('Origem: Indicação')

    const carlosCard = page.locator('article', { hasText: 'Carlos Nunes' })
    await expect(carlosCard).toContainText('sem responsável')

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth }
    })
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)
  })

  test('criar contato numa etapa', async ({ page }) => {
    const contacts = [...CONTACTS]
    await page.route('**/rest/v1/contacts*', async (route) => {
      const req = route.request()
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}')
        contacts.push({ id: 'novo-contato', notes: null, ...body })
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contacts) })
    })

    await page.goto(`/empresa/${COMPANY_ID_2}/contatos`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Novo contato em Novo lead' }).click()

    await expect(page.getByRole('heading', { name: 'Novo contato' })).toBeVisible()
    await page.getByLabel('Nome').fill('Fernanda Lima')
    await page.getByRole('button', { name: 'Criar contato' }).click()

    await expect(page.getByText('Contato criado.')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // Sobe até a coluna (div "flex flex-col") a partir do próprio título —
    // evita colidir com "Em contato" aparecendo como opção dentro do select
    // de qualquer card (um filtro por texto pegaria isso também).
    const stageColumn = page
      .getByRole('heading', { name: 'Novo lead' })
      .locator('xpath=ancestor::div[contains(@class, "flex-col")][1]')
    await expect(stageColumn.getByText('Fernanda Lima')).toBeVisible()
  })

  test('editar contato existente', async ({ page }) => {
    const contacts = CONTACTS.map((c) => ({ ...c }))
    await page.route('**/rest/v1/contacts*', async (route) => {
      const req = route.request()
      if (req.method() === 'PATCH') {
        const body = JSON.parse(req.postData() || '{}')
        const target = contacts.find((c) => c.id === CONTACT_ID)
        if (target) Object.assign(target, body)
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contacts) })
    })

    await page.goto(`/empresa/${COMPANY_ID_2}/contatos`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Editar contato "Ana Beatriz"' }).click()

    await expect(page.getByRole('heading', { name: 'Editar Ana Beatriz' })).toBeVisible()
    await page.getByLabel('Nome').fill('Ana Beatriz Souza')
    await page.getByRole('button', { name: 'Salvar' }).click()

    await expect(page.getByText('Contato atualizado.')).toBeVisible()
    await expect(page.getByText('Ana Beatriz Souza')).toBeVisible()
  })

  test('avançar contato de etapa com a seta', async ({ page }) => {
    const contacts = CONTACTS.map((c) => ({ ...c }))
    await page.route('**/rest/v1/contacts*', async (route) => {
      const req = route.request()
      if (req.method() === 'PATCH') {
        const body = JSON.parse(req.postData() || '{}')
        const target = contacts.find((c) => c.id === CONTACT_ID)
        if (target) Object.assign(target, body)
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contacts) })
    })

    await page.goto(`/empresa/${COMPANY_ID_2}/contatos`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Avançar "Ana Beatriz" de etapa' }).click()

    const emContatoColumn = page
      .getByRole('heading', { name: 'Em contato' })
      .locator('xpath=ancestor::div[contains(@class, "flex-col")][1]')
    await expect(emContatoColumn.getByText('Ana Beatriz')).toBeVisible()
    await expect(emContatoColumn.getByText('Carlos Nunes')).toBeVisible()
  })

  test('pedir exclusão de contato abre confirmação, não exclui direto', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}/contatos`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Excluir contato "Ana Beatriz"' }).click()
    await expect(page.getByText('Excluir contato?')).toBeVisible()
  })

  test('criar etapa nova', async ({ page }) => {
    const stages = [...CONTACT_STAGES]
    await page.route('**/rest/v1/contact_stages*', async (route) => {
      const req = route.request()
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}')
        stages.push({ id: 'nova-etapa', is_active: true, ...body })
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stages) })
    })

    await page.goto(`/empresa/${COMPANY_ID_2}/contatos`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Nova etapa' }).click()

    await expect(page.getByRole('heading', { name: 'Nova etapa' })).toBeVisible()
    await page.getByLabel('Nome da etapa').fill('Fechado')
    await page.getByRole('button', { name: 'Criar etapa' }).click()

    await expect(page.getByText('Etapa criada.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Fechado' })).toBeVisible()
  })

  test('pedir exclusão de etapa abre confirmação, não exclui direto', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}/contatos`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Excluir etapa "Novo lead"' }).click()
    await expect(page.getByText('Excluir etapa?')).toBeVisible()
  })
})

// Cadeia de valor turma → produto: "Entre Donos" (produto) nunca lança
// direto — o valor dele é a soma das turmas, calculada no cliente. Alvo
// agora existe em todo nível (empresa, produto e turma) — a tela de
// Produtos é cadastro puro, com uma lista de leitura de quais metas já
// acompanham cada produto/turma; vincular (uma ou várias de uma vez)
// acontece pelo form de editar produto, ou pelo botão "Metas" de cada
// turma.
test.describe('metas de produto e sub-produto', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('cartão do produto mostra o valor somado das turmas', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}/produtos`)
    await page.waitForLoadState('networkidle')
    // KPI_PRODUCT não tem lançamento nenhum — o valor exibido (32.000) só
    // pode vir da soma de KPI_EDITION (a turma de setembro).
    await expect(page.getByText('Faturamento Entre Donos')).toBeVisible()
    await expect(page.getByText(/R\$\s?32\.000,00/).first()).toBeVisible()
  })

  test('abrir o produto mostra uma lista de leitura das metas que já o acompanham', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}/produtos`)
    await page.waitForLoadState('networkidle')
    await page.getByText('Entre Donos', { exact: true }).click()

    // O cartão do produto (atrás do modal) também mostra o nome da mesma
    // meta — por isso o link (role) em vez de texto solto, que pegaria
    // os dois.
    await expect(page.getByText('Metas que acompanham este produto')).toBeVisible()
    const productLink = page.getByRole('link', { name: /Faturamento Entre Donos/ })
    await expect(productLink).toContainText('R$ 32.000,00')

    // Turma de setembro já tem meta própria (32.000).
    const editionLink = page.getByRole('link', { name: /Faturamento Imersão Set\/2026/ })
    await expect(editionLink).toContainText('R$ 32.000,00')

    const modal = page.getByRole('dialog')
    await expect(modal.getByText('Imersão Setembro 2026')).toBeVisible()

    // Turma de outubro não tem meta ainda — mostra o estado vazio, e não
    // tem link nenhum de criar/editar por aqui (isso agora só acontece
    // pelo atalho de vincular).
    await expect(modal.getByText('Imersão Outubro 2026')).toBeVisible()
    await expect(modal.getByText('Nenhuma meta acompanha esta turma ainda.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Editar meta' })).toHaveCount(0)
  })

  test('vincular este produto a uma meta existente pelo form de editar', async ({ page }) => {
    // Mock com estado próprio — o vínculo criado precisa aparecer na
    // recarga que a página faz depois de salvar, e o mock estático de
    // TABLES não persiste POST nenhum.
    const kpis = [...KPIS]
    await page.route('**/rest/v1/kpis*', async (route) => {
      const req = route.request()
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}')
        for (const row of Array.isArray(body) ? body : [body]) {
          kpis.push({ id: `novo-kpi-${kpis.length}`, is_active: true, archived_at: null, entry_frequency: null, ...row })
        }
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(kpis) })
    })

    await page.goto(`/empresa/${COMPANY_ID_2}/produtos`)
    await page.waitForLoadState('networkidle')
    await page.getByText('Entre Donos', { exact: true }).click()
    await page.getByRole('button', { name: 'Editar produto' }).click()

    await expect(page.getByRole('heading', { name: 'Editar Entre Donos' })).toBeVisible()
    await expect(page.getByText('Vincular a metas')).toBeVisible()
    await page.getByRole('checkbox', { name: 'Ticket médio' }).check()
    await page.getByRole('button', { name: /^Vincular/ }).click()

    await expect(page.getByText('Meta vinculada.')).toBeVisible()
    // Escopado ao modal de detalhe do produto (o primeiro aberto — o de
    // editar fica por cima) — não ao card de prévia atrás dos dois, que
    // agora também lista essa mesma meta recém-vinculada.
    await expect(page.getByRole('dialog').first().getByText('Ticket médio · Entre Donos')).toBeVisible()
  })

  test('vincular uma turma a uma meta existente pelo botão "Metas"', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}/produtos`)
    await page.waitForLoadState('networkidle')
    await page.getByText('Entre Donos', { exact: true }).click()
    await page.getByRole('button', { name: 'Metas desta turma' }).first().click()

    await expect(page.getByRole('heading', { name: /^Metas de /, exact: false })).toBeVisible()
    await page.getByRole('checkbox', { name: 'Churn' }).check()
    await page.getByRole('button', { name: /^Vincular/ }).click()

    await expect(page.getByText('Meta vinculada.')).toBeVisible()
  })

  test('clicar numa meta do produto abre o Detalhe dela em Metas', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}/produtos`)
    await page.waitForLoadState('networkidle')
    await page.getByText('Entre Donos', { exact: true }).click()
    await page.getByRole('link', { name: /Faturamento Entre Donos/ }).click()

    await expect(page).toHaveURL(new RegExp(`/empresa/${COMPANY_ID_2}/kpis/${KPI_PRODUCT}`))
    // O Detalhe mostra o valor somado (soma das turmas) em destaque.
    await expect(page.getByText(/R\$\s?32\.000,00/).first()).toBeVisible()
  })

  // Pedido explícito do usuário: acompanhar indicador + alvo + tarefas +
  // orçamento de uma frente de produto juntos, numa tela só, sem pular de
  // indicador em indicador dentro de Metas. KPI_PRODUCT/META_PRODUCT já
  // cobrem indicador+alvo nas fixtures — só tarefa e orçamento precisam de
  // um vínculo a PRODUCT_ID que não existe em nenhuma fixture ainda.
  test('painel do produto mostra indicadores, alvos, turmas, tarefas e orçamento juntos', async ({ page }) => {
    const tasks = TASKS.concat({
      id: 'task-produto-teste',
      company_id: COMPANY_ID_2,
      title: 'Confirmar local do evento',
      description: null,
      assignee_id: null,
      created_by: USER_ID,
      due_date: '2026-09-20',
      remind_at: null,
      reminder_sent_at: null,
      remind_days_before: null,
      remind_time: '08:00',
      due_reminder_sent_at: null,
      priority: 'medium',
      status: 'todo',
      visibility: 'company',
      tags: [],
      kpi_id: null,
      product_id: PRODUCT_ID,
      product_edition_id: null,
      completed_at: null,
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    })
    const budgets = [
      {
        id: 'budget-produto-teste',
        company_id: COMPANY_ID_2,
        title: 'Orçamento Entre Donos 2026',
        description: null,
        event_date: null,
        status: 'em_andamento',
        owner_id: null,
        product_id: PRODUCT_ID,
        product_edition_id: null,
        created_by: USER_ID,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    const budgetItems = [
      {
        id: 'bi-produto-teste',
        budget_id: 'budget-produto-teste',
        company_id: COMPANY_ID_2,
        kind: 'despesa',
        category: 'Geral',
        title: 'Material gráfico',
        vendor: null,
        status: 'pago',
        planned_amount: 10000,
        actual_amount: 6000,
        due_date: null,
        notes: null,
        created_by: USER_ID,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    await page.route('**/rest/v1/tasks*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tasks) })
    })
    await page.route('**/rest/v1/budgets*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(budgets) })
    })
    await page.route('**/rest/v1/budget_items*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(budgetItems) })
    })

    await page.goto(`/empresa/${COMPANY_ID_2}/produtos/${PRODUCT_ID}`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: 'Entre Donos', level: 1 })).toBeVisible()

    // Indicador do produto (soma da turma) e o alvo dele, sem sair da tela.
    const indicatorsCard = page.locator('section', { has: page.getByRole('heading', { name: 'Indicadores' }) })
    await expect(indicatorsCard.getByText('Faturamento Entre Donos')).toBeVisible()
    await expect(indicatorsCard.getByText('R$ 32.000,00')).toBeVisible()
    const targetsCard = page.locator('section', { has: page.getByRole('heading', { name: 'Alvos' }) })
    await expect(targetsCard.getByText('R$ 32.000,00 de R$ 400.000,00')).toBeVisible()

    // Turma de setembro: sempre visível aqui (mesmo teste roda em qualquer
    // data — ver teste dedicado abaixo pra turma com início num mês futuro,
    // que usa datas relativas a "hoje" de propósito, por causa disso).
    await expect(page.getByRole('link', { name: /Imersão Setembro 2026/ })).toBeVisible()

    // Tarefa e orçamento deste produto, antes só visíveis em outras telas.
    await expect(page.getByText('Confirmar local do evento')).toBeVisible()
    await expect(page.getByText('Orçamento Entre Donos 2026')).toBeVisible()
    await expect(page.getByText('R$ 6.000,00 de R$ 10.000,00 previstos')).toBeVisible()
  })

  // Pedido explícito: turma com início num mês ainda não chegado fica fora
  // da lista de "Turmas" do painel do produto — só citada num aviso
  // discreto — pra não confundir quem olha achando que ela já devia ter
  // dado alguma coisa. Datas relativas a "hoje" de propósito (não
  // hardcoded): o comportamento depende do mês real em que o teste roda.
  test('turma com início em mês futuro fica fora da lista de "Turmas", só citada no aviso', async ({ page }) => {
    const today = new Date()
    const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10)
    const threeMonthsAhead = new Date(today.getFullYear(), today.getMonth() + 3, 1).toISOString().slice(0, 10)
    const editions = [
      {
        id: 'edicao-atual-teste',
        product_id: PRODUCT_ID,
        company_id: COMPANY_ID_2,
        name: 'Turma Já Chegou',
        start_date: thisMonthStart,
        end_date: thisMonthStart,
        status: 'em_andamento',
        created_by: USER_ID,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'edicao-futura-teste',
        product_id: PRODUCT_ID,
        company_id: COMPANY_ID_2,
        name: 'Turma Ainda Não Chegou',
        start_date: threeMonthsAhead,
        end_date: threeMonthsAhead,
        status: 'planejamento',
        created_by: USER_ID,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    await page.route('**/rest/v1/product_editions*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(editions) })
    })

    await page.goto(`/empresa/${COMPANY_ID_2}/produtos/${PRODUCT_ID}`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('link', { name: /Turma Já Chegou/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Turma Ainda Não Chegou/ })).toHaveCount(0)
    await expect(page.getByText('1 turma(s) programada(s) ainda não aparece(m) aqui')).toBeVisible()
  })

  // Turma: mesmo painel, e agora TAMBÉM com seção de tarefas — desde
  // 0039_task_product_edition.sql, `tasks.product_edition_id` deixou de
  // ser uma lacuna: uma tarefa pode apontar direto pra uma turma, então o
  // painel da turma mostra só as tarefas DELA (não as do produto inteiro).
  test('painel da turma mostra indicador, alvo e só as tarefas da própria turma', async ({ page }) => {
    // O mock genérico devolve a tabela inteira, ignorando filtro de
    // querystring — com 2 edições nas fixtures, `.maybeSingle()` (usado
    // pelo painel pra buscar A turma da URL) recebe as 2 linhas de volta e
    // o próprio postgrest-js trata isso como erro ("multiple rows
    // returned"), não como a primeira da lista. Só esta rota precisa de um
    // filtro de verdade — as demais (kpis, metas, tasks, budgets) já
    // funcionam com o mock genérico porque a tela busca listas, não uma
    // linha específica por id.
    await page.route('**/rest/v1/product_editions*', async (route) => {
      const idFilter = new URL(route.request().url()).searchParams.get('id')
      const rows = idFilter?.startsWith('eq.')
        ? PRODUCT_EDITIONS.filter((edition) => edition.id === idFilter.slice(3))
        : PRODUCT_EDITIONS
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) })
    })

    const taskBase = {
      company_id: COMPANY_ID_2,
      description: null,
      assignee_id: null,
      created_by: USER_ID,
      due_date: '2026-09-16',
      remind_at: null,
      reminder_sent_at: null,
      remind_days_before: null,
      remind_time: '08:00',
      due_reminder_sent_at: null,
      priority: 'medium' as const,
      status: 'todo' as const,
      visibility: 'company' as const,
      tags: [],
      kpi_id: null,
      department_id: null,
      completed_at: null,
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    }
    const tasks = TASKS.concat(
      // Da turma — deve aparecer no painel dela.
      { ...taskBase, id: 'task-turma-teste', title: 'Confirmar catering da turma', product_id: PRODUCT_ID, product_edition_id: EDITION_ID },
      // Do produto inteiro (sem edição) — NÃO deve aparecer no painel da turma.
      { ...taskBase, id: 'task-produto-so-teste', title: 'Renovar contrato do produto', product_id: PRODUCT_ID, product_edition_id: null },
    )
    await page.route('**/rest/v1/tasks*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tasks) })
    })

    await page.goto(`/empresa/${COMPANY_ID_2}/produtos/${PRODUCT_ID}/turmas/${EDITION_ID}`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: 'Imersão Setembro 2026', level: 1 })).toBeVisible()

    const indicatorsCard = page.locator('section', { has: page.getByRole('heading', { name: 'Indicadores' }) })
    await expect(indicatorsCard.getByText('Faturamento Imersão Set/2026')).toBeVisible()
    await expect(indicatorsCard.getByText('R$ 32.000,00')).toBeVisible()
    const targetsCard = page.locator('section', { has: page.getByRole('heading', { name: 'Alvos' }) })
    await expect(targetsCard.getByText('Em risco')).toBeVisible()
    await expect(targetsCard.getByText('R$ 32.000,00 de R$ 35.000,00')).toBeVisible()

    await expect(page.getByRole('heading', { name: 'Próximos prazos' })).toBeVisible()
    await expect(page.getByText('Confirmar catering da turma')).toBeVisible()
    await expect(page.getByText('Renovar contrato do produto')).not.toBeVisible()
    await expect(page.getByRole('heading', { name: 'Turmas' })).not.toBeVisible()
  })

  // Escrita da mesma granularidade testada em leitura acima: o formulário
  // de tarefa precisa oferecer "Turma" (cascata a partir do produto
  // escolhido) e gravar o vínculo de verdade.
  test('formulário de tarefa: escolher produto revela turma, e o vínculo é salvo', async ({ page }) => {
    let savedPayload: Record<string, unknown> | null = null
    await page.route('**/rest/v1/tasks*', async (route) => {
      if (route.request().method() === 'POST') {
        savedPayload = JSON.parse(route.request().postData() || '{}')
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(savedPayload) })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TASKS) })
    })

    await page.goto(`/empresa/${COMPANY_ID_2}/tarefas`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Nova tarefa', exact: true }).first().click()

    await page.getByLabel('O que precisa ser feito').fill('Confirmar catering da turma')
    // "Turma" não existe antes de escolher um produto com edições.
    await expect(page.getByLabel('Turma')).not.toBeVisible()
    await page.getByLabel('Produto').selectOption({ label: 'Entre Donos' })
    await expect(page.getByLabel('Turma')).toBeVisible()
    await page.getByLabel('Turma').selectOption({ label: 'Imersão Setembro 2026' })

    await page.getByRole('button', { name: 'Criar tarefa' }).click()
    await expect(page.getByText('Tarefa criada.')).toBeVisible()
    expect(savedPayload).toMatchObject({ product_id: PRODUCT_ID, product_edition_id: EDITION_ID })
  })

  // Atalho de descoberta: sem isso, chegar no painel de produto/turma exige
  // digitar a URL de cabeça.
  test('"Ver painel" em Produtos leva ao painel do produto e ao da turma', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}/produtos`)
    await page.waitForLoadState('networkidle')
    await page.getByText('Entre Donos', { exact: true }).click()

    await page.getByRole('link', { name: 'Ver painel', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/empresa/${COMPANY_ID_2}/produtos/${PRODUCT_ID}$`))

    await page.goBack()
    await page.getByText('Entre Donos', { exact: true }).click()
    await page.getByRole('link', { name: 'Ver painel da turma' }).first().click()
    await expect(page).toHaveURL(new RegExp(`/turmas/${EDITION_ID}$`))
  })
})

// Fase 2 do plano de virar um sistema de gestão completo: Área/
// Departamento organiza indicador, tarefa e orçamento por frente interna
// da empresa (Comercial, Financeiro...), cada empresa com as próprias.
test.describe('Áreas', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('lista mostra a área existente com as contagens certas e "Ver painel" navega', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}/areas`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Comercial', { exact: true })).toBeVisible()
    // Nenhum indicador/tarefa/orçamento aponta pra esta área nas fixtures
    // compartilhadas — as contagens começam zeradas.
    await expect(page.getByText('0 indicador(es)')).toBeVisible()
    await expect(page.getByText('0 tarefa(s)')).toBeVisible()
    await expect(page.getByText('0 orçamento(s)')).toBeVisible()

    await page.getByRole('link', { name: 'Ver painel' }).click()
    await expect(page).toHaveURL(new RegExp(`/areas/${DEPARTMENT_ID}$`))
    await expect(page.getByRole('heading', { name: 'Comercial', level: 1 })).toBeVisible()
  })

  test('criar uma área nova a partir de uma sugestão', async ({ page }) => {
    // Só a área "Comercial" já existe — "Financeiro" ainda está livre no
    // catálogo de sugestões (KPI_CATEGORIES).
    const departments = DEPARTMENTS.concat({
      id: 'department-financeiro-teste',
      company_id: COMPANY_ID_2,
      name: 'Financeiro',
      color: '#10B981',
      display_order: 1,
      is_active: true,
      created_by: USER_ID,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })
    // Estado simples só pra este teste: antes de criar, o GET devolve só a
    // área que já existia; depois do POST, o GET seguinte (disparado pelo
    // load() após salvar) já devolve as duas.
    let created = false
    await page.route('**/rest/v1/departments*', async (route) => {
      if (route.request().method() !== 'GET') {
        created = true
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(departments[1]) })
        return
      }
      const rows = created ? departments : DEPARTMENTS
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) })
    })

    await page.goto(`/empresa/${COMPANY_ID_2}/areas`)
    await page.waitForLoadState('networkidle')
    // Escopado ao conteúdo principal — a sidebar também tem um item
    // "Financeiro" (módulo Fase 3, nada a ver com a área que este teste cria).
    await expect(page.getByRole('main').getByText('Financeiro', { exact: true })).not.toBeVisible()

    await page.getByRole('button', { name: 'Nova área' }).click()
    await page.getByRole('button', { name: 'Financeiro' }).click()
    await page.getByRole('button', { name: 'Criar área' }).click()

    await expect(page.getByText('Área criada.')).toBeVisible()
    await expect(page.getByRole('main').getByText('Financeiro', { exact: true })).toBeVisible()
  })

  test('painel da área mostra indicador, alvo, tarefa e orçamento juntos', async ({ page }) => {
    const kpis = KPIS.concat({
      id: 'kpi-area-teste',
      company_id: COMPANY_ID_2,
      name: 'Novos contratos (teste)',
      description: '',
      category: 'Comercial',
      unit: 'number',
      direction: 'up',
      frequency: 'monthly',
      source: 'manual',
      integration_id: null,
      display_order: 6,
      is_active: true,
      created_by: USER_ID,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      product_id: null,
      product_edition_id: null,
      parent_kpi_id: null,
      archived_at: null,
      entry_frequency: null,
      department_id: DEPARTMENT_ID,
    })
    const kpiLatest = [
      {
        kpi_id: 'kpi-area-teste',
        company_id: COMPANY_ID_2,
        period_start: '2026-08-01',
        period_end: '2026-08-31',
        value: 12,
        name: 'Novos contratos (teste)',
        unit: 'number',
        direction: 'up',
        frequency: 'monthly',
        category: 'Comercial',
        product_id: null,
        product_edition_id: null,
        parent_kpi_id: null,
        archived_at: null,
      },
    ]
    const metas = METAS.concat({
      id: 'meta-area-teste',
      company_id: COMPANY_ID_2,
      kpi_id: 'kpi-area-teste',
      target_value: 20,
      due_date: '2026-12-31',
      owner_id: null,
      status: 'active',
      archived_at: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })
    const tasks = TASKS.concat({
      id: 'task-area-teste',
      company_id: COMPANY_ID_2,
      title: 'Fechar contrato do cliente X',
      description: null,
      assignee_id: null,
      created_by: USER_ID,
      due_date: '2026-09-25',
      remind_at: null,
      reminder_sent_at: null,
      remind_days_before: null,
      remind_time: '08:00',
      due_reminder_sent_at: null,
      priority: 'high',
      status: 'todo',
      visibility: 'company',
      tags: [],
      kpi_id: null,
      product_id: null,
      department_id: DEPARTMENT_ID,
      completed_at: null,
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    })
    const budgets = [
      {
        id: 'budget-area-teste',
        company_id: COMPANY_ID_2,
        title: 'Orçamento Comercial 2026',
        description: null,
        event_date: null,
        status: 'em_andamento',
        owner_id: null,
        product_id: null,
        product_edition_id: null,
        department_id: DEPARTMENT_ID,
        created_by: USER_ID,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    const budgetItems = [
      {
        id: 'bi-area-teste',
        budget_id: 'budget-area-teste',
        company_id: COMPANY_ID_2,
        kind: 'despesa',
        category: 'Geral',
        title: 'Ferramenta de CRM',
        vendor: null,
        status: 'pago',
        planned_amount: 5000,
        actual_amount: 3000,
        due_date: null,
        notes: null,
        created_by: USER_ID,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    await page.route('**/rest/v1/kpis*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(kpis) })
    })
    await page.route('**/rest/v1/kpi_latest_values*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(kpiLatest) })
    })
    await page.route('**/rest/v1/metas*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(metas) })
    })
    await page.route('**/rest/v1/tasks*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tasks) })
    })
    await page.route('**/rest/v1/budgets*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(budgets) })
    })
    await page.route('**/rest/v1/budget_items*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(budgetItems) })
    })

    await page.goto(`/empresa/${COMPANY_ID_2}/areas/${DEPARTMENT_ID}`)
    await page.waitForLoadState('networkidle')

    const indicatorsCard = page.locator('section', { has: page.getByRole('heading', { name: 'Indicadores' }) })
    await expect(indicatorsCard.getByText('Novos contratos (teste)')).toBeVisible()
    const targetsCard = page.locator('section', { has: page.getByRole('heading', { name: 'Alvos' }) })
    await expect(targetsCard.getByText('12 de 20')).toBeVisible()
    await expect(page.getByText('Fechar contrato do cliente X')).toBeVisible()
    await expect(page.getByText('Orçamento Comercial 2026')).toBeVisible()
    await expect(page.getByText('R$ 3.000,00 de R$ 5.000,00 previstos')).toBeVisible()
  })

  test('formulário de nova meta (modo "Criar o meu") oferece a área cadastrada', async ({ page }) => {
    // "Área" só aparece no modo "Criar o meu" — o modo "Usar sugestões"
    // (padrão) segue outro fluxo de submissão (addChosen), sem esse campo;
    // dá pra definir a área depois, editando a meta, mesma regra que já
    // vale pra "Categoria" hoje.
    await page.goto(`/empresa/${COMPANY_ID_2}/kpis`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Nova Meta' }).click()
    await page.getByRole('button', { name: 'Criar o meu' }).click()
    // selectOption em vez de checar o <option> direto — visibilidade de
    // <option> dentro de <select> fechado é inconsistente entre engines;
    // conseguir selecionar de verdade é o que importa.
    await page.getByLabel('Área').selectOption({ label: 'Comercial' })
    await expect(page.getByLabel('Área')).toHaveValue(DEPARTMENT_ID)
  })

  test('formulário de nova tarefa oferece a área cadastrada', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}/tarefas`)
    await page.waitForLoadState('networkidle')
    // exact: true — "Nova tarefa em <coluna>" (um botão por coluna do
    // kanban) também bate com o texto "Nova tarefa" em busca por substring.
    await page.getByRole('button', { name: 'Nova tarefa', exact: true }).first().click()
    await page.getByLabel('Área').selectOption({ label: 'Comercial' })
    await expect(page.getByLabel('Área')).toHaveValue(DEPARTMENT_ID)
  })

  // Reconsiderado: o menu lateral tentou listar cada área cadastrada como
  // sub-item de "Áreas" (ver histórico), mas ficava com aparência de item
  // "aberto"/expandido permanentemente, diferente de todo o resto do menu
  // — revertido a pedido do usuário. "Áreas" é um item plano, igual aos
  // outros; entrar na área específica acontece de dentro da própria tela.
  test('menu lateral mostra "Áreas" como item único, sem listar cada área cadastrada', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}`)
    await page.waitForLoadState('networkidle')

    const nav = page.locator('aside nav')
    await expect(nav.getByRole('link', { name: 'Áreas', exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Comercial', exact: true })).toHaveCount(0)
  })
})

// Visão Geral (lista, uma linha por meta) + Detalhe (drill-down por
// breadcrumb) — reformulação estrutural da tela: nada aninhado aparece na
// lista, e navegar pra dentro de um produto/turma é ir pra outra URL
// (/kpis/:id), não expandir um accordion. Alvo existe em todo nível.
test.describe('Metas — Visão Geral e Detalhe', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  // O modal principal só cria/edita meta raiz de empresa — não existe mais
  // seletor de produto/turma nenhum por aqui (isso agora só acontece pelo
  // atalho de vincular, de dentro do Detalhe ou de Produtos).
  test('botão "Nova Meta" do topo nunca mostra seletor de produto/turma', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}/kpis`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Nova Meta' }).click()

    await expect(page.getByRole('heading', { name: 'Nova Meta' })).toBeVisible()
    await expect(page.getByText('Produto e sub-produto')).not.toBeVisible()
  })

  test('lista mostra uma linha por meta, agrupada por categoria, com valor/alvo/progresso/status', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}/kpis`)
    await page.waitForLoadState('networkidle')

    // Financeiro é a categoria de "Receita recorrente (MRR)" — o cabeçalho
    // do grupo aparece antes da linha, e nada aninhado (turma/produto)
    // aparece inline aqui. `p.text-brand-text` é a classe do cabeçalho de
    // grupo (ver MetasOverview.tsx) — precisa de um seletor específico
    // assim porque "Financeiro" sozinho colide com o item do menu lateral
    // (módulo à parte) e com a <option> de mesmo nome em "Filtrar por
    // categoria".
    await expect(page.locator('p.text-brand-text', { hasText: 'Financeiro' })).toBeVisible()
    const row = page.getByRole('link', { name: /Receita recorrente \(MRR\)/ })
    await expect(row).toContainText('R$ 92.345,67')
    await expect(row).toContainText('R$ 80.000,00')
    await expect(row).toContainText('115%')
    await expect(row).toContainText('Em andamento')
  })

  test('clicar numa linha abre o Detalhe com breadcrumb e a quebra por produto', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}/kpis`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('link', { name: /Faturamento Entre Donos/ }).click()

    await expect(page).toHaveURL(new RegExp(`/kpis/${KPI_PRODUCT}$`))
    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect(breadcrumb.getByRole('link', { name: 'Metas' })).toBeVisible()
    await expect(breadcrumb.getByText('Entre Donos')).toBeVisible()

    // Alvo do nível produto (META_PRODUCT) aparece no bloco de destaque.
    await expect(page.getByText('R$ 400.000,00').first()).toBeVisible()

    // A turma aparece na tabela de quebra — clicar nela desce mais um nível.
    const turmaRow = page.getByRole('link', { name: /Imersão Setembro 2026/ })
    await expect(turmaRow).toContainText('Em risco')
    await turmaRow.click()

    await expect(page).toHaveURL(new RegExp(`/kpis/${KPI_EDITION}$`))
    await expect(breadcrumb.getByText('Imersão Setembro 2026')).toBeVisible()
    await expect(page.getByText('R$ 35.000,00').first()).toBeVisible()
    await expect(page.getByText('Em risco').first()).toBeVisible()
  })

  // Bug relatado: não dava pra editar o nome/prazo de uma turma (sub
  // produto) — só o produto tinha "Editar" na tela de Produtos. Agora um
  // botão próprio, no Detalhe da turma, edita a turma em si.
  test('"Editar turma" no Detalhe renomeia e muda as datas da turma', async ({ page }) => {
    // Mesma edição de "Imersão Setembro 2026" da fixture (ver PRODUCT_EDITIONS
    // em fixtures.ts) — cópia local só pra este teste poder mutar em memória.
    const editions = [
      {
        id: EDITION_ID,
        product_id: PRODUCT_ID,
        company_id: COMPANY_ID_2,
        name: 'Imersão Setembro 2026',
        start_date: '2026-09-15',
        end_date: '2026-09-17',
        status: 'em_andamento',
      },
      { id: EDITION_ID_2, product_id: PRODUCT_ID, company_id: COMPANY_ID_2, name: 'Imersão Outubro 2026' },
    ]
    await page.route('**/rest/v1/product_editions*', async (route) => {
      const req = route.request()
      if (req.method() === 'PATCH') {
        const body = JSON.parse(req.postData() || '{}')
        const id = new URL(req.url()).searchParams.get('id')?.replace('eq.', '')
        const idx = editions.findIndex((e) => e.id === id)
        if (idx >= 0) Object.assign(editions[idx], body)
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(editions) })
    })

    await page.goto(`/empresa/${COMPANY_ID_2}/kpis/${KPI_EDITION}`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Editar turma' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: /Editar turma/ })).toBeVisible()
    await dialog.getByLabel('Nome').fill('Imersão Setembro 2026 — Turma B')
    await dialog.getByRole('button', { name: 'Salvar' }).click()

    await expect(page.getByText('Turma atualizada.')).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByText('Imersão Setembro 2026 — Turma B')).toBeVisible()
  })

  test('"Vincular produto" no Detalhe de uma meta sem filhos anexa um produto já cadastrado', async ({ page }) => {
    const kpis = [...KPIS]
    await page.route('**/rest/v1/kpis*', async (route) => {
      const req = route.request()
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}')
        for (const row of Array.isArray(body) ? body : [body]) {
          kpis.push({ id: `novo-kpi-${kpis.length}`, is_active: true, archived_at: null, entry_frequency: null, ...row })
        }
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(kpis) })
    })

    await page.goto(`/empresa/${COMPANY_ID_2}/kpis`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('link', { name: /Receita recorrente \(MRR\)/ }).click()
    await page.getByRole('button', { name: 'Vincular produto' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: /Vincular produto/ })).toBeVisible()
    await dialog.getByRole('combobox').selectOption({ label: 'Entre Donos' })
    // Nome exato: a aba "Vincular existente" também contém a palavra
    // "Vincular" — sem exact, o match de substring pega as duas.
    await dialog.getByRole('button', { name: 'Vincular', exact: true }).click()

    await expect(page.getByText('Vínculo criado.')).toBeVisible()
  })

  // Pedido explícito: ao vincular um produto que ainda não existe, dar um
  // jeito de cadastrar ali mesmo, sem precisar ir até Produtos e voltar.
  test('criar um produto novo direto do "Vincular produto" — sem sair pra Produtos', async ({ page }) => {
    const kpis = [...KPIS]
    await page.route('**/rest/v1/kpis*', async (route) => {
      const req = route.request()
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}')
        for (const row of Array.isArray(body) ? body : [body]) {
          kpis.push({ id: `novo-kpi-${kpis.length}`, is_active: true, archived_at: null, entry_frequency: null, ...row })
        }
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(kpis) })
    })
    await page.route('**/rest/v1/products*', async (route) => {
      const req = route.request()
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}')
        const created = { id: 'novo-produto-1', is_active: true, color: null, ...body }
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(created) })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PRODUCTS) })
    })

    await page.goto(`/empresa/${COMPANY_ID_2}/kpis`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('link', { name: /Receita recorrente \(MRR\)/ }).click()
    await page.getByRole('button', { name: 'Vincular produto' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: /Vincular produto/ })).toBeVisible()
    await dialog.getByRole('button', { name: 'Criar produto' }).click()
    await dialog.getByLabel('Nome do produto').fill('Consultoria')
    await dialog.getByRole('button', { name: 'Criar e vincular' }).click()

    await expect(page.getByText('Produto criado e vinculado.')).toBeVisible()
  })

  // Mesma ideia, nível turma — este é o caso mais comum na prática (produto
  // já existe, falta a turma nova do mês).
  test('criar uma turma nova direto do "Vincular turma" — sem sair pra Produtos', async ({ page }) => {
    const kpis = [...KPIS]
    await page.route('**/rest/v1/kpis*', async (route) => {
      const req = route.request()
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}')
        for (const row of Array.isArray(body) ? body : [body]) {
          kpis.push({ id: `novo-kpi-${kpis.length}`, is_active: true, archived_at: null, entry_frequency: null, ...row })
        }
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(kpis) })
    })
    await page.route('**/rest/v1/product_editions*', async (route) => {
      const req = route.request()
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}')
        const created = { id: 'nova-turma-1', status: 'planejamento', ...body }
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(created) })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PRODUCT_EDITIONS) })
    })

    await page.goto(`/empresa/${COMPANY_ID_2}/kpis/${KPI_PRODUCT}`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Vincular turma' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Criar turma' }).click()
    await dialog.getByLabel('Nome da turma').fill('Imersão Novembro 2026')
    await dialog.getByRole('button', { name: 'Criar e vincular' }).click()

    await expect(page.getByText('Turma criada e vinculada.')).toBeVisible()
  })

  // Pedido explícito: planejar um ano inteiro de turmas (ex. 12 mensais)
  // sem repetir o formulário de vincular turma 12 vezes.
  test('criar várias turmas de uma vez (lote) a partir de "Vincular turma"', async ({ page }) => {
    const kpis = [...KPIS]
    await page.route('**/rest/v1/kpis*', async (route) => {
      const req = route.request()
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}')
        for (const row of Array.isArray(body) ? body : [body]) {
          kpis.push({ id: `novo-kpi-${kpis.length}`, is_active: true, archived_at: null, entry_frequency: null, ...row })
        }
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(kpis) })
    })
    await page.route('**/rest/v1/product_editions*', async (route) => {
      const req = route.request()
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}')
        const rows = Array.isArray(body) ? body : [body]
        const created = rows.map((row, i) => ({ id: `lote-turma-${i}`, status: 'planejamento', ...row }))
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(created) })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PRODUCT_EDITIONS) })
    })

    await page.goto(`/empresa/${COMPANY_ID_2}/kpis/${KPI_PRODUCT}`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Vincular turma' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Criar várias' }).click()
    await dialog.getByLabel('Prefixo do nome').fill('Imersão')
    await dialog.getByLabel('Quantidade de turmas').fill('3')
    await dialog.getByLabel('Mês/ano da primeira').fill('2027-01')
    await dialog.getByRole('button', { name: /Criar 3 turma/ }).click()

    await expect(page.getByText('3 turma(s) criada(s) e vinculada(s).')).toBeVisible()
  })

  // Bug relatado: no fluxo padrão ("Usar sugestões"), não havia como definir
  // o alvo já na criação — só existia dentro da aba "Criar o meu". Escolhendo
  // uma única sugestão, a opção precisa aparecer e funcionar igual.
  test('escolhendo uma única sugestão, dá pra definir o alvo já na criação', async ({ page }) => {
    const kpis = [...KPIS]
    await page.route('**/rest/v1/kpis*', async (route) => {
      const req = route.request()
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}')
        // Responde só com as linhas recém-criadas (como o `.select('id')`
        // de verdade faria) — devolver a tabela inteira faria `created[0]`
        // (usado logo depois pra criar o alvo já vinculado) apontar pro
        // primeiro kpi ORIGINAL da lista, não pro que acabou de nascer.
        const inserted = (Array.isArray(body) ? body : [body]).map((row, index) => ({
          id: `novo-kpi-${kpis.length + index}`,
          is_active: true,
          archived_at: null,
          entry_frequency: null,
          ...row,
        }))
        kpis.push(...inserted)
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(inserted) })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(kpis) })
    })
    const metas: Record<string, unknown>[] = []
    await page.route('**/rest/v1/metas*', async (route) => {
      const req = route.request()
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}')
        metas.push({ id: `nova-meta-${metas.length}`, archived_at: null, status: 'active', ...body })
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(metas) })
    })

    await page.goto(`/empresa/${COMPANY_ID_2}/kpis`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Nova Meta' }).click()

    const dialog = page.getByRole('dialog')
    // "Inadimplência" não colide com nenhuma meta já cadastrada nos fixtures
    // (o mock de REST não filtra por empresa — ver comentário acima sobre
    // "Faturamento Entre Donos"/"Faturamento" já aparecerem cadastrados).
    await dialog.getByPlaceholder('Buscar meta…').fill('Inadimplência')
    // Só uma sugestão escolhida — a opção de definir o alvo agora aparece.
    await dialog.getByRole('button', { name: /^Inadimplência\b/ }).click()
    await expect(dialog.getByText('Definir um alvo agora')).toBeVisible()

    await dialog.getByLabel('Definir um alvo agora').check()
    await dialog.getByLabel('Prazo').fill('2026-12-31')
    // O campo "Alvo" some com o sufixo "%" no rótulo acessível (não bate
    // exato com getByLabel) — isola pelo <label> que começa com "Alvo".
    await dialog.locator('label').filter({ hasText: /^Alvo/ }).locator('input').fill('5')

    await dialog.getByRole('button', { name: 'Adicionar meta e alvo' }).click()
    await expect(page.getByText('Inadimplência e alvo criados.')).toBeVisible()

    // Pedido do usuário: alvo novo nasce "Planejada", não "Em andamento" —
    // ninguém tocou no seletor de status acima, então é o padrão de
    // verdade sendo exercitado (não um valor escolhido no teste).
    await expect(page.getByRole('link', { name: /^Inadimplência,/ })).toContainText('Planejada')
  })

  // Bug relatado: o valor do alvo ficava escondido no cartão — só aparecia
  // dentro da legenda da barra de progresso, que nem existe sem um valor
  // medido ainda. Precisa aparecer mesmo sem nenhum lançamento — tanto na
  // linha da lista quanto no Detalhe.
  test('valor do alvo aparece mesmo sem nenhum valor lançado ainda', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID}/kpis`)
    await page.waitForLoadState('networkidle')

    const row = page.getByRole('link', { name: /^Faturamento,/ })
    await expect(row).toContainText('R$ 500.000,00')

    await row.click()
    await expect(page.getByText('R$ 500.000,00').first()).toBeVisible()
  })

  // Pedido do usuário: um resumo no topo pra bater o olho sem abrir meta
  // por meta. Conta todo alvo ativo (empresa/produto/turma) — o mock de
  // REST não filtra por empresa (ver comentário no topo do arquivo), então
  // o total reflete METAS inteiro: 7 alvos, sendo 1 em risco (META_EDITION)
  // e os outros 6 "em andamento" (nenhum tem status "achieved"/"missed").
  test('resumo no topo mostra a contagem de alvos por andamento', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}/kpis`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('7 alvo(s) ativo(s) nesta empresa, em todo nível')).toBeVisible()
    await expect(page.getByText('0 atingido(s)')).toBeVisible()
    await expect(page.getByText('6 em andamento')).toBeVisible()
    await expect(page.getByText('1 em risco')).toBeVisible()
    await expect(page.getByText('0 não atingido(s)')).toBeVisible()
  })

  // Pedido do usuário: botão fácil de ativar/desativar uma meta direto na
  // lista, sem abrir o modal de editar. Desativada, a linha fica esmaecida
  // (mesmo tratamento visual que já existia, só sem atalho pra chegar lá).
  test('botão de ativar/desativar na lista muda is_active sem abrir modal', async ({ page }) => {
    const kpis = KPIS.map((item) => ({ ...item }))
    await page.route('**/rest/v1/kpis*', async (route) => {
      const req = route.request()
      if (req.method() === 'PATCH') {
        const body = JSON.parse(req.postData() || '{}')
        const target = kpis.find((item) => item.id === KPI_WITH)
        if (target) Object.assign(target, body)
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(kpis) })
    })

    await page.goto(`/empresa/${COMPANY_ID_2}/kpis`)
    await page.waitForLoadState('networkidle')

    const row = page.getByRole('link', { name: /^Receita recorrente \(MRR\)/ })
    // O pai direto do link é o cartão dimível nos dois formatos (linha no
    // desktop, cartão empilhado no celular) — sobe só um nível em vez de
    // depender de uma classe específica de um dos dois layouts.
    const card = row.locator('xpath=..')
    await expect(card).not.toHaveClass(/opacity-60/)

    await page.getByRole('button', { name: 'Desativar meta "Receita recorrente (MRR)"' }).click()
    await expect(page.getByText('Meta desativada.')).toBeVisible()
    await expect(card).toHaveClass(/opacity-60/)

    // Reverte — o mesmo botão, agora com o rótulo trocado, reativa.
    await page.getByRole('button', { name: 'Ativar meta "Receita recorrente (MRR)"' }).click()
    await expect(page.getByText('Meta ativada.')).toBeVisible()
    await expect(card).not.toHaveClass(/opacity-60/)
  })

  // Bug real encontrado em produção: desativar só a RAIZ deixava
  // produto/turma por baixo ativos, sem lançamento nenhum, ainda contando
  // nos painéis e poluindo o cartão "Metas" deles — o cartão de Metas
  // mostra a família inteira como uma coisa só, então o botão precisa
  // desativar (e reativar) a família toda de uma vez, não só a linha
  // clicada. KPI_PRODUCT ("Faturamento Entre Donos") tem KPI_EDITION
  // ("Faturamento Imersão Set/2026") como filho — ver fixtures.ts.
  test('desativar a raiz arrasta produto/turma vinculados junto (cascata)', async ({ page }) => {
    const kpis = KPIS.map((item) => ({ ...item }))
    const patchedIdSets: string[][] = []
    await page.route('**/rest/v1/kpis*', async (route) => {
      const req = route.request()
      if (req.method() === 'PATCH') {
        const body = JSON.parse(req.postData() || '{}')
        const idFilter = new URL(req.url()).searchParams.get('id') ?? ''
        const ids = idFilter.startsWith('in.') ? idFilter.slice(4, -1).split(',') : [idFilter.replace('eq.', '')]
        patchedIdSets.push(ids)
        for (const kpi of kpis) {
          if (ids.includes(kpi.id)) Object.assign(kpi, body)
        }
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(kpis) })
    })

    await page.goto(`/empresa/${COMPANY_ID_2}/kpis`)
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Desativar meta "Faturamento Entre Donos"' }).click()
    await expect(page.getByText('Meta e 1 vinculado(s) desativados.')).toBeVisible()

    // A raiz E a turma vinculada entraram no mesmo update — não só a raiz.
    expect(patchedIdSets.at(-1)).toEqual(expect.arrayContaining([KPI_PRODUCT, KPI_EDITION]))
    expect(kpis.find((k) => k.id === KPI_EDITION)?.is_active).toBe(false)

    // Reverte — reativar a raiz também traz a turma de volta junto.
    await page.getByRole('button', { name: 'Ativar meta "Faturamento Entre Donos"' }).click()
    await expect(page.getByText('Meta e 1 vinculado(s) ativados.')).toBeVisible()
    expect(kpis.find((k) => k.id === KPI_EDITION)?.is_active).toBe(true)
  })

  // Pedido do usuário: buscar por nome, útil conforme a lista cresce. Acha
  // a família tanto pelo nome da própria meta quanto pelo nome de um
  // produto/turma vinculado em qualquer profundidade.
  test.describe('busca por nome', () => {
    test('filtra pelo nome da própria meta', async ({ page }) => {
      await page.goto(`/empresa/${COMPANY_ID_2}/kpis`)
      await page.waitForLoadState('networkidle')
      await page.getByLabel('Buscar meta por nome').fill('Ticket')

      await expect(page.getByRole('link', { name: /Ticket médio/ })).toBeVisible()
      await expect(page.getByRole('link', { name: /Receita recorrente/ })).not.toBeVisible()
    })

    test('filtra pelo nome de uma turma vinculada', async ({ page }) => {
      await page.goto(`/empresa/${COMPANY_ID_2}/kpis`)
      await page.waitForLoadState('networkidle')
      await page.getByLabel('Buscar meta por nome').fill('Imersão Setembro')

      await expect(page.getByRole('link', { name: /Faturamento Entre Donos/ })).toBeVisible()
      await expect(page.getByRole('link', { name: /Ticket médio/ })).not.toBeVisible()
    })
  })

  // Categoria em uso de verdade (não uma lista fixa) — filtra a lista sem
  // esconder famílias de outra categoria por engano.
  test('filtro por categoria some com metas de outra categoria', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}/kpis`)
    await page.waitForLoadState('networkidle')
    await page.getByLabel('Filtrar por categoria').selectOption('Comercial')

    await expect(page.getByRole('link', { name: /Ticket médio/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Receita recorrente/ })).not.toBeVisible()
  })

  // Pedido explícito: múltiplas formas de ordenar — a categoria continua
  // agrupando, mas a ordem das linhas dentro dela muda com o critério
  // escolhido. "Comercial" tem Ticket médio/Churn/Novos clientes nessa
  // ordem de cadastro (padrão); em ordem alfabética, Churn vem primeiro.
  test('ordenar por nome muda a ordem das linhas dentro da mesma categoria', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}/kpis`)
    await page.waitForLoadState('networkidle')

    const ticket = page.getByRole('link', { name: /^Ticket médio/ })
    const churn = page.getByRole('link', { name: /^Churn/ })

    const ticketBefore = await ticket.boundingBox()
    const churnBefore = await churn.boundingBox()
    expect(ticketBefore!.y).toBeLessThan(churnBefore!.y)

    await page.getByLabel('Ordenar por').selectOption('name')

    const ticketAfter = await ticket.boundingBox()
    const churnAfter = await churn.boundingBox()
    expect(churnAfter!.y).toBeLessThan(ticketAfter!.y)
  })

  // Pedido explícito do usuário: repartir por qualquer período (não só
  // semana), em parcelas iguais — "R$ 100.000 em 4 meses = 4x R$ 25.000" —
  // com progresso/% por parcela visível fora do modal (Acompanhamento por
  // período, no Detalhe). Data travada em 2026-09-03 pra o cálculo do
  // cliente (a partir de "hoje" até o prazo do alvo) dar sempre o mesmo
  // resultado: alvo de 80.000 até 31/12/2026, por mês, vira 4 parcelas
  // iguais de 20.000 (3/set–2/out, 3/out–2/nov, 3/nov–2/dez, 3/dez–30/dez).
  test('repartir o alvo por mês (não só semana) mostra progresso por parcela no Detalhe', async ({ page }) => {
    const checkpoints: Record<string, unknown>[] = []
    // beforeEach já loga — só falta travar o relógio (repartir() parte de
    // "agora") antes de qualquer navegação.
    await page.clock.setFixedTime(new Date(2026, 8, 3, 12, 0, 0))
    await page.route('**/rest/v1/kpi_checkpoints*', async (route) => {
      const req = route.request()
      if (req.method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(checkpoints) })
        return
      }
      if (req.method() === 'DELETE') {
        checkpoints.length = 0
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        return
      }
      const body = JSON.parse(req.postData() || '[]')
      for (const row of Array.isArray(body) ? body : [body]) {
        checkpoints.push({ id: `cp-${checkpoints.length}`, company_id: COMPANY_ID_2, ...row })
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(checkpoints) })
    })

    await page.goto(`/empresa/${COMPANY_ID_2}/kpis`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('link', { name: /Receita recorrente/ }).click()

    // Abre o alvo existente (META_WITH: 80.000 até 2026-12-31) pra repartir.
    await page.getByRole('button', { name: /R\$\s?80\.000,00/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: /Editar alvo/ })).toBeVisible()

    await dialog.getByLabel('Periodicidade da repartição').selectOption('monthly')
    await dialog.getByRole('button', { name: 'Repartir' }).click()
    await expect(page.getByText('Alvo repartido em 4 parcela(s) de mês.')).toBeVisible()

    // A lista de parcelas aparece dentro do próprio modal...
    await expect(dialog.getByText('Mês 1')).toBeVisible()
    await expect(dialog.getByText('Mês 4')).toBeVisible()

    await dialog.getByRole('button', { name: 'Cancelar' }).click()

    // ...e, com mais espaço, também no Detalhe — "Acompanhamento por
    // período", fora do modal, uma parcela por cartão.
    await expect(page.getByText('Acompanhamento por período')).toBeVisible()
    // Escopado por tag (o toast da confirmação é um <span>, esta descrição é
    // um <p>) — sem isso bate tanto na seção quanto no toast ainda visível.
    await expect(page.locator('p', { hasText: /repartido em 4 parcela\(s\) de mês/ })).toBeVisible()
    const cards = page.locator('.card', { hasText: 'Mês' })
    await expect(cards).toHaveCount(4)
    // Divide exato (80.000 / 4) — nenhuma parcela sobra com arredondamento.
    await expect(page.getByText('R$ 20.000,00').first()).toBeVisible()
    // Nenhum lançamento cai dentro de nenhuma das 4 parcelas (o único
    // lançamento do fixture é de agosto, antes da primeira parcela).
    await expect(page.getByText('sem lançamento').first()).toBeVisible()
  })

  // Pedido explícito: editar (não só excluir) um lançamento já registrado.
  test('editar um lançamento existente pelo histórico', async ({ page }) => {
    const values = [
      {
        id: 'v-mrr-ago',
        kpi_id: KPI_WITH,
        company_id: COMPANY_ID_2,
        period_start: '2026-08-01',
        period_end: '2026-08-31',
        value: 92345.67,
        target_value: null,
        note: null,
        source: 'manual',
        created_at: '2026-01-01T00:00:00Z',
      },
    ]
    await page.route('**/rest/v1/kpi_values*', async (route) => {
      const req = route.request()
      if (req.method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(values) })
        return
      }
      const body = JSON.parse(req.postData() || '{}')
      for (const row of Array.isArray(body) ? body : [body]) {
        const idx = values.findIndex((v) => v.kpi_id === row.kpi_id && v.period_start === row.period_start)
        if (idx >= 0) values[idx] = { ...values[idx], ...row }
        else values.push({ id: `v-novo-${values.length}`, target_value: null, note: null, source: 'manual', created_at: '2026-01-01T00:00:00Z', ...row })
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(values) })
    })

    await page.goto(`/empresa/${COMPANY_ID_2}/kpis/${KPI_WITH}`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Histórico' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('R$ 92.345,67')).toBeVisible()
    await dialog.getByRole('button', { name: 'Editar lançamento' }).click()

    await expect(page.getByRole('heading', { name: /Editar lançamento · Receita recorrente/ })).toBeVisible()
    await page.getByLabel('Valor apurado (R$)').fill('99999,99')
    await page.getByRole('button', { name: 'Salvar' }).click()

    await expect(page.getByText('Lançamento atualizado.')).toBeVisible()
    await page.getByRole('button', { name: 'Histórico' }).click()
    await expect(page.getByRole('dialog').getByText('R$ 99.999,99')).toBeVisible()
  })

  // Bug relatado: depois de salvar um lançamento, abrir "Lançar valor" de
  // novo (pro mesmo período ou outro) mostrava valor/observação de um
  // lançamento anterior e o botão Salvar não persistia o valor atual. Dois
  // ciclos completos de lançar→editar seguidos, no mesmo período — cada
  // abertura tem que refletir exatamente o que foi salvo por último, nunca
  // o que veio antes disso.
  test('lançar valor duas vezes seguidas no mesmo período nunca mostra dado de um lançamento anterior', async ({ page }) => {
    // Junho/2027 é um período sem nenhum lançamento no fixture — garante
    // que o primeiro "Lançar valor" abre em branco de verdade.
    await page.clock.setFixedTime(new Date(2027, 5, 15, 12, 0, 0))
    const values: Record<string, unknown>[] = []
    await page.route('**/rest/v1/kpi_values*', async (route) => {
      const req = route.request()
      if (req.method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(values) })
        return
      }
      const body = JSON.parse(req.postData() || '{}')
      for (const row of Array.isArray(body) ? body : [body]) {
        const idx = values.findIndex((v) => v.kpi_id === row.kpi_id && v.period_start === row.period_start)
        if (idx >= 0) values[idx] = { ...values[idx], ...row }
        else values.push({ id: `v-novo-${values.length}`, target_value: null, note: null, source: 'manual', ...row })
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(values) })
    })

    await page.goto(`/empresa/${COMPANY_ID_2}/kpis/${KPI_WITH}`)
    await page.waitForLoadState('networkidle')

    // 1º lançamento: abre em branco, salva 11.111.
    await page.getByRole('button', { name: 'Lançar valor' }).click()
    let dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: /^Lançar valor/ })).toBeVisible()
    await expect(dialog.getByLabel('Valor apurado (R$)')).toHaveValue('')
    await dialog.getByLabel('Valor apurado (R$)').fill('11111')
    await dialog.getByLabel('Observação').fill('Primeiro lançamento')
    await dialog.getByRole('button', { name: 'Salvar' }).click()
    await expect(page.getByText('Valor lançado.')).toBeVisible()

    // 2º lançamento, mesmo período: abre já mostrando os 11.111 recém
    // salvos (não algo de antes) — edita pra 22.222.
    await page.getByRole('button', { name: 'Lançar valor' }).click()
    dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: /^Editar lançamento/ })).toBeVisible()
    await expect(dialog.getByLabel('Valor apurado (R$)')).toHaveValue('11.111,00')
    await expect(dialog.getByLabel('Observação')).toHaveValue('Primeiro lançamento')
    await dialog.getByLabel('Valor apurado (R$)').fill('22222')
    await dialog.getByLabel('Observação').fill('Segundo lançamento')
    await dialog.getByRole('button', { name: 'Salvar' }).click()
    await expect(page.getByText('Lançamento atualizado.')).toBeVisible()

    // 3º: reabrir confirma que o segundo valor realmente persistiu, não
    // ficou preso no primeiro.
    await page.getByRole('button', { name: 'Lançar valor' }).click()
    dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('Valor apurado (R$)')).toHaveValue('22.222,00')
    await expect(dialog.getByLabel('Observação')).toHaveValue('Segundo lançamento')
  })

  // Pedido explícito: vários lançamentos no mesmo dia precisam somar, não
  // um sobrescrever o outro. Antes desta rodada, "Lançar valor" abria
  // sozinho em modo de edição sempre que o dia escolhido já tinha um
  // lançamento fino — mesmo dia = mesmo lançamento, sem como acumular mais
  // de um. Corrigido: com entry_frequency, "Lançar valor" é sempre um
  // lançamento novo; editar um específico só pelo lápis no Histórico.
  test('vários lançamentos no mesmo dia somam — "Lançar valor" nunca vira edição sozinho', async ({ page }) => {
    await page.clock.setFixedTime(new Date(2027, 5, 15, 12, 0, 0))
    const kpis = KPIS.map((item) => (item.id === KPI_WITH ? { ...item, entry_frequency: 'daily' } : item))
    await page.route('**/rest/v1/kpis*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(kpis) })
    })

    const entries: Record<string, unknown>[] = []
    await page.route('**/rest/v1/kpi_value_entries*', async (route) => {
      const req = route.request()
      if (req.method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(entries) })
        return
      }
      if (req.method() === 'PATCH') {
        // supabase-js .update(patch).eq('id', x) manda o id como query string.
        const id = new URL(req.url()).searchParams.get('id')?.replace('eq.', '')
        const patch = JSON.parse(req.postData() || '{}')
        const idx = entries.findIndex((item) => item.id === id)
        if (idx >= 0) entries[idx] = { ...entries[idx], ...patch }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(entries) })
        return
      }
      // POST — sempre um insert novo, nunca upsert (não existe mais unique
      // por dia em kpi_value_entries, ver 0037_kpi_value_entries_multiple_per_day.sql).
      const body = JSON.parse(req.postData() || '{}')
      for (const row of Array.isArray(body) ? body : [body]) {
        entries.push({ id: `entrada-${entries.length}`, ...row })
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(entries) })
    })
    await page.route('**/rest/v1/kpi_values*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto(`/empresa/${COMPANY_ID_2}/kpis/${KPI_WITH}`)
    await page.waitForLoadState('networkidle')

    // 1º lançamento do dia: abre em branco.
    await page.getByRole('button', { name: 'Lançar valor' }).click()
    let dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: /^Lançar valor/ })).toBeVisible()
    await expect(dialog.getByLabel('Valor apurado (R$)')).toHaveValue('')
    await dialog.getByLabel('Valor apurado (R$)').fill('100')
    await dialog.getByLabel('Observação').fill('Manhã')
    await dialog.getByRole('button', { name: 'Salvar' }).click()
    await expect(page.getByText('Valor lançado.')).toBeVisible()

    // 2º lançamento, MESMO dia: continua abrindo em branco — não vira
    // edição do primeiro só porque o dia já tem lançamento.
    await page.getByRole('button', { name: 'Lançar valor' }).click()
    dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: /^Lançar valor/ })).toBeVisible()
    await expect(dialog.getByLabel('Valor apurado (R$)')).toHaveValue('')
    await dialog.getByLabel('Valor apurado (R$)').fill('50')
    await dialog.getByLabel('Observação').fill('Tarde')
    await dialog.getByRole('button', { name: 'Salvar' }).click()
    // Mesmo texto de toast do primeiro lançamento (os dois são inserts) —
    // pode ainda estar visível o do primeiro, então confere o mais recente.
    await expect(page.getByText('Valor lançado.').last()).toBeVisible()

    // Os dois lançamentos persistem lado a lado no Histórico — nenhum
    // sobrescreveu o outro.
    await page.getByRole('button', { name: 'Histórico' }).click()
    const history = page.getByRole('dialog')
    await expect(history.getByText('R$ 100,00')).toBeVisible()
    await expect(history.getByText('R$ 50,00')).toBeVisible()

    // Editar o lançamento da manhã especificamente (pelo lápis) abre com o
    // valor/observação DELE, não do outro lançamento do mesmo dia.
    await history.getByRole('button', { name: 'Editar lançamento fino' }).last().click()
    dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: /^Editar lançamento/ })).toBeVisible()
    await expect(dialog.getByLabel('Valor apurado (R$)')).toHaveValue('100,00')
    await expect(dialog.getByLabel('Observação')).toHaveValue('Manhã')
  })

  // Bug relatado: turmas cadastradas fora de ordem cronológica (set, nov,
  // out) apareciam na quebra do Detalhe na ordem de cadastro — "bagunçado"
  // de bater o olho. A ordenação automática tem que ser por prazo.
  test('turmas na quebra do Detalhe aparecem em ordem de prazo, não de cadastro', async ({ page }) => {
    // Uma turma de verdade sempre tem product_edition_id — é o que decide
    // o rótulo mostrado (nestedLabel usa o nome da edição, não o nome
    // sintetizado do kpi). Editions com nomes fictícios só pra este teste.
    const editions = [
      ...PRODUCT_EDITIONS,
      { id: 'edicao-set-teste', product_id: PRODUCT_ID, company_id: COMPANY_ID_2, name: 'Turma Set 2026' },
      { id: 'edicao-nov-teste', product_id: PRODUCT_ID, company_id: COMPANY_ID_2, name: 'Turma Nov 2026' },
      { id: 'edicao-out-teste', product_id: PRODUCT_ID, company_id: COMPANY_ID_2, name: 'Turma Out 2026' },
    ]
    const kpiBase = {
      company_id: COMPANY_ID_2,
      category: 'Financeiro',
      unit: 'currency',
      direction: 'up',
      frequency: 'monthly',
      product_id: PRODUCT_ID,
      parent_kpi_id: KPI_PRODUCT,
      is_active: true,
      archived_at: null,
      entry_frequency: null,
    }
    // Cadastradas fora de ordem de propósito — set, depois nov, depois out
    // — pra provar que a tela não está só refletindo a ordem de chegada.
    const kpis = [
      ...KPIS,
      { id: 'turma-set-teste', name: 'turma-set-teste-nome', product_edition_id: 'edicao-set-teste', ...kpiBase },
      { id: 'turma-nov-teste', name: 'turma-nov-teste-nome', product_edition_id: 'edicao-nov-teste', ...kpiBase },
      { id: 'turma-out-teste', name: 'turma-out-teste-nome', product_edition_id: 'edicao-out-teste', ...kpiBase },
    ]
    const metas = [
      ...METAS,
      { id: 'meta-turma-set', company_id: COMPANY_ID_2, kpi_id: 'turma-set-teste', target_value: 5720, due_date: '2026-09-09', owner_id: null, status: 'active', archived_at: null },
      { id: 'meta-turma-nov', company_id: COMPANY_ID_2, kpi_id: 'turma-nov-teste', target_value: 5720, due_date: '2026-11-10', owner_id: null, status: 'active', archived_at: null },
      { id: 'meta-turma-out', company_id: COMPANY_ID_2, kpi_id: 'turma-out-teste', target_value: 5720, due_date: '2026-10-14', owner_id: null, status: 'active', archived_at: null },
    ]
    await page.route('**/rest/v1/kpis*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(kpis) })
    })
    await page.route('**/rest/v1/product_editions*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(editions) })
    })
    await page.route('**/rest/v1/metas*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(metas) })
    })

    await page.goto(`/empresa/${COMPANY_ID_2}/kpis/${KPI_PRODUCT}`)
    await page.waitForLoadState('networkidle')

    const set = page.getByRole('link', { name: /^Turma Set 2026/ })
    const out = page.getByRole('link', { name: /^Turma Out 2026/ })
    const nov = page.getByRole('link', { name: /^Turma Nov 2026/ })
    const setBox = await set.boundingBox()
    const outBox = await out.boundingBox()
    const novBox = await nov.boundingBox()

    expect(setBox!.y).toBeLessThan(outBox!.y)
    expect(outBox!.y).toBeLessThan(novBox!.y)
  })

  // Pedido explícito: indicador de contribuição de um filho pro total do
  // pai ("Entre Donos representa 9% do faturamento total"). KPI_EDITION é
  // o único filho de KPI_PRODUCT, então soma 100% — o caso mais simples de
  // conferir sem depender de mais fixtures.
  test('contribuição do filho pro total do pai aparece no Detalhe', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}/kpis/${KPI_PRODUCT}`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Como este número se divide')).toBeVisible()
    const row = page.getByRole('link', { name: /Imersão Setembro 2026/ })
    await expect(row).toBeVisible()
    await expect(row).toContainText('100%')
  })

  // Pedido explícito: somatória dos alvos dos produtos, pra comparar com o
  // alvo definido no nível de cima. KPI_PRODUCT tem uma única turma-filha
  // (KPI_EDITION, alvo de 35.000) — soma esperada é exatamente esse valor.
  test('soma dos alvos dos produtos aparece no cartão e na tabela de quebra', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}/kpis/${KPI_PRODUCT}`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Soma dos alvos dos produtos: R$ 35.000,00')).toBeVisible()
  })

  // Pedido explícito: repartir por período e produto/turma são duas
  // respostas pra mesma pergunta ("como isso se divide?") quando a meta já
  // tem filho — a segunda vence, a primeira nem aparece.
  test('meta com produto/turma não oferece repartir por período — "Como este número se divide" já cobre isso', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}/kpis/${KPI_PRODUCT}`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Acompanhamento por período')).not.toBeVisible()

    await page.getByRole('button', { name: /R\$\s?400\.000,00/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: /Editar alvo/ })).toBeVisible()
    await expect(dialog.getByText('Repartir por período')).not.toBeVisible()
  })

  // Pedido explícito: em vez de forçar o alvo do produto a SER sempre a
  // soma das turmas (perde o planejamento de cima pra baixo e a soma pode
  // ficar parcial em silêncio), um botão explícito preenche o alvo com a
  // soma de quem já tem — continua editável depois, não trava.
  test('"Usar soma das turmas vinculados" preenche alvo e prazo sem travar o campo', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}/kpis/${KPI_PRODUCT}`)
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /R\$\s?400\.000,00/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: /Editar alvo/ })).toBeVisible()

    const useSumButton = dialog.getByRole('button', { name: /Usar soma das turmas vinculados/ })
    await expect(useSumButton).toContainText('R$ 35.000,00')
    await useSumButton.click()

    await expect(dialog.getByLabel('Alvo')).toHaveValue('35.000,00')
    await expect(dialog.locator('input[type=date]')).toHaveValue('2026-09-17')

    // Continua editável — o clique só preencheu, não travou o campo.
    await dialog.getByLabel('Alvo').fill('99.999,00')
    await expect(dialog.getByLabel('Alvo')).toHaveValue('99.999,00')
  })
})

// Item: nenhuma tela pode abrir com zoom aplicado no celular — o caso
// relatado foi logo após o login, mas o mesmo bug (input abaixo de 16px)
// pode se esconder dentro de qualquer modal, então além da varredura por
// rota acima, confere também telas que só aparecem depois de interagir:
// a própria tela de login (antes de entrar), o formulário de tarefa e o
// item de orçamento dentro do modal de detalhe.
test.describe('sem zoom automático no celular', () => {
  test('tela de login', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'Mobile 390', 'só faz sentido no celular')
    await mockSupabase(page)
    await page.goto('/login')
    await checkNoTinyFormFields(page)
  })

  test('formulário de tarefa', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'Mobile 390', 'só faz sentido no celular')
    await login(page)
    await page.goto(`/empresa/${COMPANY_ID}/tarefas`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Editar' }).first().click()
    await page.waitForTimeout(300)
    await checkNoTinyFormFields(page)
  })

  test('item de orçamento dentro do modal de detalhe', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'Mobile 390', 'só faz sentido no celular')
    await login(page)
    await page.goto(`/empresa/${COMPANY_ID_2}/orcamentos`)
    await page.waitForLoadState('networkidle')
    await page.getByText('Imersão 2027', { exact: true }).click()
    await checkNoTinyFormFields(page)
  })
})
