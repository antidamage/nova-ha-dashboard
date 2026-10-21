import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";

/**
 * The detector behind lib/no-household-data.test.ts: which files it scans, how
 * it lexes their string literals, and which shapes count as household data.
 * The waiver list stays in the test file. This helper is named *.fixtures.ts so
 * the scan skips it along with the tests, exactly as it skipped the detector
 * when it lived inside the test file.
 */

const ROOT = process.cwd();
const SCAN_DIRS = ["lib", "app"];

const ENTITY_DOMAINS = [
  "light", "switch", "sensor", "binary_sensor", "climate", "media_player",
  "button", "lock", "fan", "cover", "vacuum", "humidifier", "input_boolean",
  "input_number", "input_select", "device_tracker", "person", "camera",
  "scene", "script", "automation", "assist_satellite", "todo", "water_heater",
  "siren", "valve", "lawn_mower", "number", "select",
];

/**
 * `sun.sun` and `weather.*` are omitted from the domain list on purpose: they
 * are auto-detected product-wide bindings, not this home's devices.
 */
const ENTITY_ID_RE = new RegExp(`(?:^|[^a-z0-9_.])(${ENTITY_DOMAINS.join("|")})\\.[a-z0-9_]{2,}`);
const TIMEZONE_RE = /\b(?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_]+/;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const MAC_RE = /\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\b/i;

/**
 * Addresses that name no particular machine. Loopback, the unspecified address
 * and the broadcast address are protocol constants, not someone's house.
 */
const GENERIC_ADDRESSES = new Set(["127.0.0.1", "0.0.0.0", "255.255.255.255"]);

/**
 * Opaque identifiers that only mean anything in this one house.
 *
 * Third-party integration NAMES are deliberately absent. "Powershop", "Tapo"
 * and "iCloud" are product features in the same way the Home Assistant
 * integration list is; what must not ship is the account and tariff DATA behind
 * them, which the fresh-install test pins separately.
 */
const HOUSEHOLD_TOKENS = [
  "tuya_mobile",
  "nx620v",
  "c6780cad",
  "nova.local",
  "iridium",
  "nocturnium",
  "neptunium",
  "ununhexium",
];

function sourceFiles(dir: string): string[] {
  const absolute = path.join(ROOT, dir);
  let entries: string[];
  try {
    entries = readdirSync(absolute);
  } catch {
    return [];
  }

  const found: string[] = [];
  for (const entry of entries) {
    const full = path.join(absolute, entry);
    if (statSync(full).isDirectory()) {
      if (["node_modules", ".next", "test", "__snapshots__"].includes(entry)) continue;
      found.push(...sourceFiles(path.join(dir, entry)));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    // Tests and the fixtures helpers that tests import are not product source; a
    // fixture naming a sample entity id is test data, not this household's.
    if (/\.(test|spec|fixtures)\.tsx?$/.test(entry)) continue;
    found.push(path.join(dir, entry).split(path.sep).join("/"));
  }
  return found;
}

/**
 * Every quoted string in the file, without its delimiters.
 *
 * This walks the source rather than using a regex. A regex lexer treats the
 * apostrophe in a comment like "the lounge's sensor" as an opening quote and
 * then swallows everything up to the next one, hiding the real literals that
 * follow — which is exactly how the first version of this test silently passed
 * over four hard-coded entity ids.
 *
 * Comments are skipped on purpose. Only literals change behaviour, and flagging
 * prose would trip on every comment that explains why a config value exists,
 * which is the fastest way to get a rule like this muted.
 */
function stringLiterals(source: string): string[] {
  const literals: string[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    if (ch === "/" && source[i + 1] === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }

    if (ch === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i += 1;
      let value = "";
      while (i < source.length) {
        const current = source[i];
        if (current === "\\") {
          value += source[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (current === quote) {
          i += 1;
          break;
        }
        // An unterminated single/double quote means we mis-lexed something
        // (most likely a regex literal); give up on it rather than consuming
        // the rest of the file.
        if (quote !== "`" && current === "\n") break;
        value += current;
        i += 1;
      }
      literals.push(value);
      continue;
    }

    i += 1;
  }

  return literals;
}

/**
 * Drop `${...}` spans from a template literal. What is inside them is code, not
 * data: `${camera.brightness}` in an ffmpeg filter string is a property access
 * that happens to look exactly like a `camera.*` entity id.
 */
function withoutInterpolations(literal: string): string {
  let out = "";
  let depth = 0;
  for (let i = 0; i < literal.length; i += 1) {
    if (literal[i] === "$" && literal[i + 1] === "{") {
      depth += 1;
      i += 1;
      continue;
    }
    if (depth > 0) {
      if (literal[i] === "{") depth += 1;
      else if (literal[i] === "}") depth -= 1;
      continue;
    }
    out += literal[i];
  }
  return out;
}

function householdIpIn(text: string): boolean {
  const match = text.match(IPV4_RE);
  if (!match) return false;
  const address = match[0];
  if (GENERIC_ADDRESSES.has(address)) return false;
  // Reject version-like strings ("2.14.3.1") by requiring a plausible address.
  return address.split(".").every((octet) => Number(octet) <= 255);
}

export function violationsIn(rawLiteral: string): string | null {
  const literal = withoutInterpolations(rawLiteral);
  if (ENTITY_ID_RE.test(literal)) return "home-assistant entity id";
  if (TIMEZONE_RE.test(literal)) return "hard-coded timezone";
  if (MAC_RE.test(literal)) return "mac address";
  if (householdIpIn(literal)) return "ip address";
  const lower = literal.toLowerCase();
  for (const token of HOUSEHOLD_TOKENS) {
    if (lower.includes(token)) return `household token "${token}"`;
  }
  return null;
}

export type Finding = { file: string; literal: string; kind: string };

export function scan(): Finding[] {
  const findings: Finding[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of sourceFiles(dir)) {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      for (const literal of stringLiterals(source)) {
        const kind = violationsIn(literal);
        if (kind) findings.push({ file, literal, kind });
      }
    }
  }
  return findings;
}
