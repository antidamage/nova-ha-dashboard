import { defineConfig, devices } from "@playwright/test";

// E2E runs against the dashboard in demo mode (NEXT_PUBLIC_NOVA_DEMO_MODE=true).
// Demo mode replaces every `/api/*` call and the SSE stream with the
// nova-dummy-data-provider fixtures, so no real Home Assistant, camera, or
// account data is touched. Two web servers are started: the dummy data provider
// (served cross-origin with CORS, mirroring the production GitHub Pages demo)
// and the Next.js dev server in demo mode.
const DASHBOARD_PORT = Number(process.env.NOVA_E2E_PORT ?? 3210);
const PROVIDER_PORT = Number(process.env.NOVA_DEMO_PROVIDER_PORT ?? 4174);
const PROVIDER_BASE = `http://127.0.0.1:${PROVIDER_PORT}/`;
const BASE_URL = `http://127.0.0.1:${DASHBOARD_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // The whole suite shares one `next dev` server, so retry once to absorb the
  // occasional first-compile race and cap concurrency to keep it responsive.
  retries: 1,
  workers: 3,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never", outputFolder: "e2e-report" }]]
    : [["list"], ["html", { open: "never", outputFolder: "e2e-report" }]],
  outputDir: "e2e-results",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: "node e2e/fixtures/provider-server.mjs",
      url: `${PROVIDER_BASE}index.html`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { NOVA_DEMO_PROVIDER_PORT: String(PROVIDER_PORT) },
    },
    {
      command: `npx next dev --hostname 127.0.0.1 --port ${DASHBOARD_PORT}`,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        NEXT_PUBLIC_NOVA_DEMO_MODE: "true",
        NEXT_PUBLIC_NOVA_DEMO_PROVIDER_BASE: PROVIDER_BASE,
      },
    },
  ],
});
