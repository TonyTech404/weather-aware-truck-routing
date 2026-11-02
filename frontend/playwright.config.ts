import { defineConfig, devices } from '@playwright/test'

// Software WebGL so MapLibre renders in headless Chromium (CI has no GPU).
const WEBGL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

/**
 * Browser tests run against the production-style build (`--mode e2e`) talking to the real
 * Django API backed by a deterministic fake upstream (backend/e2e_server.py).
 * Post-deploy checks against the live providers use playwright.smoke.config.ts.
 */
export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/smoke.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { args: WEBGL_ARGS },
  },
  projects: [
    { name: 'desktop', testIgnore: [/responsive/, /smoke/], use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', testMatch: /responsive/, use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'uv run uvicorn e2e_server:application --port 8100',
      cwd: '../backend',
      url: 'http://127.0.0.1:8100/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npm run build:e2e && npm run preview -- --port 4173 --host 127.0.0.1',
      url: 'http://127.0.0.1:4173',
      env: { VITE_DEV_API_TARGET: 'http://127.0.0.1:8100' },
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
})
