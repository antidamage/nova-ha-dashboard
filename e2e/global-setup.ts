// Warm the Next.js dev server before the suite runs. `next dev` compiles each
// route on its first request, and several parallel workers hitting an uncompiled
// route at once race long enough to trip navigation timeouts. Requesting the two
// routes the suite uses forces that compilation to happen once, up front.
const PORT = Number(process.env.NOVA_E2E_PORT ?? 3210);
const BASE = `http://127.0.0.1:${PORT}`;

async function warm(path: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(BASE + path);
      if (response.ok) {
        await response.text();
        return;
      }
    } catch {
      // Server not ready yet; fall through to the delay and retry.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out warming ${path}`);
}

export default async function globalSetup() {
  await warm("/");
  await warm("/config/");
}
