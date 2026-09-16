"use client";

import type { DashboardZone } from "../../../../lib/types";

export const STEP_EPSILON = 0.0001;
export const LOUNGE_ZONE_ID = "lounge";
export const TASKS_ZONE_ID = "tasks";
export const POWER_ZONE_ID = "power";
export const WORLD_ZONE_ID = "world";
export const VOICE_ZONE_ID = "voice";
export const POWER_ZONE: DashboardZone = {
  id: POWER_ZONE_ID,
  name: "Grid",
  entities: [],
  counts: {
    light: 0,
    switch: 0,
    climate: 0,
    fan: 0,
    cover: 0,
    humidifier: 0,
    sensor: 0,
  },
  isOn: false,
  brightnessPct: 0,
  special: "power",
};
export const TASKS_ZONE: DashboardZone = {
  id: TASKS_ZONE_ID,
  name: "Reminders",
  entities: [],
  counts: {
    light: 0,
    switch: 0,
    climate: 0,
    fan: 0,
    cover: 0,
    humidifier: 0,
    sensor: 0,
  },
  isOn: false,
  brightnessPct: 0,
  special: "tasks",
};
export const WORLD_ZONE: DashboardZone = {
  id: WORLD_ZONE_ID,
  name: "World",
  entities: [],
  counts: {
    light: 0,
    switch: 0,
    climate: 0,
    fan: 0,
    cover: 0,
    humidifier: 0,
    sensor: 0,
  },
  isOn: false,
  brightnessPct: 0,
  special: "world",
};
export const VOICE_ZONE: DashboardZone = {
  id: VOICE_ZONE_ID,
  name: "Voice",
  entities: [],
  counts: {
    light: 0,
    switch: 0,
    climate: 0,
    fan: 0,
    cover: 0,
    humidifier: 0,
    sensor: 0,
  },
  isOn: false,
  brightnessPct: 0,
  special: "voice",
};
