import { NextResponse } from "next/server";
import { listPhonoscopeModules, readPhonoscopeConfig } from "../../../../lib/phonoscope-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const [config, modules] = await Promise.all([readPhonoscopeConfig(), listPhonoscopeModules()]);
  return NextResponse.json({
    active: `${config.activeModuleId}@${config.activeModuleVersion}`,
    installedModules: modules.length,
    providers: config.providers,
    runtime: {
      fps: null,
      simulationMs: null,
      propagationDeliveries: null,
      droppedEffects: null,
      roundTrips: null,
      note: "Live renderer diagnostics are local to the Apple TV in v1.",
    },
  });
}
