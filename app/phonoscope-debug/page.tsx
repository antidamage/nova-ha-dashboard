"use client";

import { useCallback, useEffect, useState } from "react";
import WhepPlayer, { type WhepStats } from "../components/WhepPlayer";

// Chrome-free view of what the GPU visualiser is actually rendering.
//
// Until this existed the only way to see the renderer's output was to stand in
// front of the television, which made "the stream looks wrong" impossible to
// diagnose against "the Apple TV is decoding it wrong". Same shell as
// /shader-test: fixed inset, black, no dashboard furniture.
//
// The overlay deliberately shows BOTH halves of the pipeline on one screen —
// client-side decode stats from getStats() and server-side render/encode stats
// from the renderer — because almost every question here is really "which side
// is the problem".
//
//   ?stats=0    hide the overlay entirely (for a clean visual comparison)

type RendererStatus = Record<string, unknown>;

type RendererEndpoint = {
  available: boolean;
  whepUrl: string;
  hlsUrl: string;
  status?: RendererStatus;
  error?: string;
};

const FULL_RATE_SECONDS = 120;

function formatNumber(value: unknown, digits = 1): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function formatBytes(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} MB`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} kB`;
  return `${value.toFixed(0)} B`;
}

export default function PhonoscopeDebugPage() {
  const [endpoint, setEndpoint] = useState<RendererEndpoint | null>(null);
  const [stats, setStats] = useState<WhepStats | null>(null);
  const [showStats, setShowStats] = useState(true);
  const [fullRateBusy, setFullRateBusy] = useState(false);

  useEffect(() => {
    setShowStats(new URLSearchParams(window.location.search).get("stats") !== "0");
  }, []);

  // Poll the renderer for the server half. Kept at 1 Hz: the control server is
  // single-connection and blocking, so this must stay polite.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/phonoscope/renderer", { cache: "no-store" });
        const payload = (await response.json()) as RendererEndpoint;
        if (!cancelled) setEndpoint(payload);
      } catch {
        if (!cancelled) setEndpoint((current) => current);
      }
    };
    void load();
    const timer = setInterval(load, 1_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const requestFullRate = useCallback(async (seconds: number) => {
    setFullRateBusy(true);
    try {
      await fetch("/api/phonoscope/renderer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "full-rate", payload: { seconds } }),
      });
    } finally {
      setFullRateBusy(false);
    }
  }, []);

  const status = endpoint?.status ?? {};
  const divisor = status.publishFrameDivisor;
  const fullRateRemaining = status.fullRateSecondsRemaining;
  const exitReason = status.fullRateLastExitReason;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", overflow: "hidden" }}>
      {endpoint ? (
        <WhepPlayer whepUrl={endpoint.whepUrl} hlsUrl={endpoint.hlsUrl} onStats={setStats} />
      ) : null}

      {showStats ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            padding: "12px 16px",
            display: "flex",
            gap: 28,
            color: "#cfe9f5",
            background: "linear-gradient(180deg, rgba(0,0,0,0.78), rgba(0,0,0,0))",
            font: "500 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace",
            maxWidth: "100%",
            flexWrap: "wrap",
          }}
        >
          <Column title="renderer">
            <Row label="ok" value={endpoint?.available ? String(status.ok ?? "—") : "unreachable"} />
            <Row label="fps" value={formatNumber(status.fps, 2)} />
            <Row label="render" value={`${formatNumber(status.renderMs, 2)} ms`} />
            <Row label="gpu" value={`${formatNumber(status.gpuMs, 2)} ms`} />
            <Row label="encode" value={`${formatNumber(status.encodeMs, 2)} ms`} />
            <Row label="sim" value={`${formatNumber(status.simulationMs, 2)} ms`} />
          </Column>

          <Column title="pacing">
            <Row label="interval p99" value={`${formatNumber(status.frameIntervalP99Ms, 2)} ms`} />
            <Row label="interval max" value={`${formatNumber(status.frameIntervalMaxMs, 2)} ms`} />
            <Row label="scale" value={formatNumber(status.resolutionScale, 2)} />
            <Row label="scene" value={`${status.renderWidth ?? "—"}x${status.renderHeight ?? "—"}`} />
            <Row label="particles" value={String(status.particles ?? "—")} />
            <Row label="clients" value={String(status.clients ?? "—")} />
          </Column>

          <Column title="bitstream">
            <Row label="AU mean" value={formatBytes(status.auBytesMean)} />
            <Row label="AU max" value={formatBytes(status.auBytesMax)} />
            <Row label="IDR mean" value={formatBytes(status.keyframeBytesMean)} />
            <Row label="present delay" value={`${formatNumber(status.presentationDelayMs, 1)} ms`} />
            <Row label="module" value={String(status.module ?? "—")} />
            <Row label="track" value={String(status.track ?? "—")} />
          </Column>

          <Column title={`client (${stats?.transport ?? "—"})`}>
            <Row label="fps" value={formatNumber(stats?.framesPerSecond, 1)} />
            <Row label="size" value={stats?.width ? `${stats.width}x${stats.height}` : "—"} />
            <Row label="bitrate" value={`${formatNumber(stats?.kilobitsPerSecond, 0)} kbps`} />
            <Row label="dropped" value={String(stats?.framesDropped ?? "—")} />
            <Row label="lost" value={String(stats?.packetsLost ?? "—")} />
            <Row label="nack/pli" value={`${stats?.nackCount ?? "—"}/${stats?.pliCount ?? "—"}`} />
            <Row label="jitter" value={`${formatNumber(stats?.jitterMs, 1)} ms`} />
            <Row label="jbuf" value={`${formatNumber(stats?.jitterBufferMs, 1)} ms`} />
          </Column>

          <Column title="full rate">
            <Row label="divisor" value={String(divisor ?? "—")} />
            <Row label="remaining" value={`${formatNumber(fullRateRemaining, 0)} s`} />
            <Row label="last exit" value={String(exitReason || "—")} />
            <button
              type="button"
              disabled={fullRateBusy || !endpoint?.available}
              onClick={() => {
                void requestFullRate(Number(fullRateRemaining) > 0 ? 0 : FULL_RATE_SECONDS);
              }}
              style={{
                marginTop: 6,
                padding: "5px 10px",
                background: "transparent",
                border: "1px solid #2f6f86",
                color: "#7de3ff",
                font: "inherit",
                cursor: fullRateBusy ? "wait" : "pointer",
              }}
            >
              {Number(fullRateRemaining) > 0 ? "release" : `borrow ${FULL_RATE_SECONDS}s`}
            </button>
            <div style={{ marginTop: 6, maxWidth: 200, opacity: 0.6 }}>
              Borrows the shared NVENC engine from the 4K rung. Expires on its own, and
              immediately if the Apple TV feed starts slipping.
            </div>
          </Column>
        </div>
      ) : null}
    </div>
  );
}

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ color: "#7de3ff", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 10, justifyContent: "space-between", minWidth: 190 }}>
      <span style={{ opacity: 0.6 }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
