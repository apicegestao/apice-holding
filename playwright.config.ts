// Roda a mesma suíte em dois formatos de tela — desktop e celular — contra o
// build de produção servido localmente. Nenhum teste fala com a internet: a
// REST/Auth/RPC do Supabase é toda simulada em e2e/fixtures.ts.
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'Desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      // Emula um celular (toque, viewport 390px) sem depender do WebKit —
      // este ambiente só tem o Chromium instalado, e a emulação de toque
      // funciona igual para o que estes testes checam (layout e overflow).
      name: 'Mobile 390',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
  ],
})
