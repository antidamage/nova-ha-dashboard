import { readDashboardPreferences } from "../../../../lib/preferences";
import { activeDesignId, DEFAULT_DESIGN_ID } from "../../../../lib/design-preferences";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Pre-paint design bootstrap for the otherwise-prerendered root layout.
 *
 * A separate no-store route for the same reason the camera host has one: the
 * layout is prerendered, so a value read there would go stale the moment the
 * design changed. Loaded with a parser-blocking <script src>, this sets the
 * attribute before first paint, so the active design's scoped CSS applies from
 * the first frame (specs/design-modules.md).
 */
export async function GET() {
  let id = DEFAULT_DESIGN_ID;
  try {
    id = activeDesignId(await readDashboardPreferences());
  } catch {
    // Unreadable preferences (mid atomic write, recovery) must still paint a
    // dashboard; the default is always a valid design.
  }

  const json = JSON.stringify(id).replace(/</g, "\u003c");
  return new Response(
    `window.__NOVA_DESIGN__=${json};document.documentElement.setAttribute("data-nova-design",${json});`,
    {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}
