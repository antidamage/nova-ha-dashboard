import { writeFileSync } from "node:fs";
import { ORB_TEST_SCRATCH } from "./orb-test-env";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { readTasks } from "../lib/tasks";
import * as dismissRoute from "../app/api/tasks/[id]/dismiss/route";
import * as washChimeRoute from "../app/api/power/washing-machine/chime/route";
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

type Backend = {
  timer: Record<string, unknown> | null;
  entries: Array<Record<string, unknown>>;
  pages: Page[];
};

function backendFor(now: number, timerDone: boolean | null): Backend {
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
function realTaskEvents(backend: Backend) {
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
function seedTasks(tasks: Array<Record<string, unknown>>) {
  writeFileSync(process.env.NOVA_DASHBOARD_TASKS!, JSON.stringify({ tasks }));
}

/** API answers for a page: real reminder routes, faked orb settings and timer. */
async function attach(page: Page, backend: Backend) {
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
    if (pathname === "/api/power/washing-machine/chime") {
      const response = await washChimeRoute.POST(new Request(`http://local${url}`, { method: "POST", body }));
      return { status: response.status, json: await response.json() };
    }
    return null;
  });
  // Demo mode installs its own fetch and EventSource; wrap them as they are
  // assigned. Media playback is recorded rather than decoded.
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const sources: Array<{ dispatchEvent: (event: unknown) => void }> = [];
    const media: Array<{ src: string; action: string }> = [];
    w.__orbSources = sources;
    w.__orbMedia = media;
    HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) { media.push({ src: this.src, action: "play" }); return Promise.resolve(); };
    HTMLMediaElement.prototype.pause = function pause(this: HTMLMediaElement) { media.push({ src: this.src, action: "pause" }); };
    let fetchImpl = window.fetch;
    let EventSourceImpl: unknown = window.EventSource;
    const handled = /^\/api\/(orb-info|orb-timer|watchface|tasks|power\/washing-machine\/chime)/;
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

const orb = (page: Page) => page.locator(".nova-avatar-host[data-orb-dial]").first();
const readout = (page: Page) => orb(page).locator(".nova-avatar-gym-counter");
const shot = async (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, clip: (await orb(page).boundingBox())! });
const media = (page: Page) => page.evaluate(() => (window as unknown as { __orbMedia: Array<{ src: string; action: string }> }).__orbMedia);

function ringPoint(box: { x: number; y: number; width: number; height: number }, deg: number): [number, number] {
  const r = box.width * 0.42;
  return [box.x + box.width / 2 + r * Math.sin((deg * Math.PI) / 180), box.y + box.height / 2 - r * Math.cos((deg * Math.PI) / 180)];
}

async function dragAround(page: Page, fromDeg: number, toDeg: number) {
  const box = (await orb(page).boundingBox())!;
  await page.mouse.move(...ringPoint(box, fromDeg));
  await page.mouse.down();
  for (let deg = fromDeg; deg <= toDeg; deg += 5) await page.mouse.move(...ringPoint(box, deg));
  await page.mouse.up();
}

async function twoPages(browser: Browser, backend: Backend) {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  for (const page of pages) await attach(page, backend);
  for (const page of pages) await gotoDashboard(page);
  return { contexts, pages };
}

test.describe("status orb dial", () => {
  test.use({ viewport: { width: 1366, height: 768 } });
  test.describe.configure({ mode: "serial" });

  test("tap opens the dial, drag steps, 5 s defocus, 10 s return", async ({ page }) => {
    test.setTimeout(90_000);
    seedTasks([]);
    const backend = backendFor(Date.now(), false);
    await attach(page, backend);
    await gotoDashboard(page);
    const host = orb(page);
    await expect(host).toHaveAttribute("data-orb-dial", "closed");
    // Running countdown first, then on entries in user order.
    await expect(readout(page)).toHaveAttribute("data-nova-orb-info-module", "timer");
    await shot(page, "01-rest");

    await host.click();
    await expect(host).toHaveAttribute("data-orb-dial", "open");
    await page.waitForTimeout(250);
    await shot(page, "02-open");

    // One detent is 45 degrees for this four-entry stack; 65 clears it with
    // margin for the tap slop at the start of the drag, and stays under two.
    await dragAround(page, 0, 65);
    const touched = Date.now();
    await expect(host).toHaveAttribute("data-orb-dial-index", "1");
    await expect(readout(page)).toHaveAttribute("data-nova-orb-info-module", "gym");
    await page.waitForTimeout(400);
    await shot(page, "04-gym");
    await expect(readout(page).locator(".orb-event-icon")).toHaveCount(1);

    await expect(host).toHaveAttribute("data-orb-dial", "closed", { timeout: 7_000 });
    const closedAfter = Date.now() - touched;
    expect(closedAfter, `closed after ${closedAfter} ms`).toBeGreaterThan(4_500);
    await expect(host).toHaveAttribute("data-orb-dial-index", "1");
    await expect(host).toHaveAttribute("data-orb-dial-index", "0", { timeout: 7_000 });
    expect(Date.now() - touched).toBeGreaterThan(9_000);

    // Keyboard: Enter opens, arrows step, Escape closes.
    await host.focus();
    await page.keyboard.press("Enter");
    await expect(host).toHaveAttribute("data-orb-dial", "open");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(host).toHaveAttribute("data-orb-dial-index", "2");
    await page.keyboard.press("Escape");
    await expect(host).toHaveAttribute("data-orb-dial", "closed");
  });

  test("touch: a tap opens the dial and a finger drag around the orb steps it", async ({ browser }) => {
    seedTasks([]);
    const backend = backendFor(Date.now(), false);
    const context = await browser.newContext({ hasTouch: true, viewport: { width: 1366, height: 768 } });
    try {
      const page = await context.newPage();
      await attach(page, backend);
      await gotoDashboard(page);
      const host = orb(page);
      const box = (await host.boundingBox())!;
      const cdp = await context.newCDPSession(page);
      const touch = (type: string, point?: [number, number]) => cdp.send("Input.dispatchTouchEvent", {
        type, touchPoints: point ? [{ x: point[0], y: point[1], id: 1, radiusX: 4, radiusY: 4, force: 1 }] : [],
      });
      await touch("touchStart", ringPoint(box, 0));
      await touch("touchEnd");
      await expect(host).toHaveAttribute("data-orb-dial", "open");
      await touch("touchStart", ringPoint(box, -10));
      for (let deg = -5; deg <= 100; deg += 5) await touch("touchMove", ringPoint(box, deg));
      await touch("touchEnd");
      await expect(host).toHaveAttribute("data-orb-dial-index", "2");
      await expect(host).toHaveAttribute("data-orb-dial", "open");
      await shot(page, "07-touch-index-2");
    } finally {
      await context.close();
    }
  });

  test("tapping a finished timer dismisses it in two open browser contexts", async ({ browser }) => {
    seedTasks([]);
    const backend = backendFor(Date.now(), true);
    const { contexts, pages } = await twoPages(browser, backend);
    try {
      for (const page of pages) await expect(readout(page)).toHaveAttribute("data-nova-orb-info-module", "timer");
      await shot(pages[1], "05-timer-done-b");
      await orb(pages[0]).click();
      await expect(orb(pages[0])).toHaveAttribute("data-orb-dial", "closed");
      for (const page of pages) await expect(readout(page)).not.toHaveAttribute("data-nova-orb-info-module", "timer", { timeout: 8_000 });
      await shot(pages[1], "06-after-dismiss-b");
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test("a due reminder dismissed on one screen clears on the other through the real server", async ({ browser }) => {
    seedTasks([{ id: "bins", name: "Bins", start: new Date(Date.now() - 60_000).toISOString(), createdAt: new Date().toISOString(), source: "local" }]);
    const backend = backendFor(Date.now(), null);
    backend.entries.push({ id: "due", moduleId: "reminders-overdue", enabled: true, showOnlyWhenAlerting: true });
    const unsubscribe = realTaskEvents(backend);
    const { contexts, pages } = await twoPages(browser, backend);
    try {
      for (const page of pages) await expect(readout(page)).toHaveAttribute("data-nova-orb-info-module", "reminders-overdue");
      await orb(pages[1]).click();
      for (const page of pages) await expect(readout(page)).not.toHaveAttribute("data-nova-orb-info-module", "reminders-overdue", { timeout: 8_000 });
    } finally {
      unsubscribe();
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test("a completed wash dismissed on one screen clears and silences the other", async ({ browser }) => {
    seedTasks([{ id: "wash-done", name: "Washing machine", start: new Date(Date.now() - 20_000).toISOString(), createdAt: new Date().toISOString(), source: "local",
      moduleData: { "washing-machine": { sessionId: "s1", phase: "active", soundFile: "chime.mp3" }, "discord-bot": { onDue: false, onComplete: false } } }]);
    const backend = backendFor(Date.now(), null);
    backend.entries = [{ id: "wash", moduleId: "washing", enabled: true }, { id: "clock", moduleId: "clock", enabled: true }];
    const unsubscribe = realTaskEvents(backend);
    const { contexts, pages } = await twoPages(browser, backend);
    try {
      for (const page of pages) await expect(readout(page)).toHaveAttribute("data-nova-orb-info-module", "washing");
      // One screen claims this chime slot server-side and plays it.
      const played = async (index: number) => (await media(pages[index])).some((entry) => entry.action === "play" && entry.src.includes("wash-done"));
      const playingIndex = async () => (await played(0) ? 0 : (await played(1) ? 1 : -1));
      await expect.poll(playingIndex, { timeout: 20_000 }).toBeGreaterThanOrEqual(0);
      const playing = await playingIndex();
      const other = pages[1 - playing];
      // Not asserted: that only one screen ever plays. The claim is per 30 s
      // chime slot, so a slot boundary crossing mid-test legitimately lets the
      // other screen claim the next one.
      // Dismiss on the screen that is NOT playing: the playing one must stop.
      await orb(other).click();
      for (const page of pages) await expect(readout(page)).not.toHaveAttribute("data-nova-orb-info-module", "washing", { timeout: 8_000 });
      await expect.poll(async () => (await media(pages[playing])).some((entry) => entry.action === "pause" && entry.src.includes("wash-done")), { timeout: 3_000 }).toBe(true);
      expect((await readTasks()).find((task) => task.id === "wash-done")?.alertDismissedAt).toBeTruthy();
    } finally {
      unsubscribe();
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
});
