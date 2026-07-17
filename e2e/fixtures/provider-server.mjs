// Zero-dependency static file server for the nova-dummy-data-provider `public/`
// directory, used only by the Playwright E2E suite.
//
// In production the demo dashboard loads its dummy data provider from a separate
// origin (GitHub Pages), so the browser performs a cross-origin module import of
// `provider.mjs` and cross-origin fetches of `api/*.json`. We mirror that here by
// serving the provider on its own port with permissive CORS, so the E2E run
// exercises the same code path as the deployed demo rather than a same-origin
// shortcut.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.NOVA_DEMO_PROVIDER_PORT ?? 4174);
const HOST = process.env.NOVA_DEMO_PROVIDER_HOST ?? "127.0.0.1";
const ROOT = path.resolve(
  process.env.NOVA_DEMO_PROVIDER_ROOT ??
    path.join(here, "..", "..", "..", "nova-dummy-data-provider", "public"),
);

const CONTENT_TYPES = {
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  // Resolve the request path inside ROOT, rejecting traversal attempts.
  const requestPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const resolved = path.resolve(ROOT, relative);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
    res.writeHead(403, corsHeaders());
    res.end("Forbidden");
    return;
  }

  try {
    const info = await stat(resolved);
    const filePath = info.isDirectory() ? path.join(resolved, "index.html") : resolved;
    const body = await readFile(filePath);
    const type = CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, { ...corsHeaders(), "Content-Type": type, "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(404, { ...corsHeaders(), "Content-Type": "text/plain" });
    res.end("Not found");
  }
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[demo-provider] serving ${ROOT} at http://${HOST}:${PORT}/`);
});
