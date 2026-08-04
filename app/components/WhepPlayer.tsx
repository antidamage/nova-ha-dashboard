"use client";

import { useEffect, useRef, useState } from "react";

// Low-latency player for the visualiser's browser rung.
//
// WHEP first: MediaMTX republishes the renderer's H.264 feed over WebRTC, which
// lands in about 200 ms and — unlike the camera panel's HLS — needs no
// rate-nudging or live-edge seeking to stay current. LL-HLS is the fallback for
// anything that cannot negotiate WebRTC.
//
// This is deliberately not `CameraPanel`: that player is a DVR with a scrubber,
// snapshots and a deliberate 6 s latency target. Here latency IS the thing being
// diagnosed, so there are no controls and nothing buffers on purpose.

export type WhepStats = {
  transport: "whep" | "hls" | "connecting" | "failed";
  framesPerSecond?: number;
  framesDecoded?: number;
  framesDropped?: number;
  packetsLost?: number;
  nackCount?: number;
  pliCount?: number;
  jitterMs?: number;
  jitterBufferMs?: number;
  kilobitsPerSecond?: number;
  width?: number;
  height?: number;
};

type Props = {
  whepUrl: string;
  hlsUrl: string;
  onStats?: (stats: WhepStats) => void;
};

export default function WhepPlayer({ whepUrl, hlsUrl, onStats }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [message, setMessage] = useState<string>("connecting");
  // Held in a ref so the effect below never re-runs when the callback identity
  // changes; a reconnect on every parent render would defeat the point.
  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let peer: RTCPeerConnection | null = null;
    let hls: { destroy: () => void } | null = null;
    let statsTimer: ReturnType<typeof setInterval> | null = null;
    // Previous cumulative counters, for per-interval rates.
    let previousBytes = 0;
    let previousAt = 0;

    const report = (stats: WhepStats) => {
      if (!cancelled) onStatsRef.current?.(stats);
    };

    async function attachHls(reason: string) {
      if (cancelled) return;
      setMessage(`WHEP unavailable (${reason}) — falling back to LL-HLS`);
      report({ transport: "hls" });

      // Safari plays HLS natively and does it better than hls.js can.
      if (video!.canPlayType("application/vnd.apple.mpegurl")) {
        video!.src = hlsUrl;
        void video!.play().catch(() => undefined);
        return;
      }
      try {
        const { default: Hls } = await import("hls.js");
        if (cancelled) return;
        if (!Hls.isSupported()) {
          setMessage("neither WebRTC nor HLS is available in this browser");
          report({ transport: "failed" });
          return;
        }
        // Tuned for the live edge, not for the camera panel's DVR behaviour.
        const instance = new Hls({ lowLatencyMode: true, backBufferLength: 4, maxBufferLength: 4 });
        hls = instance;
        instance.loadSource(hlsUrl);
        instance.attachMedia(video!);
        instance.on(Hls.Events.MANIFEST_PARSED, () => {
          void video!.play().catch(() => undefined);
        });
      } catch {
        if (!cancelled) {
          setMessage("HLS player failed to load");
          report({ transport: "failed" });
        }
      }
    }

    async function attachWhep() {
      try {
        const connection = new RTCPeerConnection({ iceServers: [] });
        peer = connection;
        connection.addTransceiver("video", { direction: "recvonly" });

        connection.ontrack = (event) => {
          if (cancelled) return;
          video!.srcObject = event.streams[0] ?? new MediaStream([event.track]);
          void video!.play().catch(() => undefined);
          setMessage("");
          report({ transport: "whep" });
        };

        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);

        // Wait for ICE gathering so the single POST carries every candidate.
        // MediaMTX is on the LAN with no STUN, so this settles almost at once;
        // the timeout only guards a browser that never fires the event.
        await new Promise<void>((resolve) => {
          if (connection.iceGatheringState === "complete") return resolve();
          const done = () => {
            if (connection.iceGatheringState === "complete") {
              connection.removeEventListener("icegatheringstatechange", done);
              resolve();
            }
          };
          connection.addEventListener("icegatheringstatechange", done);
          setTimeout(resolve, 1_500);
        });

        const response = await fetch(whepUrl, {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: connection.localDescription?.sdp ?? offer.sdp ?? "",
        });
        if (!response.ok) throw new Error(`WHEP returned ${response.status}`);
        const answer = await response.text();
        if (cancelled) return;
        await connection.setRemoteDescription({ type: "answer", sdp: answer });

        statsTimer = setInterval(async () => {
          if (cancelled || !peer) return;
          const report_ = await peer.getStats();
          const next: WhepStats = { transport: "whep" };
          report_.forEach((entry) => {
            if (entry.type !== "inbound-rtp" || entry.kind !== "video") return;
            next.framesPerSecond = entry.framesPerSecond;
            next.framesDecoded = entry.framesDecoded;
            next.framesDropped = entry.framesDropped;
            next.packetsLost = entry.packetsLost;
            next.nackCount = entry.nackCount;
            next.pliCount = entry.pliCount;
            next.jitterMs = typeof entry.jitter === "number" ? entry.jitter * 1000 : undefined;
            if (entry.jitterBufferDelay && entry.jitterBufferEmittedCount) {
              next.jitterBufferMs =
                (entry.jitterBufferDelay / entry.jitterBufferEmittedCount) * 1000;
            }
            next.width = entry.frameWidth;
            next.height = entry.frameHeight;

            const now = entry.timestamp as number;
            const bytes = entry.bytesReceived as number;
            if (previousAt > 0 && now > previousAt) {
              next.kilobitsPerSecond = ((bytes - previousBytes) * 8) / (now - previousAt);
            }
            previousBytes = bytes;
            previousAt = now;
          });
          report(next);
        }, 500);

        // A negotiated connection that never delivers a frame is the common
        // MediaMTX codec-mismatch symptom, so time it out rather than sitting
        // on a black rectangle.
        setTimeout(() => {
          if (!cancelled && !video!.srcObject) void attachHls("no track within 5 s");
        }, 5_000);
      } catch (error) {
        if (cancelled) return;
        void attachHls(error instanceof Error ? error.message : "negotiation failed");
      }
    }

    void attachWhep();

    return () => {
      cancelled = true;
      if (statsTimer) clearInterval(statsTimer);
      if (peer) peer.close();
      if (hls) hls.destroy();
      video.srcObject = null;
      video.removeAttribute("src");
      video.load();
    };
  }, [whepUrl, hlsUrl]);

  return (
    <>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
      />
      {message ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            color: "#7de3ff",
            font: "500 14px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
            pointerEvents: "none",
            textAlign: "center",
            padding: "0 24px",
          }}
        >
          {message}
        </div>
      ) : null}
    </>
  );
}
