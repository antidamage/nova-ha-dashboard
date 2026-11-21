// Reading the viewer off a request (specs/private-reminders.md, section 2).
import { HOUSEHOLD_VIEWER, SYSTEM_VIEWER, type Viewer } from "./ownership";

export const VIEWER_COOKIE = "nova-viewer";
export const VIEWER_HEADER = "x-nova-viewer";

export type ClientViewerBinding = { userAgentContains: string; user: string };

export type ViewerSettings = {
  /** Ids of the current home users. */
  userIds: ReadonlySet<string>;
  /** A temporary bridge for clients that cannot say who they are (the Apple TV). */
  clientViewers?: readonly ClientViewerBinding[];
};

export type ViewerInputs = {
  cookie?: string | null;
  header?: string | null;
  userAgent?: string | null;
};

export function parseCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const raw = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/**
 * header `system` -> system. Otherwise the header or the cookie names the
 * viewer: `household`, or a home user's id (an unknown id reads as household). A
 * client that says nothing is matched against the device bindings, and
 * otherwise reads as household: unidentified clients fail closed.
 */
export function resolveViewer(inputs: ViewerInputs, settings: ViewerSettings): Viewer {
  const header = inputs.header?.trim() ?? "";
  if (header === "system") return SYSTEM_VIEWER;
  const stated = header || parseCookie(inputs.cookie, VIEWER_COOKIE)?.trim() || "";
  if (stated) {
    return stated !== "household" && settings.userIds.has(stated) ? { kind: "user", id: stated } : HOUSEHOLD_VIEWER;
  }
  const agent = (inputs.userAgent ?? "").toLowerCase();
  if (agent) {
    for (const binding of settings.clientViewers ?? []) {
      if (agent.includes(binding.userAgentContains.toLowerCase()) && settings.userIds.has(binding.user)) {
        return { kind: "user", id: binding.user };
      }
    }
  }
  return HOUSEHOLD_VIEWER;
}

export function viewerInputsFrom(headers: Headers): ViewerInputs {
  return {
    cookie: headers.get("cookie"),
    header: headers.get(VIEWER_HEADER),
    userAgent: headers.get("user-agent"),
  };
}