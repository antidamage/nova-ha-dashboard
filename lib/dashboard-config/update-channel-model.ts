// The update channel — where the updater looks for a new version.
//
// These three keys are not settings. `/config` cannot edit them, and the
// runtime store merges above the household overlay, so allowing the store to
// hold them let one config save freeze the then-current shipped default and
// silently defeat every later household override. They are read from the
// shipped defaults and the household overlay only, and never persisted.
// See specs/self-update-channel.md.
import { isRecord, mergeDeep } from "./merge-model";
import type { DashboardConfig } from "../config-schema";

export const UPDATE_CHANNEL_KEYS = ["repo", "branch", "apiBase"] as const;

export function pickUpdateChannel(update: unknown): Record<string, unknown> {
  const channel: Record<string, unknown> = {};
  if (!isRecord(update)) {
    return channel;
  }
  for (const key of UPDATE_CHANNEL_KEYS) {
    if (key in update) {
      channel[key] = update[key];
    }
  }
  return channel;
}

/**
 * The channel as the shipped defaults and the household overlay resolve it,
 * ignoring every layer above them. Values are carried through unvalidated on
 * purpose: a malformed value in the household file has to fail validation out
 * loud, not be dropped in silence in favour of the shipped default.
 */
export function resolveUpdateChannel(defaults: unknown, household: unknown): Record<string, unknown> {
  const layered = mergeDeep(isRecord(defaults) ? defaults : {}, household);
  return pickUpdateChannel(layered.update);
}

/**
 * Put the channel back on top of a merge a higher layer may have overridden.
 * Needed even though the writer subtracts the channel, because an install that
 * saved its config before this rule existed still holds a copy in the store.
 */
export function pinUpdateChannel<T>(merged: T, channel: Record<string, unknown>): T {
  if (!isRecord(merged) || Object.keys(channel).length === 0) {
    return merged;
  }
  const update = { ...(isRecord(merged.update) ? merged.update : {}), ...channel };
  return { ...merged, update } as T;
}

/** Drop the channel keys from a document a caller supplied. */
export function withoutUpdateChannel(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.update)) {
    return value;
  }
  const update = { ...value.update };
  for (const key of UPDATE_CHANNEL_KEYS) {
    delete update[key];
  }
  return { ...value, update };
}

/**
 * The document the runtime store is allowed to hold. The channel is subtracted
 * rather than stored-and-ignored, so the file never claims a value the loader
 * will not use.
 */
export function runtimeStoreDocument(config: DashboardConfig): Record<string, unknown> {
  const document: Record<string, unknown> = { ...config };
  const update = { ...config.update } as Record<string, unknown>;
  for (const key of UPDATE_CHANNEL_KEYS) {
    delete update[key];
  }
  document.update = update;
  return document;
}
