#!/usr/bin/env node
// Capture a point-in-time snapshot of the live Home Assistant inputs and the
// deployed dashboard output, for use as a refactor regression oracle.
//
// Writes to test/fixtures/ha-snapshot/:
//   - states.json          raw GET /api/states
//   - area-registry.json   config/area_registry/list
//   - device-registry.json config/device_registry/list
//   - entity-registry.json config/entity_registry/list
//   - label-registry.json  config/label_registry/list (may be empty on old HA)
//   - dashboard-state.json live GET <dashboard>/api/state (the golden output)
//   - config.json          live GET <dashboard>/api/config (portable config)
//   - meta.json            capture timestamp + source hosts
//
// Secrets (HA_TOKEN) are never written to disk.

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
// Optional first CLI arg overrides the output dir (used when capturing on the
// nova host into a scratch dir before copying back).
const outDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repoRoot, "test", "fixtures", "ha-snapshot");

function loadEnvLocal() {
  const env = {};
  for (const file of [".env.local", ".env"]) {
    try {
      const text = readFileSync(path.join(repoRoot, file), "utf8");
      for (const line of text.split(/\r?\n/)) {
        const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
        if (match) env[match[1]] = match[2];
      }
    } catch {
      /* optional */
    }
  }
  return env;
}

const env = loadEnvLocal();
const HA_URL = process.env.HA_URL ?? env.HA_URL ?? "http://127.0.0.1:8123";
const HA_TOKEN = process.env.HA_TOKEN ?? env.HA_TOKEN;
// Deployed dashboard hostname: see PRIVATEREF.md#1.1.
const DASHBOARD_URL = process.env.DASHBOARD_URL ?? "http://dashboard-host.local";

if (!HA_TOKEN) {
  console.error("HA_TOKEN missing (set in .env.local or env). Aborting.");
  process.exit(1);
}

async function haRest(p) {
  const res = await fetch(`${HA_URL}${p}`, {
    headers: { Authorization: `Bearer ${HA_TOKEN}` },
  });
  if (!res.ok) throw new Error(`HA ${p} -> ${res.status}`);
  return res.json();
}

function haWs(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${HA_URL.replace(/^http/i, "ws")}/api/websocket`);
    const id = 1;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Timed out waiting for ${type}`));
    }, 15000);
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "auth_required") {
        ws.send(JSON.stringify({ type: "auth", access_token: HA_TOKEN }));
        return;
      }
      if (msg.type === "auth_invalid") {
        clearTimeout(timer);
        ws.close();
        reject(new Error("WS auth failed"));
        return;
      }
      if (msg.type === "auth_ok") {
        ws.send(JSON.stringify({ id, type, ...payload }));
        return;
      }
      if (msg.id === id) {
        clearTimeout(timer);
        ws.close();
        msg.success ? resolve(msg.result) : reject(new Error(msg.error?.message ?? `${type} failed`));
      }
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function tryFetchJson(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return { error: `${res.status}` };
    return await res.json();
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function tryWs(type) {
  try {
    return await haWs(type);
  } catch (err) {
    console.warn(`(warn) ${type}: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

function save(name, value) {
  writeFileSync(path.join(outDir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  const count = Array.isArray(value) ? `${value.length} items` : "object";
  console.log(`  wrote ${name} (${count})`);
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  console.log(`Capturing HA snapshot from ${HA_URL} and dashboard ${DASHBOARD_URL}`);

  const [states, areas, devices, entities, labels] = await Promise.all([
    haRest("/api/states"),
    tryWs("config/area_registry/list"),
    tryWs("config/device_registry/list"),
    tryWs("config/entity_registry/list"),
    tryWs("config/label_registry/list"),
  ]);

  save("states.json", states);
  save("area-registry.json", areas);
  save("device-registry.json", devices);
  save("entity-registry.json", entities);
  save("label-registry.json", labels);

  const dashboardState = await tryFetchJson(`${DASHBOARD_URL}/api/state`);
  save("dashboard-state.json", dashboardState);

  const config = await tryFetchJson(`${DASHBOARD_URL}/api/config`);
  save("config.json", config);

  save("meta.json", {
    capturedAt: new Date().toISOString(),
    haUrl: HA_URL,
    dashboardUrl: DASHBOARD_URL,
    counts: {
      states: states.length,
      areas: areas.length,
      devices: devices.length,
      entities: entities.length,
      labels: labels.length,
    },
  });

  console.log("Snapshot complete.");
}

main().catch((err) => {
  console.error("Snapshot failed:", err);
  process.exit(1);
});
