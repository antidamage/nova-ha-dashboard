import { NextResponse } from "next/server";
import { dashboardConfigJsonSchema } from "../../../../lib/dashboard-config";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(dashboardConfigJsonSchema(), {
    headers: {
      "Content-Disposition": "attachment; filename=\"dashboard-config.schema.json\"",
    },
  });
}
