// The active-notification snapshot sent to a newly connected dashboard client.

import { sendClient, sseEvent } from "./transport";
import type { DashboardEventClient } from "./types";

export async function sendNotificationsSnapshot(client: DashboardEventClient) {
  try {
    const { readNotifications } = await import("../notifications");
    sendClient(client, sseEvent("notifications", JSON.stringify({ notifications: await readNotifications() })));
  } catch (error) {
    // A missing banner is not worth a dashboard-error toast over everything else.
    console.error("[nova-dashboard] Failed to read notifications", { error });
  }
}
