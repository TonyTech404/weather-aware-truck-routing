import { defineConfig, devices } from '@playwright/test'

/** Production smoke test: real browser, deployed frontend, deployed API, live providers. */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/smoke.spec.ts',
  retries: 1,
  timeout: 120_000,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: process.env.SMOKE_WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [{ name: 'smoke', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
})
