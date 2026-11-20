import { readDashboardConfig } from "../../../lib/dashboard-config";
import { homeUsers } from "../../../lib/home-users/model";
import { homeIdsOf, readPresence } from "../../../lib/presence/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/home-users — the home users and who is home, for the identity
 * chooser, which mounts before any dashboard state exists. Reads config and the
 * presence file only, never Home Assistant. See specs/home-users.md.
 */
export async function GET() {
  const [config, presence] = await Promise.all([readDashboardConfig(), readPresence()]);
  const home = homeIdsOf(presence);
  const users = homeUsers(config.dashboard.people).map((person) => ({
    id: person.id,
    label: person.label,
    color: person.color,
    home: home.has(person.id),
    changedAt: presence.members[person.id]?.changedAt ?? null,
  }));
  return Response.json({ users }, { headers: { "Cache-Control": "no-store" } });
}
