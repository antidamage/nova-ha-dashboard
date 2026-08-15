import type { HaState } from "./types";
import { haRest } from "./ha/client";
import { readRegistrySnapshot } from "./ha/registry";
import { DEFAULT_ILLUMINATION_RE } from "./ha/entities";

export type ConfigScaffold = {
  /** A partial config the agent can review, adjust, then apply via nova.config.patch. */
  proposal: Record<string, unknown>;
  /** What was auto-detected from Home Assistant. */
  detected: Record<string, unknown>;
  /** Plain-language suggestions, including HA-side changes (labels, area bindings). */
  suggestions: string[];
};

function firstEntityOfDomain(states: HaState[], domain: string): string | undefined {
  return states.find((state) => state.entity_id.startsWith(`${domain}.`))?.entity_id;
}

function matchRouterSensor(states: HaState[], keywords: string[]): string | undefined {
  return states.find((state) => {
    if (!state.entity_id.startsWith("sensor.") && !state.entity_id.startsWith("binary_sensor.")) return false;
    const text = `${state.entity_id} ${state.attributes.friendly_name ?? ""}`.toLowerCase();
    return keywords.every((keyword) => text.includes(keyword));
  })?.entity_id;
}

/**
 * Inspect the live Home Assistant instance and propose a starting config. The
 * agent reviews this, fills the gaps, then applies it — far safer than hand
 * writing the whole config object.
 */
export async function scaffoldDashboardConfig(): Promise<ConfigScaffold> {
  const [states, registry] = await Promise.all([haRest<HaState[]>("/api/states"), readRegistrySnapshot()]);
  const suggestions: string[] = [];

  const areaNames = registry.areas.map((area) => ({
    id: area.id,
    name: area.name,
    hasTemperatureBinding: Boolean(area.temperature_entity_id),
    hasHumidityBinding: Boolean(area.humidity_entity_id),
  }));

  const climateAreaNames = registry.areas
    .map((area) => String(area.name).toLowerCase())
    .filter((name) => name === "climate" || name === "heating");

  const networkArea = registry.areas.find((area) => String(area.name).toLowerCase() === "network");

  const weatherEntityId = firstEntityOfDomain(states, "weather");
  const sunEntityId = firstEntityOfDomain(states, "sun");
  const assistSatellite = firstEntityOfDomain(states, "assist_satellite");

  const router = {
    wanStatusEntityId: matchRouterSensor(states, ["wan"]),
    externalIpEntityId: matchRouterSensor(states, ["external", "ip"]),
    downloadSpeedEntityId: matchRouterSensor(states, ["download"]) ?? matchRouterSensor(states, ["rx"]),
    uploadSpeedEntityId: matchRouterSensor(states, ["upload"]) ?? matchRouterSensor(states, ["tx"]),
  };

  // Switches that look like lights but aren't labelled — suggest the HA-side fix.
  const illuminationCandidates = states
    .filter((state) => state.entity_id.startsWith("switch."))
    .filter((state) => {
      const reg = registry.entities.find((entity) => entity.entity_id === state.entity_id);
      const labelled = (reg?.labels ?? []).some((label) => label.toLowerCase().includes("illumination"));
      return !labelled && DEFAULT_ILLUMINATION_RE.test(`${state.attributes.friendly_name ?? ""} ${state.entity_id}`);
    })
    .map((state) => state.entity_id);

  if (illuminationCandidates.length) {
    suggestions.push(
      `In Home Assistant, add the "nova_illumination" label to these switches so they render as lights: ${illuminationCandidates.join(", ")}`,
    );
  }
  const areasWithoutBindings = areaNames.filter((area) => !area.hasTemperatureBinding && area.name.toLowerCase() !== "network");
  if (areasWithoutBindings.length) {
    suggestions.push(
      `For room environment panels, set each room area's temperature/humidity sensor in Home Assistant (Settings > Areas). Areas without a temperature binding: ${areasWithoutBindings.map((area) => area.name).join(", ")}`,
    );
  }
  if (!weatherEntityId) suggestions.push("No weather.* entity found — add a Weather integration in Home Assistant.");

  // Devices reachable both over the LAN and through a cloud bridge appear
  // twice. Pair them by looking for an MQTT identifier that ends with the same
  // id a `tuya_local`-style entry uses, and propose the prefix that produced it
  // rather than assuming any particular bridge.
  const localDeviceIds = new Set<string>();
  const cloudTwinPrefixes = new Set<string>();
  for (const device of registry.devices ?? []) {
    for (const pair of device.identifiers ?? []) {
      if (Array.isArray(pair) && pair.length >= 2 && String(pair[0]).endsWith("_local")) {
        localDeviceIds.add(String(pair[1]));
      }
    }
  }
  for (const device of registry.devices ?? []) {
    for (const pair of device.identifiers ?? []) {
      if (!Array.isArray(pair) || pair.length < 2 || String(pair[0]) !== "mqtt") continue;
      const identifier = String(pair[1]);
      for (const localId of localDeviceIds) {
        if (identifier.endsWith(localId) && identifier.length > localId.length) {
          cloudTwinPrefixes.add(identifier.slice(0, identifier.length - localId.length));
        }
      }
    }
  }
  if (cloudTwinPrefixes.size) {
    suggestions.push(
      `Devices appear both locally and via an MQTT bridge. Proposed ` +
        `homeAssistant.cloudTwinIdentifierPrefixes so each is shown once: ${[...cloudTwinPrefixes].join(", ")}`,
    );
  }

  // Power estimation cannot be detected: nothing in Home Assistant says what a
  // household pays or what a bulb draws.
  suggestions.push(
    "Power estimation stays off until you set power.rates.tariff (your plan's unit rates) and " +
      "power.deviceRatings (each device's watts). Until both exist the Power zone is not shown.",
  );

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const homeAssistant: Record<string, unknown> = {
    ...(weatherEntityId ? { weatherEntityId } : {}),
    ...(sunEntityId ? { sunEntityId } : {}),
    ...(climateAreaNames.length ? { climateAreaNames } : {}),
    ...(networkArea ? { networkZoneId: networkArea.id } : {}),
    ...(assistSatellite ? { novaAssistSatelliteEntityId: assistSatellite } : {}),
    ...(cloudTwinPrefixes.size ? { cloudTwinIdentifierPrefixes: [...cloudTwinPrefixes] } : {}),
    ...(Object.values(router).some(Boolean)
      ? {
          router: Object.fromEntries(Object.entries(router).filter(([, value]) => Boolean(value))),
        }
      : {}),
  };

  return {
    proposal: {
      homeAssistant,
      ...(timeZone ? { power: { timeZone } } : {}),
    },
    detected: {
      areas: areaNames,
      weatherEntities: states.filter((state) => state.entity_id.startsWith("weather.")).map((state) => state.entity_id),
      sunEntities: states.filter((state) => state.entity_id.startsWith("sun.")).map((state) => state.entity_id),
      assistSatellites: states.filter((state) => state.entity_id.startsWith("assist_satellite.")).map((state) => state.entity_id),
      illuminationCandidates,
      cloudTwinPrefixes: [...cloudTwinPrefixes],
      hostTimeZone: timeZone,
      labelsDefinedInHa: registry.labels.map((label) => label.label_id),
    },
    suggestions,
  };
}
