import { NextResponse } from "next/server";
import { mergeDashboardPreferences, readDashboardPreferences } from "../../../lib/preferences";
import type { DashboardPreferences } from "../../../lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Named whole-house modes.
 *
 * A mode is a house-wide behaviour switch rather than a device action, so it
 * does not belong in `/api/entity` or `/api/zone`: there is no entity to name
 * and nothing in Home Assistant to call. House Party, for instance, is a
 * persisted dashboard preference the visualiser reads — the lease-based
 * `/api/phonoscope/house-party/session` routes are its frame plumbing, not its
 * on/off switch.
 *
 * The allowlist is deliberate. This endpoint is reachable by voice, and an
 * open-ended "set any preference" surface is not something the interpreter
 * should be able to reach.
 */
const MODES = {
  "house-party": {
    read: (preferences: DashboardPreferences) =>
      preferences.phonoscope?.houseParty?.enabled === true,
    // The two colour-behaviour modes beside `enabled` belong to the House
    // Party editor, not to this switch, so they are carried through from what
    // is already stored rather than reasserted here.
    write: (enabled: boolean, preferences: DashboardPreferences): DashboardPreferences => ({
      phonoscope: {
        houseParty: {
          hueMode: "follow",
          brightnessMode: "follow",
          ...(preferences.phonoscope?.houseParty ?? {}),
          enabled,
        },
      },
    }),
  },
} as const;

export type ModeName = keyof typeof MODES;

function isModeName(value: unknown): value is ModeName {
  return typeof value === "string" && value in MODES;
}

export async function GET() {
  const preferences = await readDashboardPreferences();
  const modes = Object.fromEntries(
    Object.entries(MODES).map(([name, mode]) => [name, mode.read(preferences)]),
  );
  return NextResponse.json({ modes });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Expected a mode request object" }, { status: 400 });
  }
  const source = body as Record<string, unknown>;
  if (!isModeName(source.mode)) {
    return NextResponse.json(
      { error: `Unknown mode. Known modes: ${Object.keys(MODES).join(", ")}` },
      { status: 400 },
    );
  }
  if (typeof source.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });
  }
  const mode = MODES[source.mode];
  await mergeDashboardPreferences(mode.write(source.enabled, await readDashboardPreferences()));
  // Read back rather than echoing the request: the caller — including the
  // voice provider's verification — needs the state that actually landed.
  return NextResponse.json({
    mode: source.mode,
    enabled: mode.read(await readDashboardPreferences()),
  });
}
