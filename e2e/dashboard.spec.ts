// Suíte de regressão do painel: mesma rota, mesmos dados simulados, rodando
// nos dois projetos configurados em playwright.config.ts (Desktop e Mobile
// 390px) — assim qualquer recurso novo entra automaticamente na cobertura
// dos dois formatos, sem depender de alguém lembrar de testar o celular.
import { expect, test } from '@playwright/test'
import { COMPANY_ID, COMPANY_ID_2, login, mockSupabase, ROUTES, USER_ID } from './fixtures'

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

  // Item 1: um KPI cadastrado sem nenhum valor lançado ainda é um KPI de
  // verdade — não pode desaparecer do painel da empresa.
  test('KPI sem lançamento aparece no painel (não some)', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID}`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Faturamento', { exact: true })).toBeVisible()
    await expect(page.getByText('sem lançamento', { exact: true })).toBeVisible()
  })

  // Itens 4 e 5: gráficos comparativos aparecem quando há o que comparar.
  test('gráficos comparativos aparecem no painel da empresa', async ({ page }) => {
    await page.goto(`/empresa/${COMPANY_ID_2}`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('KPIs: realizado x meta')).toBeVisible()
    await expect(page.getByText('Tarefas por situação')).toBeVisible()
  })

  test('gráfico comparativo entre empresas aparece no painel da holding', async ({ page }) => {
    await page.goto('/holding')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('KPIs na meta por empresa')).toBeVisible()
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

// Itens 6, 7 e 8: menu único de organização (com linha do tempo), painel de
// edição de nó virou botão/modal, e a barra de ferramentas nunca esconde
// botão nenhum no celular.
test.describe('mapa mental', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('menu Organizar oferece linha do tempo', async ({ page }) => {
    await page.goto('/holding/mapa-mental')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Organizar' }).click()
    await expect(page.getByText('Linha do tempo')).toBeVisible()
    await expect(page.getByText('Organograma')).toBeVisible()
    await expect(page.getByText('Fluxo lógico')).toBeVisible()
  })

  test('clicar num nó mostra o botão Editar nó em vez de painel fixo', async ({ page }) => {
    await page.goto('/holding/mapa-mental')
    await page.waitForLoadState('networkidle')
    await page.getByText('Expansão 2027', { exact: true }).click()
    await page.getByRole('button', { name: 'Editar nó' }).click()
    await expect(page.getByLabel('Ideia')).toBeVisible()
    await expect(page.getByLabel('Anotações')).toBeVisible()
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
