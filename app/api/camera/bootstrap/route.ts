import { readDashboardConfig } from "../../../../lib/dashboard-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Runtime camera-host bootstrap for the otherwise-prerendered root layout. */
export async function GET() {
  let host = "";
  try {
    const config = await readDashboardConfig();
    const raw = config.dashboard.camera?.outside?.videoHostUrl;
    host = typeof raw === "string" ? raw.trim().replace(/\/+$/, "") : "";
  } catch {
    // Same-origin fallback keeps the dashboard usable if config is temporarily
    // unreadable during an atomic write or recovery.
  }

  const json = JSON.stringify(host).replace(/</g, "\\u003c");
  return new Response(`window.__NOVA_VIDEO_HOST__=${json};`, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
