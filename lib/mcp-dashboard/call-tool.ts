// Tool and resource dispatch: each MCP tool name mapped onto the dashboard's
// config, Home Assistant and task operations.
import { buildDashboardState, haRest, setEntityAction, setZoneAction } from "../ha";
import { dashboardModuleStatuses } from "../state";
import { scaffoldDashboardConfig } from "../config-scaffold";
import { indexRegistry, readRegistrySnapshot } from "../ha/registry";
import {
  dashboardConfigJsonSchema,
  dryRunDashboardConfigImport,
  exportDashboardConfig,
  patchDashboardConfig,
  readDashboardConfig,
  readSecretSetupStatus,
  writeDashboardConfig,
} from "../dashboard-config";
import { addTask, deleteTasks, readTasks, updateTask } from "../tasks";
import type { HaDomain, HaState } from "../types";
import { argsFrom, assertConfirmed, idsFrom, rgbTuple, textResult, updatePatchFrom } from "./args-model";

async function dashboardHealth() {
  const [config, secrets, tasksResult, stateResult] = await Promise.allSettled([
    exportDashboardConfig(),
    readSecretSetupStatus(),
    readTasks(),
    buildDashboardState(),
  ]);

  return {
    config: config.status === "fulfilled" ? { ok: true, schemaVersion: config.value.schemaVersion } : { ok: false, error: config.reason?.message },
    homeAssistant: stateResult.status === "fulfilled"
      ? { ok: true, generatedAt: stateResult.value.generatedAt, zones: stateResult.value.zones.length, entities: stateResult.value.entities.length }
      : { ok: false, error: stateResult.reason?.message ?? "State read failed" },
    secrets: secrets.status === "fulfilled" ? secrets.value : null,
    tasks: tasksResult.status === "fulfilled" ? { ok: true, count: tasksResult.value.length } : { ok: false, error: tasksResult.reason?.message },
  };
}

async function discoverHa(args: Record<string, unknown>) {
  const [states, registry] = await Promise.all([haRest<HaState[]>("/api/states"), readRegistrySnapshot()]);
  const index = indexRegistry(registry);
  const domains = new Set(Array.isArray(args.domains) ? args.domains.map(String) : []);
  const search = String(args.search ?? "").trim().toLowerCase();
  const limit = Math.max(1, Math.min(500, Math.round(Number(args.limit ?? 120))));

  return {
    // Areas, including HA-native sensor bindings the dashboard reads directly.
    areas: registry.areas.map((area) => ({
      id: area.id,
      name: area.name,
      temperature_entity_id: area.temperature_entity_id ?? null,
      humidity_entity_id: area.humidity_entity_id ?? null,
    })),
    labels: registry.labels.map((label) => ({ id: label.label_id, name: label.name })),
    entities: states
      .filter((state) => !domains.size || domains.has(state.entity_id.split(".")[0]))
      .filter((state) => {
        if (!search) {
          return true;
        }
        const friendlyName = typeof state.attributes.friendly_name === "string" ? state.attributes.friendly_name : "";
        return `${state.entity_id} ${friendlyName}`.toLowerCase().includes(search);
      })
      .slice(0, limit)
      .map((state) => {
        const reg = index.entityById.get(state.entity_id);
        const device = reg?.device_id ? index.deviceById.get(reg.device_id) : undefined;
        return {
          entity_id: state.entity_id,
          state: state.state,
          friendly_name: state.attributes.friendly_name ?? null,
          device_class: state.attributes.device_class ?? null,
          unit_of_measurement: state.attributes.unit_of_measurement ?? null,
          area_id: reg?.area_id ?? device?.area_id ?? null,
          entity_category: reg?.entity_category ?? null,
          labels: reg?.labels ?? [],
        };
      }),
  };
}

export async function callTool(name: string, args: Record<string, unknown>) {
  const config = await readDashboardConfig();

  if (name === "nova.config.get" || name === "nova.config.export") {
    return textResult({ config: await exportDashboardConfig() });
  }
  if (name === "nova.config.schema") {
    return textResult({ schema: dashboardConfigJsonSchema() });
  }
  if (name === "nova.config.validate") {
    return textResult(await dryRunDashboardConfigImport(args.config));
  }
  if (name === "nova.config.apply") {
    assertConfirmed(name, args, config);
    return textResult(await writeDashboardConfig(args.config));
  }
  if (name === "nova.config.scaffold") {
    return textResult(await scaffoldDashboardConfig());
  }
  if (name === "nova.config.patch") {
    assertConfirmed(name, args, config);
    return textResult(await patchDashboardConfig(args.patch));
  }
  if (name === "nova.setup.status") {
    return textResult(await readSecretSetupStatus());
  }
  if (name === "nova.dashboard.health") {
    return textResult(await dashboardHealth());
  }
  if (name === "nova.dashboard.state") {
    return textResult(await buildDashboardState());
  }
  if (name === "nova.modules.status") {
    return textResult({ modules: await dashboardModuleStatuses() });
  }
  if (name === "nova.ha.discover") {
    return textResult(await discoverHa(args));
  }
  if (name === "nova.zone.action") {
    assertConfirmed(name, args, config);
    return textResult(await setZoneAction({
      action: String(args.action ?? "") as "on" | "off" | "brightness" | "color" | "candlelight" | "white",
      brightnessPct: args.brightnessPct === undefined ? undefined : Number(args.brightnessPct),
      rgb: rgbTuple(args.rgb),
      zoneId: String(args.zoneId ?? ""),
    }));
  }
  if (name === "nova.entity.action") {
    assertConfirmed(name, args, config);
    return textResult(await setEntityAction({
      data: args.data && typeof args.data === "object" && !Array.isArray(args.data) ? args.data as Record<string, unknown> : {},
      domain: String(args.domain ?? "") as HaDomain,
      entityId: String(args.entityId ?? ""),
      service: String(args.service ?? ""),
    }));
  }
  if (name === "nova.tasks.list" || name === "nova_tasks_list") {
    return textResult({ tasks: await readTasks() });
  }
  if (name === "nova.tasks.listen" || name === "nova_tasks_listen") {
    return textResult({
      endpoint: "/api/tasks?command=listen",
      eventTypes: ["client-id", "tasks", "task-alert", "task-dismiss"],
    });
  }
  if (name === "nova.tasks.add" || name === "nova_tasks_add") {
    assertConfirmed(name, args, config);
    return textResult(await addTask({
      end: args.end,
      name: args.name,
      repeat: args.repeat,
      follows: args.follows,
      source: "local",
      start: args.start,
    }));
  }
  if (name === "nova.tasks.update" || name === "nova_tasks_update") {
    assertConfirmed(name, args, config);
    const id = String(args.id ?? "").trim();
    if (!id) {
      throw new Error("Task id is required");
    }
    return textResult(await updateTask(id, updatePatchFrom(args)));
  }
  if (name === "nova.tasks.remove" || name === "nova_tasks_remove") {
    assertConfirmed(name, args, config);
    const ids = idsFrom(args);
    if (!ids.length) {
      throw new Error("Task id is required");
    }
    await deleteTasks(ids);
    return textResult({ ok: true, removed: ids });
  }

  throw new Error(`Unknown tool: ${name}`);
}

export async function readResource(uri: string) {
  if (uri === "nova://dashboard/config/schema") {
    return { uri, mimeType: "application/schema+json", text: JSON.stringify(dashboardConfigJsonSchema(), null, 2) };
  }
  if (uri === "nova://dashboard/config/current") {
    return { uri, mimeType: "application/json", text: JSON.stringify(await exportDashboardConfig(), null, 2) };
  }
  if (uri === "nova://dashboard/setup/checklist") {
    return { uri, mimeType: "application/json", text: JSON.stringify(await readSecretSetupStatus(), null, 2) };
  }
  if (uri === "nova://dashboard/home-assistant/entities") {
    return { uri, mimeType: "application/json", text: JSON.stringify(await discoverHa({ limit: 300 }), null, 2) };
  }
  if (uri === "nova://dashboard/modules/status") {
    return { uri, mimeType: "application/json", text: JSON.stringify({ modules: await dashboardModuleStatuses() }, null, 2) };
  }
  throw new Error(`Unknown resource: ${uri}`);
}
