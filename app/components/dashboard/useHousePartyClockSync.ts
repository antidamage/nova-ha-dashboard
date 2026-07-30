"use client";

import { useEffect } from "react";

const HOUSE_PARTY_CLOCK_ENDPOINT = "/api/phonoscope/house-party/clock";
const HOUSE_PARTY_CLOCK_POLL_MS = 5_000;
export const HOUSE_PARTY_CLOCK_SYNC_EVENT = "nova-house-party-clock-sync";

export type HousePartyClockSnapshot = {
  active: boolean;
  serverNowMs: number;
  master: {
    trackKey: string | null;
    position: number;
    duration: number;
    playing: boolean;
    sampledAtMs: number;
    receivedAtMs: number;
  } | null;
};

export type HousePartyClockSync = {
  active: true;
  trackKey: string | null;
  positionAtReceipt: number;
  positionOffsetSeconds: number;
  roundTripMs: number;
  playing: boolean;
  duration: number;
  clientReceivedAtMs: number;
};

export function resolveHousePartyClockSync(
  snapshot: HousePartyClockSnapshot,
  clientStartedAtMs: number,
  clientReceivedAtMs: number,
): HousePartyClockSync | null {
  if (!snapshot.active || !snapshot.master) return null;
  const roundTripMs = Math.max(0, clientReceivedAtMs - clientStartedAtMs);
  const positionAtReceipt = Math.max(0, Math.min(
    snapshot.master.duration,
    snapshot.master.position + (snapshot.master.playing ? roundTripMs / 2_000 : 0),
  ));
  return {
    active: true,
    trackKey: snapshot.master.trackKey,
    positionAtReceipt,
    positionOffsetSeconds: positionAtReceipt - clientReceivedAtMs / 1_000,
    roundTripMs,
    playing: snapshot.master.playing,
    duration: snapshot.master.duration,
    clientReceivedAtMs,
  };
}

export function useHousePartyClockSync() {
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const startedAt = Date.now();
      try {
        const response = await fetch(HOUSE_PARTY_CLOCK_ENDPOINT, { cache: "no-store" });
        const receivedAt = Date.now();
        if (!response.ok) throw new Error(`House Party clock request failed: ${response.status}`);
        const snapshot = await response.json() as HousePartyClockSnapshot;
        const sync = resolveHousePartyClockSync(snapshot, startedAt, receivedAt);
        if (!cancelled) {
          window.dispatchEvent(new CustomEvent(HOUSE_PARTY_CLOCK_SYNC_EVENT, {
            detail: sync ?? { active: false, clientReceivedAtMs: receivedAt },
          }));
        }
      } catch {
        // Keep the previous offset through brief LAN interruptions. The next
        // five-second sample will replace it once Nova is reachable again.
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), HOUSE_PARTY_CLOCK_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);
}
