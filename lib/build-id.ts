import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function readDashboardBuildId() {
  try {
    return (await readFile(join(process.cwd(), ".next", "BUILD_ID"), "utf8")).trim();
  } catch {
    return process.env.NOVA_DASHBOARD_BUILD_ID ?? "development";
  }
}
