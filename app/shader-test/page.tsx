"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_THEME,
  useDeviceTheme,
  type DeviceTheme,
} from "../components/accentColor";
import {
  FluidBackground,
  type FluidBackgroundDebug,
  type FluidBackgroundDiagnostics,
  type FluidPrecision,
} from "../components/FluidBackground";

// Standalone, dashboard-chrome-free view of the fluid background shader. Link to
// it directly (e.g. on the Nova kiosk) to compare rendering in isolation and to
// A/B the precision / backing-store knobs that the tearing investigation cares
// about. Everything is driven by query params so links are easy to share:
//   /shader-test?precision=medium      reproduce the old 16-bit behaviour
//   /shader-test?precision=high        force 32-bit (the deployed fix)
//   /shader-test?budget=off            disable the backing-store pixel cap
//   /shader-test?scale=1               clamp render scale to 1x
//   /shader-test?theme=default         ignore the shared theme, use built-in dark

type TestParams = {
  precision: FluidPrecision;
  budget: number;
  scaleCap: number;
  useDefaultTheme: boolean;
};

function parsePrecision(value: string | null): FluidPrecision {
  return value === "high" || value === "medium" || value === "auto" ? value : "auto";
}

function parseParams(search: string): TestParams {
  const params = new URLSearchParams(search);

  const budgetRaw = params.get("budget");
  let budget = 2_300_000;
  if (budgetRaw === "off" || budgetRaw === "0") {
    budget = 0;
  } else if (budgetRaw && Number.isFinite(Number(budgetRaw))) {
    budget = Math.max(0, Number(budgetRaw));
  }

  const scaleRaw = params.get("scale");
  const scaleCap = scaleRaw && Number.isFinite(Number(scaleRaw)) ? Math.max(0.25, Number(scaleRaw)) : 1.5;

  return {
    precision: parsePrecision(params.get("precision")),
    budget,
    scaleCap,
    useDefaultTheme: params.get("theme") === "default",
  };
}

function formatBudget(budget: number) {
  if (budget <= 0) {
    return "uncapped";
  }
  return `${(budget / 1_000_000).toFixed(2)}M px`;
}

function DiagRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 12, justifyContent: "space-between" }}>
      <span style={{ opacity: 0.6 }}>{label}</span>
      <span style={{ fontWeight: 700, textAlign: "right", wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}

function PrecisionLink({ value, current }: { value: FluidPrecision; current: FluidPrecision }) {
  const active = value === current;
  return (
    <a
      href={`?precision=${value}`}
      style={{
        padding: "4px 10px",
        border: "1px solid rgba(120,220,255,0.5)",
        borderRadius: 4,
        background: active ? "rgba(120,220,255,0.25)" : "transparent",
        color: "#cdeaff",
        textDecoration: "none",
        fontWeight: 700,
      }}
    >
      {value}
    </a>
  );
}

export default function ShaderTestPage() {
  const { theme: sharedTheme } = useDeviceTheme();
  const [params, setParams] = useState<TestParams | null>(null);
  const [diagnostics, setDiagnostics] = useState<FluidBackgroundDiagnostics | null>(null);
  const [panelHidden, setPanelHidden] = useState(false);

  useEffect(() => {
    setParams(parseParams(window.location.search));
  }, []);

  const theme: DeviceTheme = params?.useDefaultTheme ? DEFAULT_THEME : sharedTheme;

  // Remount the shader whenever the diagnostic-relevant params change so the new
  // precision/budget take effect (they are captured at mount inside the canvas).
  const debugKey = params ? `${params.precision}:${params.budget}:${params.scaleCap}` : "pending";
  const debug: FluidBackgroundDebug | undefined = params
    ? {
        precision: params.precision,
        maxBackingPixels: params.budget,
        scaleCap: params.scaleCap,
        onDiagnostics: setDiagnostics,
      }
    : undefined;

  const otherBudgetHref = useMemo(() => {
    if (!params) {
      return "?budget=off";
    }
    return params.budget > 0 ? "?budget=off" : "?budget=2300000";
  }, [params]);

  if (!params) {
    return <div style={{ background: "#000", width: "100vw", height: "100vh" }} />;
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", overflow: "hidden" }}>
      <FluidBackground key={debugKey} theme={theme} debug={debug} />

      {panelHidden ? (
        <button
          type="button"
          onClick={() => setPanelHidden(false)}
          style={{
            position: "fixed",
            top: 12,
            left: 12,
            zIndex: 10,
            padding: "6px 10px",
            border: "1px solid rgba(120,220,255,0.5)",
            borderRadius: 6,
            background: "rgba(0,0,0,0.55)",
            color: "#cdeaff",
            fontFamily: "monospace",
            fontWeight: 700,
          }}
        >
          diagnostics
        </button>
      ) : (
        <div
          style={{
            position: "fixed",
            top: 12,
            left: 12,
            zIndex: 10,
            width: "min(360px, calc(100vw - 24px))",
            padding: 14,
            border: "1px solid rgba(120,220,255,0.35)",
            borderRadius: 8,
            background: "rgba(0,0,0,0.62)",
            color: "#dff1ff",
            font: "12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
            backdropFilter: "blur(2px)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <strong style={{ fontSize: 13, letterSpacing: 0.5 }}>SHADER TEST</strong>
            <button
              type="button"
              onClick={() => setPanelHidden(true)}
              style={{ background: "transparent", border: "none", color: "#9fd8ff", cursor: "pointer", fontWeight: 700 }}
            >
              hide
            </button>
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <span style={{ opacity: 0.6, alignSelf: "center" }}>precision</span>
            <PrecisionLink value="auto" current={params.precision} />
            <PrecisionLink value="high" current={params.precision} />
            <PrecisionLink value="medium" current={params.precision} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <a href={otherBudgetHref} style={{ color: "#9fd8ff", fontWeight: 700 }}>
              {params.budget > 0 ? "disable backing-store cap →" : "enable backing-store cap →"}
            </a>
          </div>

          <div style={{ display: "grid", gap: 3 }}>
            <DiagRow label="requested" value={params.precision} />
            <DiagRow label="active precision" value={diagnostics?.activePrecision ?? "…"} />
            <DiagRow label="highp frag supported" value={diagnostics ? String(diagnostics.fragmentHighpSupported) : "…"} />
            <DiagRow label="devicePixelRatio" value={diagnostics ? String(diagnostics.devicePixelRatio) : "…"} />
            <DiagRow
              label="css size"
              value={diagnostics ? `${diagnostics.cssWidth}×${diagnostics.cssHeight}` : "…"}
            />
            <DiagRow
              label="backing size"
              value={diagnostics ? `${diagnostics.backingWidth}×${diagnostics.backingHeight}` : "…"}
            />
            <DiagRow label="backing budget" value={formatBudget(params.budget)} />
            <DiagRow label="scale cap" value={`${params.scaleCap}x`} />
            <DiagRow label="max texture size" value={diagnostics ? String(diagnostics.maxTextureSize) : "…"} />
            <DiagRow label="GPU" value={diagnostics?.renderer ?? "…"} />
            <DiagRow label="vendor" value={diagnostics?.vendor ?? "…"} />
            <DiagRow label="theme" value={params.useDefaultTheme ? "default" : "shared"} />
          </div>
        </div>
      )}
    </div>
  );
}
