import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * SPEC.md §2, "Golden Rule: No Machine-Specific Code": nova-ha-dashboard is a
 * distributable product. A new user must be able to deploy it against their own
 * Home Assistant with no code changes and without inheriting this household's
 * devices, rooms, router, timezone or electricity account.
 *
 * The rule kept regressing because nothing enforced it — moving a value into
 * config does not remove it from source, and a hard-coded fallback next to a
 * config read puts it straight back. This test is the enforcement.
 *
 * It scans string literals in product source. Literals are what actually change
 * behaviour, and scanning them (rather than raw text) avoids false positives
 * like `number.toFixed`.
 *
 * WAIVERS BELOW ARE A RATCHET, NOT A PARKING SPACE. Every entry is a real
 * violation with the phase that removes it. A waiver that no longer matches
 * anything also fails, so the list cannot rot once the code is fixed.
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

type Waiver = {
  /** Repo-relative POSIX path. */
  file: string;
  /**
   * The exact literal content that matched, or `"*"` to waive the whole file.
   * Use `"*"` only where one root cause produces many matches, and say so.
   */
  literal: string;
  /** Why it is still here, and what removes it. */
  reason: string;
};

const WAIVERS: Waiver[] = [
  // -- Phase 5 removes these.
  {
    file: "lib/ha.ts",
    literal: "light.tuya_mobile_",
    reason: "Phase 5: becomes homeAssistant.classification.cloudTwinEntityPrefixes.",
  },
  {
    file: "lib/ha/twins.ts",
    literal: "tuya_mobile_",
    reason: "Phase 5: same cloud-twin prefix, read from config instead.",
  },
  {
    file: "lib/config-schema.ts",
    literal: "Pacific/Auckland",
    reason: "Phase 5: the shipped schema default becomes a neutral timezone.",
  },

  {
    file: "lib/modules/router/module.ts",
    literal: "sensor.nx620v_lte_current_rx_speed",
    reason: "Phase 5: router migration aids move to homeAssistant.router config.",
  },
  {
    file: "lib/modules/router/module.ts",
    literal: "sensor.nx620v_lte_current_tx_speed",
    reason: "Phase 5: router migration aids move to homeAssistant.router config.",
  },
  {
    file: "lib/modules/router/module.ts",
    literal: "sensor.nx620v_download_speed",
    reason: "Phase 5: router migration aids move to homeAssistant.router config.",
  },
  {
    file: "lib/modules/router/module.ts",
    literal: "sensor.nx620v_upload_speed",
    reason: "Phase 5: router migration aids move to homeAssistant.router config.",
  },
  {
    file: "app/components/dashboard/ClockPanel.tsx",
    literal: "Pacific/Auckland",
    reason: "Phase 5: clock reads the configured timezone.",
  },
  {
    file: "lib/icloud-sync.ts",
    literal: "Pacific/Auckland",
    reason: "Phase 5: iCloud sync reads the configured timezone.",
  },
];

/**
 * A systemic breach kept separate from WAIVERS so it stays legible.
 *
 * The voice, phonoscope and camera integrations name their host machines
 * directly — `iridium`, `nocturnium`, `nova.local` — across roughly 300
 * occurrences in ~40 files: symbol names, import paths, and operator-facing
 * copy like "Iridium unreachable". That is SPEC.md §2's breach in its purest
 * form, but it is one refactor (machine name to abstract role) rather than a
 * scattering of household values, and it touches visible UI copy.
 *
 * `lib/iridium-voice-settings.ts` has already been renamed to
 * `lib/voice-host-settings.ts`, which removed the import-path half of the
 * problem. The remainder is tracked as its own piece of work; these files are
 * waived ONLY for host-name tokens, so a stray entity id or IP in any of them
 * still fails.
 */
const HOST_NAMING_TOKENS = new Set(["iridium", "nocturnium", "neptunium", "ununhexium", "nova.local"]);
const HOST_NAMING_FILES = new Set([
  "lib/voice-host-settings.ts",
  "lib/voice-settings.ts",
  "app/api/phonoscope/renderer/route.ts",
  "app/api/voice/options/route.ts",
  "app/components/CameraConfig.tsx",
  "app/components/VoiceConfig.tsx",
  "app/components/VoiceInfrastructureConfig.tsx",
]);

function isHostNamingOnly(finding: Finding) {
  if (!HOST_NAMING_FILES.has(finding.file)) return false;
  return [...HOST_NAMING_TOKENS].some((token) => finding.kind.includes(token));
}

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
    if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
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

function violationsIn(rawLiteral: string): string | null {
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

type Finding = { file: string; literal: string; kind: string };

function scan(): Finding[] {
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

function isWaived(finding: Finding) {
  return WAIVERS.some(
    (waiver) => waiver.file === finding.file && (waiver.literal === "*" || waiver.literal === finding.literal),
  );
}

/** Long template literals make the failure report unreadable. */
function short(literal: string) {
  const flat = literal.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 80)}...` : flat;
}

describe("no household data in product source", () => {
  it("finds no unwaived household literal in lib/ or app/", () => {
    const unwaived = scan().filter((finding) => !isWaived(finding) && !isHostNamingOnly(finding));

    const report = unwaived
      .map((finding) => `  ${finding.file}: ${finding.kind} -> ${JSON.stringify(short(finding.literal))}`)
      .join("\n");

    expect(
      unwaived,
      unwaived.length
        ? `Household-specific values must live in config (or the nova-household package), ` +
            `not in dashboard source. See SPEC.md §2.\n${report}\n\n` +
            `If one of these is genuinely generic, refine the detector rather than waiving it.`
        : undefined,
    ).toEqual([]);
  });

  it("has no stale waiver, so the ratchet cannot rot", () => {
    const findings = scan();
    const stale = WAIVERS.filter((waiver) =>
      waiver.literal === "*"
        ? !findings.some((f) => f.file === waiver.file)
        : !findings.some((f) => f.file === waiver.file && f.literal === waiver.literal),
    );

    const report = stale.map((waiver) => `  ${waiver.file}: ${JSON.stringify(waiver.literal)}`).join("\n");

    expect(
      stale,
      stale.length ? `These waivers no longer match anything — delete them:\n${report}` : undefined,
    ).toEqual([]);
  });

  it("has no stale host-naming file, so that burn-down list cannot rot either", () => {
    const findings = scan();
    const stale = [...HOST_NAMING_FILES].filter(
      (file) => !findings.some((finding) => finding.file === file && isHostNamingOnly(finding)),
    );

    expect(
      stale,
      stale.length
        ? `These files no longer name a host machine — remove them from HOST_NAMING_FILES:\n${stale.map((f) => `  ${f}`).join("\n")}`
        : undefined,
    ).toEqual([]);
  });

  it("actually detects the shapes it claims to", () => {
    expect(violationsIn("light.bedroom_light")).toBe("home-assistant entity id");
    expect(violationsIn("Pacific/Auckland")).toBe("hard-coded timezone");
    expect(violationsIn("192.168.8.20")).toBe("ip address");
    expect(violationsIn("d0:73:d5:a1:52:6f")).toBe("mac address");
    expect(violationsIn("light.tuya_mobile_kitchen")).toBe("home-assistant entity id");
    expect(violationsIn("http://nocturnium.local:8080")).toContain("nocturnium");

    // Shapes that must NOT trip it, or the rule becomes noise people mute.
    expect(violationsIn("sun.sun")).toBeNull();
    expect(violationsIn("weather.forecast_home")).toBeNull();
    expect(violationsIn("2.14.3")).toBeNull();
    expect(violationsIn("hvac_modes")).toBeNull();
    expect(violationsIn("Mon")).toBeNull();
    expect(violationsIn("http://127.0.0.1:8123")).toBeNull();
    expect(violationsIn("255.255.255.255")).toBeNull();
    // Interpolated code that merely looks like an entity id.
    expect(violationsIn("eq=brightness=${camera.brightness}")).toBeNull();
    expect(violationsIn("${camera.id}-${stamp}.ts")).toBeNull();
    // A third-party integration NAME is a product feature, not household data.
    expect(violationsIn("powershop")).toBeNull();
  });
});
