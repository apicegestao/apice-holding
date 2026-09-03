// Suíte de regressão do painel: mesma rota, mesmos dados simulados, rodando
// nos dois projetos configurados em playwright.config.ts (Desktop e Mobile
// 390px) — assim qualquer recurso novo entra automaticamente na cobertura
// dos dois formatos, sem depender de alguém lembrar de testar o celular.
import { expect, test } from '@playwright/test'
import {
  COMPANY_ID,
  COMPANY_ID_2,
  EDITION_ID,
  EDITION_ID_2,
  HOLDING_ID,
  KPI_EDITION,
  KPI_PRODUCT,
  KPI_WITH,
  KPIS,
  login,
  mockSupabase,
  NOTES,
  PRODUCT_ID,
  ROUTES,
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
    // aparece inline aqui.
    await expect(page.locator('.card').getByText('Financeiro', { exact: true })).toBeVisible()
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
    await dialog.getByRole('button', { name: 'Vincular' }).click()

    await expect(page.getByText('Vínculo criado.')).toBeVisible()
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
        for (const row of Array.isArray(body) ? body : [body]) {
          kpis.push({ id: `novo-kpi-${kpis.length}`, is_active: true, archived_at: null, entry_frequency: null, ...row })
        }
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
