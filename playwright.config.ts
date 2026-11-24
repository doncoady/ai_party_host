import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end suite. The dev server boots in mock mode so the whole game —
 * live-host socket, theme packs, the clip pipeline (real ffmpeg slicing of a
 * synthesized source) and the UI — runs without network access or API keys.
 */
const PORT = Number(process.env.E2E_PORT || 3177);

/**
 * Two projects:
 *   core      (e2e/core)     – the essentials, ~2 minutes: `npm run test:e2e`
 *   extended  (e2e/extended) – the long tail: `npm run test:e2e:all`
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 75_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    video: 'off',
    permissions: ['microphone'],
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  projects: [
    { name: 'core', testDir: './e2e/core', use: { ...devices['Desktop Chrome'] } },
    { name: 'extended', testDir: './e2e/extended', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // Production build + static server: no dev-server reloads, identical to what players get.
    command: process.env.E2E_DEV_SERVER ? 'npx tsx server.ts' : 'npm run build && npx tsx server.ts',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      PARTY_HOST_MODE: 'mock',
      NODE_ENV: process.env.E2E_DEV_SERVER ? 'development' : 'production',
      PORT: String(PORT),
      PARTY_HOST_CACHE_DIR: '.cache-e2e',
      // Settings saved during tests must never touch the developer's real .env.
      PARTY_HOST_ENV_FILE: '.cache-e2e/.env',
      DISABLE_HMR: 'true',
    },
  },
});
