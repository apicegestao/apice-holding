// Regressão de segurança: a CSP (definida via <meta> em index.html, não no
// config do host — veja o comentário lá) não pode nunca ser violada pelo
// próprio sistema. Cor dinâmica (empresa, KPI) usa o atributo style, coberto
// por 'unsafe-inline' em style-src — o resto (script, conexão, imagem,
// fonte) tem que vir só da própria origem e do Supabase do projeto. Se algo
// novo violar a política, é o próprio código que precisa mudar — nunca a
// política que deve ficar mais permissiva sem necessidade real.
import { expect, test } from '@playwright/test'
import { COMPANY_ID, COMPANY_ID_2, login, ROUTES } from './fixtures'

test.describe('política de segurança de conteúdo (CSP)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  for (const [path, label] of ROUTES) {
    test(`sem violação de CSP — ${label}`, async ({ page }) => {
      const violations: string[] = []
      page.on('console', (msg) => {
        if (msg.type() === 'error' && /content security policy|refused to/i.test(msg.text())) {
          violations.push(msg.text())
        }
      })
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      expect(violations, violations.join('\n')).toEqual([])
    })
  }

  // Telas com cor dinâmica de verdade (empresa, tarefa) — onde o style-src
  // 'unsafe-inline' realmente precisa cobrir algo.
  test('sem violação de CSP com cores dinâmicas (empresa e tarefas)', async ({ page }) => {
    const violations: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error' && /content security policy|refused to/i.test(msg.text())) {
        violations.push(msg.text())
      }
    })
    await page.goto(`/empresa/${COMPANY_ID_2}`)
    await page.waitForLoadState('networkidle')
    await page.goto(`/empresa/${COMPANY_ID}/tarefas`)
    await page.waitForLoadState('networkidle')
    expect(violations, violations.join('\n')).toEqual([])
  })
})
