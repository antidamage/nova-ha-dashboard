import { NextResponse } from "next/server";
import { checkGitHubForUpdate, getUpdateStatus } from "../../../../lib/update";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await checkGitHubForUpdate();
    return NextResponse.json(await getUpdateStatus());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to check for updates" },
      { status: 500 },
    );
  }
}
