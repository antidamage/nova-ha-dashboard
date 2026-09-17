"use client";

/**
 * The settings group library — facade. The body lives beside this file; it
 * keeps the import path stable for its callers
 * (specs/agent-token-footprint.md §3.3).
 *
 * Where things are:
 *
 *   SettingsGroupCard.tsx    one settings group: name, static settings, lanes
 *   DriverLaneCard.tsx       one driver lane and its effect entries
 *   DriverLaneActions.tsx    a lane's header actions
 *   lane-commands.ts         the edits a card makes to its lanes
 *   settings-group-model.ts  new groups, new-lane drivers, lane lookups
 */
export { SettingsGroupCard } from "./SettingsGroupCard";
export { newSettingsGroup, unusedDriverType } from "./settings-group-model";
