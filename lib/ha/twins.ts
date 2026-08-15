import type { DashboardEntity, DeviceRegistryEntry } from "../types";
import type { RegistrySnapshot } from "./registry";

// Tuya devices in this home are reachable two ways: a `tuya_local` config
// entry that talks to the device over the LAN, and a cloud twin published by
// the Tuya mobile MQTT bridge whose HA device carries the identifier
// `tuya_mobile_<devId>`. Both sides expose controls for the same physical
// device, so the dashboard must show exactly one: the LAN entity when it is
// alive, otherwise the cloud twin (device roamed to a new IP, rotated its
// local key, ...). Pairing is by Tuya device id, never by name.

/**
 * Which identifier prefixes mark a cloud twin is an installation detail — it
 * names whichever bridge that home runs — so it arrives as config rather than
 * being written here. No prefixes configured means no twins, and every device
 * passes through untouched.
 */
function cloudTwinId(identifier: string, prefixes: readonly string[]): string | null {
  for (const prefix of prefixes) {
    if (prefix && identifier.startsWith(prefix)) {
      return identifier.slice(prefix.length);
    }
  }
  return null;
}

function isUsable(entity: Pick<DashboardEntity, "state">): boolean {
  return entity.state !== "unavailable" && entity.state !== "unknown";
}

function identifierPairs(device: DeviceRegistryEntry): Array<[string, string]> {
  return (device.identifiers ?? []).flatMap((pair) =>
    Array.isArray(pair) && pair.length >= 2 ? [[String(pair[0]), String(pair[1])] as [string, string]] : [],
  );
}

/**
 * Remove the redundant half of every local/cloud twin pair, per domain:
 * a usable LAN entity hides its cloud twin; a dead LAN entity with a usable
 * cloud twin is hidden in its favour. Devices without a twin pass through.
 */
export function dedupeCloudTwins(
  entities: DashboardEntity[],
  snapshot: RegistrySnapshot,
  cloudTwinIdentifierPrefixes: readonly string[] = [],
): DashboardEntity[] {
  if (cloudTwinIdentifierPrefixes.length === 0) {
    return entities;
  }

  const localDeviceByTuyaId = new Map<string, string>();
  const cloudDeviceByTuyaId = new Map<string, string>();
  for (const device of snapshot.devices) {
    for (const [platform, id] of identifierPairs(device)) {
      if (platform === "tuya_local") {
        localDeviceByTuyaId.set(id, device.id);
      } else if (platform === "mqtt") {
        const twinId = cloudTwinId(id, cloudTwinIdentifierPrefixes);
        if (twinId !== null) {
          cloudDeviceByTuyaId.set(twinId, device.id);
        }
      }
    }
  }

  const pairs: Array<{ localDeviceId: string; cloudDeviceId: string }> = [];
  for (const [tuyaId, localDeviceId] of localDeviceByTuyaId) {
    const cloudDeviceId = cloudDeviceByTuyaId.get(tuyaId);
    if (cloudDeviceId) {
      pairs.push({ localDeviceId, cloudDeviceId });
    }
  }
  if (!pairs.length) {
    return entities;
  }

  const entitiesByDevice = new Map<string, DashboardEntity[]>();
  for (const entity of entities) {
    if (!entity.device_id) continue;
    const list = entitiesByDevice.get(entity.device_id);
    if (list) {
      list.push(entity);
    } else {
      entitiesByDevice.set(entity.device_id, [entity]);
    }
  }

  const dropIds = new Set<string>();
  for (const pair of pairs) {
    const locals = entitiesByDevice.get(pair.localDeviceId) ?? [];
    const clouds = entitiesByDevice.get(pair.cloudDeviceId) ?? [];
    const domains = new Set(clouds.map((entity) => entity.domain));
    for (const domain of domains) {
      const localSide = locals.filter((entity) => entity.domain === domain);
      const cloudSide = clouds.filter((entity) => entity.domain === domain);
      if (localSide.some(isUsable)) {
        for (const entity of cloudSide) dropIds.add(entity.entity_id);
      } else if (localSide.length && cloudSide.some(isUsable)) {
        for (const entity of localSide) dropIds.add(entity.entity_id);
      } else if (localSide.length) {
        // Both halves are dead: keep a single (local) tile rather than two.
        for (const entity of cloudSide) dropIds.add(entity.entity_id);
      }
      // No local entities at all: cloud-only device, leave it untouched.
    }
  }

  return dropIds.size ? entities.filter((entity) => !dropIds.has(entity.entity_id)) : entities;
}
