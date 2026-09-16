// SSE framing and fan-out to connected dashboard and task clients.

import type { DashboardState, SpectrumCursor } from "../types";
import { encoder, store } from "./store";
import type { DashboardEventClient } from "./types";

export function dashboardStateSignature(state: DashboardState) {
  const { generatedAt: _generatedAt, ...snapshot } = state;
  return JSON.stringify(snapshot);
}

function clampCursor(cursor: SpectrumCursor) {
  return {
    x: Math.max(0, Math.min(1, Number(cursor.x))),
    y: Math.max(0, Math.min(1, Number(cursor.y))),
  };
}

export function rememberSpectrumCursor(zoneId: string, cursor?: SpectrumCursor) {
  if (!cursor || !Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) {
    return;
  }

  store.spectrumCursors[zoneId] = clampCursor(cursor);
}

export function withDashboardEventMetadata(state: DashboardState): DashboardState {
  return {
    ...state,
    spectrumCursors: { ...store.spectrumCursors },
  };
}

export function sseEvent(event: string, data: string) {
  return `event: ${event}\ndata: ${data.replace(/\n/g, "\ndata: ")}\n\n`;
}

export function sendClient(client: DashboardEventClient, chunk: string) {
  try {
    client.controller.enqueue(encoder.encode(chunk));
  } catch {
    store.clients.delete(client);
    store.taskClients.delete(client);
  }
}

export function broadcast(chunk: string, options: { excludeClientId?: number | null } = {}) {
  for (const client of store.clients) {
    if (options.excludeClientId && client.id === options.excludeClientId) {
      continue;
    }

    sendClient(client, chunk);
  }
}

export function broadcastTask(chunk: string) {
  broadcast(chunk);
  for (const client of store.taskClients) {
    sendClient(client, chunk);
  }
}
