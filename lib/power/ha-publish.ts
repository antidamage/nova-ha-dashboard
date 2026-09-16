// MQTT discovery and state publishing of the power sensors to Home Assistant.
import type { PowerDeviceRating } from "../config-schema";
import { readDashboardConfigSync } from "../dashboard-config";
import { callService } from "../ha";
import { round, slug } from "./numbers";
import { powerConfig, powerRuntime } from "./store";
import type { PowerDashboard } from "./types";

async function publishMqtt(topic: string, payload: unknown, retain = true) {
  await callService("mqtt", "publish", {
    payload: typeof payload === "string" ? payload : JSON.stringify(payload),
    qos: 0,
    retain,
    topic,
  });
}

function sensorDevice(rating?: PowerDeviceRating) {
  return {
    identifiers: [`nova_power_${rating?.id ?? "home"}`],
    manufacturer: rating?.manufacturer ?? "Nova",
    model: rating?.model ?? "Estimated power model",
    name: rating?.name ?? "Nova Grid",
  };
}

async function publishDiscovery(ratings: PowerDeviceRating[]) {
  const configs: Array<{ topic: string; payload: Record<string, unknown> }> = ratings.flatMap((rating) => {
    const id = slug(rating.id);
    const stateTopic = `nova/power/${id}/state`;
    const device = sensorDevice(rating);
    return [
      {
        topic: `homeassistant/sensor/nova_power_${id}_estimated_power/config`,
        payload: {
          device,
          device_class: "power",
          json_attributes_topic: stateTopic,
          name: `${rating.name} estimated power`,
          object_id: `nova_power_${id}_estimated_power`,
          state_class: "measurement",
          state_topic: stateTopic,
          unique_id: `nova_power_${id}_estimated_power`,
          unit_of_measurement: "W",
          value_template: "{{ value_json.watts }}",
        },
      },
      {
        topic: `homeassistant/sensor/nova_power_${id}_estimated_energy/config`,
        payload: {
          device,
          device_class: "energy",
          json_attributes_topic: stateTopic,
          name: `${rating.name} estimated energy`,
          object_id: `nova_power_${id}_estimated_energy`,
          state_class: "total_increasing",
          state_topic: stateTopic,
          unique_id: `nova_power_${id}_estimated_energy`,
          unit_of_measurement: "kWh",
          value_template: "{{ value_json.kwh_total }}",
        },
      },
      {
        topic: `homeassistant/sensor/nova_power_${id}_rated_power/config`,
        payload: {
          device,
          entity_category: "diagnostic",
          json_attributes_topic: stateTopic,
          name: `${rating.name} rated power`,
          object_id: `nova_power_${id}_rated_power`,
          state_topic: stateTopic,
          unique_id: `nova_power_${id}_rated_power`,
          unit_of_measurement: "W",
          value_template: "{{ value_json.rated_watts }}",
        },
      },
    ];
  });

  // The metering plugs' derived figures (specs/power-meters.md §6). The plugs'
  // own power/current/voltage sensors come from their integration and are not
  // republished here; these are the numbers only Nova knows.
  const power = powerConfig();
  const device = sensorDevice();
  if (power.washingMachine) {
    const people = readDashboardConfigSync().dashboard.people ?? [];
    const rows = [
      { key: "total", label: "Washing Machine month" },
      ...people.map((person) => ({ key: person.id, label: `Washing Machine month ${person.label}` })),
      { key: "unassigned", label: "Washing Machine month unassigned" },
    ];
    for (const row of rows) {
      const id = `washing_machine_month${row.key === "total" ? "" : `_${slug(row.key)}`}`;
      configs.push({
        topic: `homeassistant/sensor/nova_power_${id}_kwh/config`,
        payload: {
          device,
          device_class: "energy",
          json_attributes_topic: "nova/power/washing_machine/state",
          name: row.label,
          object_id: `nova_power_${id}_kwh`,
          // Calendar-month totals fall to zero on the 1st, so `total` rather
          // than `total_increasing`: a reset is a new month, not a meter swap.
          state_class: "total",
          state_topic: "nova/power/washing_machine/state",
          unique_id: `nova_power_${id}_kwh`,
          unit_of_measurement: "kWh",
          value_template: `{{ value_json.kwh['${row.key}'] | default(0) }}`,
        },
      });
    }
  }
  if (power.floatingMeter) {
    configs.push({
      topic: "homeassistant/sensor/nova_power_floating_meter_category/config",
      payload: {
        device,
        entity_category: "diagnostic",
        json_attributes_topic: "nova/power/floating_meter/state",
        name: "Floating Meter category",
        object_id: "nova_power_floating_meter_category",
        state_topic: "nova/power/floating_meter/state",
        unique_id: "nova_power_floating_meter_category",
        value_template: "{{ value_json.category }}",
      },
    });
    for (const category of power.floatingMeter.categories) {
      const id = `floating_${slug(category.id)}`;
      configs.push({
        topic: `homeassistant/sensor/nova_power_${id}_estimated_power/config`,
        payload: {
          device,
          device_class: "power",
          json_attributes_topic: "nova/power/floating_meter/state",
          name: `${category.label} estimated power`,
          object_id: `nova_power_${id}_estimated_power`,
          state_class: "measurement",
          state_topic: "nova/power/floating_meter/state",
          unique_id: `nova_power_${id}_estimated_power`,
          unit_of_measurement: "W",
          value_template: `{{ value_json.categories['${category.id}'] | default(0) }}`,
        },
      });
    }
  }

  configs.push({
    topic: "homeassistant/sensor/nova_power_home_estimated_power/config",
    payload: {
      device: sensorDevice(),
      device_class: "power",
      json_attributes_topic: "nova/power/home/state",
      name: "Nova Grid estimated power",
      object_id: "nova_power_home_estimated_power",
      state_class: "measurement",
      state_topic: "nova/power/home/state",
      unique_id: "nova_power_home_estimated_power",
      unit_of_measurement: "W",
      value_template: "{{ value_json.watts }}",
    },
  });

  await Promise.allSettled(configs.map((config) => publishMqtt(config.topic, config.payload)));
}

async function publishPowerState(summary: PowerDashboard, ratings: PowerDeviceRating[]) {
  const ratingById = new Map(ratings.map((rating) => [rating.id, rating]));
  await Promise.allSettled(
    summary.devices.map((device) => {
      const rating = ratingById.get(device.id);
      return publishMqtt(`nova/power/${slug(device.id)}/state`, {
        confidence: device.confidence,
        entity_id: device.entityId,
        kwh_total: round(device.kwhTotal, 4),
        rated_watts: device.ratedWatts,
        source: device.source,
        state: device.state,
        watts: device.watts,
        zone: device.zone,
        aliases: rating?.entityIds ?? [],
      });
    }),
  );
  if (summary.washingMachine) {
    const kwh: Record<string, number> = {
      total: round(summary.washingMachine.totals.reduce((sum, row) => sum + row.kwh, 0), 4),
    };
    const cost: Record<string, number> = {};
    for (const row of summary.washingMachine.totals) {
      const key = row.person ?? "unassigned";
      kwh[key] = round(row.kwh, 4);
      cost[key] = round(row.costNzd, 4);
    }
    await publishMqtt("nova/power/washing_machine/state", {
      cost_nzd: cost,
      cycles: summary.washingMachine.cycles.length,
      kwh,
      month: summary.washingMachine.monthKey,
      watts: summary.washingMachine.watts,
    });
  }
  if (summary.floatingMeter) {
    const categories: Record<string, number> = {};
    const confidence: Record<string, string> = {};
    for (const category of summary.floatingMeter.categories) {
      categories[category.id] = category.watts;
      confidence[category.id] = category.confidence;
    }
    const active = summary.floatingMeter.categories.find((category) => category.active);
    await publishMqtt("nova/power/floating_meter/state", {
      categories,
      category: active?.label ?? "unknown",
      category_id: summary.floatingMeter.activeCategoryId,
      confidence,
      watts: summary.floatingMeter.watts,
    });
  }
  await publishMqtt("nova/power/home/state", {
    cost_per_hour_nzd: summary.currentCostPerHourNzd,
    kwh_total: summary.totals.kwh,
    rate_c_per_kwh: summary.currentRate.cPerKwh,
    tariff_period: summary.currentRate.period,
    watts: summary.currentWatts,
  });
}

export async function maybePublishToHa(summary: PowerDashboard, ratings: PowerDeviceRating[]) {
  const now = Date.now();
  const timing = powerConfig().timing;
  if (now - powerRuntime.discoveryPublishedAt > timing.discoveryIntervalMs) {
    await publishDiscovery(ratings);
    powerRuntime.discoveryPublishedAt = now;
  }
  if (now - powerRuntime.haPublishedAt > timing.haPublishIntervalMs) {
    await publishPowerState(summary, ratings);
    powerRuntime.haPublishedAt = now;
  }
}
