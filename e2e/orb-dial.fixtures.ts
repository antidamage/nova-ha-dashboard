// The backend shim and orb gestures shared by the status orb dial e2e specs
// (orb-dial.spec.ts and orb-dial.dismiss.spec.ts). It is deliberately not a
// `*.spec.ts` file: Playwright collects those by glob, and a helper must not be
// collected as a spec of its own. orb-test-env must stay the first import: it
// points lib/tasks at scratch files before that module reads its paths.
import { writeFileSync } from "node:fs";
import { ORB_TEST_SCRATCH } from "./orb-test-env";
import { type Browser, type Page } from "@playwright/test";
import { readTasks } from "../lib/tasks";
import * as dismissRoute from "../app/api/tasks/[id]/dismiss/route";
import "../lib/dashboard-events";
import { gotoDashboard } from "./helpers";

// Status orb stack dial and shared dismissal (specs/status-orb-stack.md, Round 2).
//
// The e2e server runs in demo mode, which cannot serve API routes. The reminder
// side of these tests therefore runs the REAL server code in this process:
// `/api/tasks?command=list`, `/api/tasks/:id/dismiss` and the wash chime claim
// call the actual route handlers and lib/tasks against a scratch task file
// (see orb-test-env.ts), and every task event the server publishes
// (publishTasks / publishTaskDismiss) is captured from the real
// dashboard-events broadcaster and delivered to each open page's event stream.
// The orb preferences, watchface and timer stay faked.
const SHOTS = `${ORB_TEST_SCRATCH}/shots-orb`;

const HOUR = 3_600_000;

export type Backend = {
  timer: Record<string, unknown> | null;
  entries: Array<Record<string, unknown>>;
  pages: Page[];
};

export function backendFor(now: number, timerDone: boolean | null): Backend {
  return {
    timer: timerDone === null ? null : { id: "t1", icon: "egg", label: "Egg", durationMs: 6 * 60_000, startedAt: now - 7 * 60_000,
      endsAt: timerDone ? now - 60_000 : now + 90_000, completedAt: timerDone ? now - 60_000 : null, dismissedAt: null },
    entries: [
      { id: "gym", moduleId: "gym", enabled: true },
      { id: "clock", moduleId: "clock", enabled: true },
      { id: "timer", moduleId: "timer", enabled: true },
      { id: "lights", moduleId: "lights-on", enabled: true },
    ],
    pages: [],
  };
}

async function deliver(pages: Page[], type: string, data: string) {
  await Promise.all(pages.map((page) => page.evaluate(({ type, data }) => {
    const sources = (window as unknown as { __orbSources: Array<{ dispatchEvent: (event: unknown) => void }> }).__orbSources;
    for (const source of sources) source.dispatchEvent({ type, data });
  }, { type, data }).catch(() => undefined)));
}

/** Subscribe this process to the real server's task broadcasts and forward them to the pages. */
export function realTaskEvents(backend: Backend) {
  const store = (globalThis as unknown as { __novaDashboardEvents: { taskClients: Set<unknown> } }).__novaDashboardEvents;
  const decoder = new TextDecoder();
  const client = {
    id: 900_000 + Math.floor(Math.random() * 1000),
    controller: {
      enqueue(bytes: Uint8Array) {
        const chunk = decoder.decode(bytes);
        const type = chunk.match(/^event: (.+)$/m)?.[1];
        const data = chunk.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
        if (type) void deliver(backend.pages, type, data);
      },
    },
  };
  store.taskClients.add(client);
  return () => store.taskClients.delete(client);
}

/**
 * Seed the scratch task file directly rather than through `writeTasks`, whose
 * reminder-icon reconciliation dynamically imports a module the Playwright
 * loader cannot transpile. The routes under test read the file the same way.
 */
export function seedTasks(tasks: Array<Record<string, unknown>>) {
  writeFileSync(process.env.NOVA_DASHBOARD_TASKS!, JSON.stringify({ tasks }));
}

/** API answers for a page: real reminder routes, faked orb settings and timer. */
export async function attach(page: Page, backend: Backend) {
  backend.pages.push(page);
  await page.exposeFunction("__orbApi", async (url: string, method: string, body: string) => {
    const now = Date.now();
    const pathname = url.split("?")[0];
    if (pathname === "/api/orb-info") return { status: 200, json: { orbInfo: { entries: backend.entries } } };
    if (pathname === "/api/orb-info/events") return { status: 200, json: { outputs: {} } };
    if (pathname === "/api/watchface") return { status: 200, json: { watchface: { gymLastResetAt: new Date(now - 30 * HOUR).toISOString(), gymAlertThresholdHours: 46 } } };
    if (pathname === "/api/orb-timer" && method === "GET") return { status: 200, json: { timer: backend.timer } };
    if (pathname === "/api/orb-timer") {
      const command = JSON.parse(body || "{}");
      if (command.command === "dismiss" && backend.timer?.id === command.id) {
        backend.timer = { ...backend.timer, dismissedAt: now };
        await deliver(backend.pages, "orb-timer", JSON.stringify({ timer: backend.timer }));
      }
      return { status: 200, json: command.command === "chime" ? { claimed: false } : { timer: backend.timer } };
    }
    if (pathname === "/api/tasks" && method === "GET") {
      return { status: 200, json: { tasks: await readTasks() } };
    }
    const dismiss = pathname.match(/^\/api\/tasks\/([^/]+)\/dismiss$/);
    if (dismiss) {
      const response = await dismissRoute.POST(new Request(`http://local${url}`, { method: "POST", body: "{}" }), { params: Promise.resolve({ id: decodeURIComponent(dismiss[1]) }) });
      return { status: response.status, json: await response.json() };
    }
    return null;
  });
  // Demo mode installs its own fetch and EventSource; wrap them as they are
  // assigned.
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const sources: Array<{ dispatchEvent: (event: unknown) => void }> = [];
    w.__orbSources = sources;
    let fetchImpl = window.fetch;
    let EventSourceImpl: unknown = window.EventSource;
    const handled = /^\/api\/(orb-info|orb-timer|watchface|tasks)/;
    const wrappedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      if (url.origin === location.origin && handled.test(url.pathname.replace(/\/$/, ""))) {
        const api = w.__orbApi as (u: string, m: string, b: string) => Promise<{ status: number; json: unknown } | null>;
        const result = await api(url.pathname.replace(/\/$/, "") + url.search, init?.method ?? "GET", typeof init?.body === "string" ? init.body : "");
        if (result) return new Response(JSON.stringify(result.json), { status: result.status, headers: { "Content-Type": "application/json" } });
      }
      return fetchImpl(input, init);
    };
    Object.defineProperty(window, "fetch", { configurable: true, get: () => wrappedFetch, set: (value) => { fetchImpl = value; } });
    function WrappedEventSource(...args: unknown[]) {
      const instance = new (EventSourceImpl as new (...a: unknown[]) => { dispatchEvent: (event: unknown) => void })(...args);
      sources.push(instance);
      return instance;
    }
    Object.assign(WrappedEventSource, { CONNECTING: 0, OPEN: 1, CLOSED: 2 });
    Object.defineProperty(window, "EventSource", { configurable: true, get: () => WrappedEventSource, set: (value) => { EventSourceImpl = value; } });
  });
}

export const orb = (page: Page) => page.locator(".nova-avatar-host[data-orb-dial]").first();
export const readout = (page: Page) => orb(page).locator(".nova-avatar-gym-counter");
export const shot = async (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, clip: (await orb(page).boundingBox())! });

export function ringPoint(box: { x: number; y: number; width: number; height: number }, deg: number): [number, number] {
  const r = box.width * 0.42;
  return [box.x + box.width / 2 + r * Math.sin((deg * Math.PI) / 180), box.y + box.height / 2 - r * Math.cos((deg * Math.PI) / 180)];
}

export async function dragAround(page: Page, fromDeg: number, toDeg: number) {
  const box = (await orb(page).boundingBox())!;
  await page.mouse.move(...ringPoint(box, fromDeg));
  await page.mouse.down();
  for (let deg = fromDeg; deg <= toDeg; deg += 5) await page.mouse.move(...ringPoint(box, deg));
  await page.mouse.up();
}

export async function twoPages(browser: Browser, backend: Backend) {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  for (const page of pages) await attach(page, backend);
  for (const page of pages) await gotoDashboard(page);
  return { contexts, pages };
}
