import WebSocket from "ws";
import type { HaState } from "../../types";
import { HA_TOKEN, HA_URL } from "./connection";

export async function haWs<T>(
  type: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  if (!HA_TOKEN) {
    throw new Error("HA_TOKEN is not configured");
  }

  const wsUrl = `${HA_URL.replace(/^http/i, "ws")}/api/websocket`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const id = 1;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Timed out waiting for ${type}`));
    }, 10000);

    ws.on("message", (data) => {
      const message = JSON.parse(data.toString());

      if (message.type === "auth_required") {
        ws.send(JSON.stringify({ type: "auth", access_token: HA_TOKEN }));
        return;
      }

      if (message.type === "auth_invalid") {
        clearTimeout(timer);
        ws.close();
        reject(new Error("Home Assistant WebSocket auth failed"));
        return;
      }

      if (message.type === "auth_ok") {
        ws.send(JSON.stringify({ id, type, ...payload }));
        return;
      }

      if (message.id === id) {
        clearTimeout(timer);
        ws.close();
        if (message.success) {
          resolve(message.result as T);
        } else {
          reject(new Error(message.error?.message ?? `Home Assistant ${type} failed`));
        }
      }
    });

    ws.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export type HaStateChangeEvent = {
  contextId?: string;
  entityId: string;
  oldState?: HaState | null;
  newState?: HaState | null;
};

export function subscribeHaStateChanges(
  onChange: (entityId: string, change: HaStateChangeEvent) => void,
  onError?: (error: Error) => void,
) {
  if (!HA_TOKEN) {
    throw new Error("HA_TOKEN is not configured");
  }

  const wsUrl = `${HA_URL.replace(/^http/i, "ws")}/api/websocket`;
  const ws = new WebSocket(wsUrl);
  const subscriptionId = 1;
  let closed = false;
  let notified = false;

  // Fire onError at most once per subscription so the caller's reconnect logic
  // schedules exactly one retry, whether the failure arrives as an error, an
  // auth/subscription rejection, or a plain socket close (HA restart).
  const notifyError = (error: Error) => {
    if (notified || closed) {
      return;
    }
    notified = true;
    onError?.(error);
  };

  ws.on("message", (data) => {
    let message: {
      event?: {
        context?: { id?: unknown };
        data?: {
          entity_id?: unknown;
          old_state?: HaState | null;
          new_state?: HaState | null;
        };
      };
      id?: number;
      success?: boolean;
      type?: string;
      error?: { message?: string };
    };

    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (message.type === "auth_required") {
      ws.send(JSON.stringify({ type: "auth", access_token: HA_TOKEN }));
      return;
    }

    if (message.type === "auth_invalid") {
      notifyError(new Error("Home Assistant WebSocket auth failed"));
      ws.close();
      return;
    }

    if (message.type === "auth_ok") {
      ws.send(JSON.stringify({ id: subscriptionId, type: "subscribe_events", event_type: "state_changed" }));
      return;
    }

    if (message.id === subscriptionId && message.type === "result" && message.success === false) {
      notifyError(new Error(message.error?.message ?? "Home Assistant state_changed subscription failed"));
      ws.close();
      return;
    }

    if (message.type === "event") {
      const entityId = message.event?.data?.entity_id;
      if (typeof entityId === "string") {
        const contextId = message.event?.context?.id;
        onChange(entityId, {
          entityId,
          ...(typeof contextId === "string" ? { contextId } : {}),
          oldState: message.event?.data?.old_state,
          newState: message.event?.data?.new_state,
        });
      }
    }
  });

  ws.on("error", (error) => {
    notifyError(error instanceof Error ? error : new Error(String(error)));
  });

  // A plain close (e.g. Home Assistant restarting) must also trigger the
  // caller's reconnect — otherwise push updates silently stop until the whole
  // process restarts.
  ws.on("close", () => {
    notifyError(new Error("Home Assistant WebSocket closed"));
  });

  return () => {
    if (closed) {
      return;
    }
    closed = true;
    ws.close();
  };
}
