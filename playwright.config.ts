import { defineConfig, devices } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";

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

/**
 * Where the dummy data provider lives.
 *
 * It is a SIBLING of this repo in the workspace, which is what
 * `e2e/fixtures/provider-server.mjs` assumes when it walks up three directories.
 * A git worktree (the worktree root `start-branch.ps1` makes, where the change
 * being tested is made) is outside the repo tree, so that walk reaches nothing,
 * the provider serves an empty directory, and the whole suite dies on a 30s
 * webServer timeout before a single test runs.
 *
 * git knows where the checkout really is: in a worktree `--git-common-dir` is the
 * MAIN checkout's `.git`. Resolve the provider from there, so the suite runs the
 * same way from a worktree as from the checkout.
 */
function providerRoot() {
  try {
    const commonDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf8",
    }).trim();
    return path.resolve(path.dirname(commonDir), "..", "nova-dummy-data-provider", "public");
  } catch {
    return path.resolve(process.cwd(), "..", "nova-dummy-data-provider", "public");
  }
}

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
      env: {
        NOVA_DEMO_PROVIDER_PORT: String(PROVIDER_PORT),
        NOVA_DEMO_PROVIDER_ROOT: process.env.NOVA_DEMO_PROVIDER_ROOT ?? providerRoot(),
      },
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
