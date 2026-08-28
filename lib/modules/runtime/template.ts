import type { ModuleEvent } from "./types";

/**
 * Message templates (`specs/module-system.md` §5).
 *
 * Rendering lives here rather than in each module so every module's messages
 * behave the same way — most importantly, so `{at}` always means the time the
 * event happened.
 */

const PLACEHOLDER = /\{([a-zA-Z0-9_.]+)\}/g;

const warned = new Set<string>();

function readPath(source: unknown, dotted: string): unknown {
  let current = source;
  for (const key of dotted.split(".")) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleTimeString("en-NZ", { hour12: false });
}

/** The convenience aliases, so a template does not have to know the envelope. */
function alias(event: ModuleEvent, key: string): unknown {
  switch (key) {
    case "entity":
      return event.entity?.friendlyName ?? event.entity?.id;
    case "state":
      return event.entity?.state;
    case "previousState":
      return event.entity?.previousState;
    case "target":
      return event.target;
    case "zone":
      return event.zone?.name ?? event.zone?.id;
    case "reminder":
      return event.task?.name;
    case "trigger":
      return event.trigger;
    case "reason":
      return event.reason;
    case "at":
      return formatTime(event.at);
    default:
      return undefined;
  }
}

/**
 * Render a template against an event. An unresolved placeholder becomes the
 * empty string and is logged once per template per process — not once per
 * event, which on a busy hook would be a log flood rather than a signal.
 */
export function renderTemplate(template: string, event: ModuleEvent): string {
  if (!template.trim()) {
    return "";
  }
  return template
    .replace(PLACEHOLDER, (match, key: string) => {
      const value = alias(event, key) ?? readPath(event, key);
      if (value === undefined || value === null || value === "") {
        const warnKey = `${template}::${key}`;
        if (!warned.has(warnKey)) {
          warned.add(warnKey);
          console.warn(`[nova-modules] template placeholder ${match} did not resolve`);
        }
        return "";
      }
      return String(value);
    })
    // Collapse the gaps an empty placeholder leaves behind, so
    // "{entity} turned on to {target}" with no target reads cleanly.
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
