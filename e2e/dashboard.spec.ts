// Suíte de regressão do painel: mesma rota, mesmos dados simulados, rodando
// nos dois projetos configurados em playwright.config.ts (Desktop e Mobile
// 390px) — assim qualquer recurso novo entra automaticamente na cobertura
// dos dois formatos, sem depender de alguém lembrar de testar o celular.
import { expect, test } from '@playwright/test'
import { COMPANY_ID, COMPANY_ID_2, login, ROUTES, USER_ID } from './fixtures'

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
