import { describe, expect, it } from "vitest";
import { BUILTIN_ORB_MODULES, normalizeOrbModule, type OrbPalette } from "../../lib/orb-modules";
import { DEFAULT_NOVA_AVATAR_THEME, normalizeNovaAvatarTheme } from "./avatarThemeModel";
import { createOrbRenderer, type OrbFrame } from "./orbRenderer";

// jsdom has no real 2D context, so the renderer is exercised against a
// recording stub that implements exactly the canvas surface the renderer
// touches. The assertions are structural — "the module's layers produced
// draw calls without throwing" — pixel output is covered by the visual
// verification pass, not unit tests.
function createStubContext() {
  const calls: string[] = [];
  // Endpoint coordinates from moveTo/lineTo, recorded so geometric
  // assertions (e.g. lineField bounce bounds) can inspect what was drawn.
  const points: Array<{ x: number; y: number }> = [];
  const gradient = { addColorStop: () => undefined };
  const record = (name: string) => (..._args: unknown[]) => {
    calls.push(name);
    return undefined;
  };
  const recordPoint = (name: string) => (x: number, y: number) => {
    calls.push(name);
    points.push({ x, y });
    return undefined;
  };
  const ctx = {
    calls,
    points,
    globalCompositeOperation: "source-over",
    globalAlpha: 1,
    shadowBlur: 0,
    shadowColor: "",
    fillStyle: "" as unknown,
    strokeStyle: "" as unknown,
    lineWidth: 1,
    lineCap: "butt",
    save: record("save"),
    restore: record("restore"),
    beginPath: record("beginPath"),
    arc: record("arc"),
    ellipse: record("ellipse"),
    clip: record("clip"),
    fill: record("fill"),
    stroke: record("stroke"),
    clearRect: record("clearRect"),
    moveTo: recordPoint("moveTo"),
    lineTo: recordPoint("lineTo"),
    closePath: record("closePath"),
    createRadialGradient: (..._args: unknown[]) => {
      calls.push("createRadialGradient");
      return gradient;
    },
    createLinearGradient: (..._args: unknown[]) => {
      calls.push("createLinearGradient");
      return gradient;
    },
  };
  return ctx as unknown as CanvasRenderingContext2D & {
    calls: string[];
    points: Array<{ x: number; y: number }>;
  };
}

const PALETTE: OrbPalette = {
  gradientCenter: { rgb: [38, 12, 64], alpha: 1 },
  gradientOuter: { rgb: [0, 0, 0], alpha: 1 },
  gradientAlert: { rgb: [255, 0, 0], alpha: 1 },
  line1: { rgb: [80, 130, 255], alpha: 1 },
  line2: { rgb: [180, 95, 240], alpha: 1 },
  line3: { rgb: [60, 220, 240], alpha: 1 },
  gymNumber: { rgb: [255, 255, 255], alpha: 0.5 },
  innerShadow: { rgb: [0, 0, 0], alpha: 0.5 },
};

function frameAt(nowMs: number, overrides?: Partial<OrbFrame>): OrbFrame {
  return {
    centerX: 64,
    centerY: 64,
    radiusPx: 61.44,
    palette: PALETTE,
    load: 0.5,
    alertActive: false,
    nowMs,
    dtSec: 1 / 60,
    ...overrides,
  };
}

describe("createOrbRenderer", () => {
  it("renders every built-in module without throwing", () => {
    for (const module of BUILTIN_ORB_MODULES) {
      const renderer = createOrbRenderer(module);
      const ctx = createStubContext();
      // Two frames so arcField segments resample (frame 1) and ease (frame 2).
      renderer.render(ctx, frameAt(0));
      renderer.render(ctx, frameAt(16));
      expect(ctx.calls.length).toBeGreaterThan(0);
      // Layer isolation: every save must be matched by a restore.
      expect(ctx.calls.filter((c) => c === "save").length)
        .toBe(ctx.calls.filter((c) => c === "restore").length);
    }
  });

  it("skips alertOnly layers while the alert is inactive and draws them when active", () => {
    // The reactor module carries an alert-flash ring gated on the alert.
    const reactor = BUILTIN_ORB_MODULES.find((module) => module.id === "reactor")!;
    const renderer = createOrbRenderer(reactor);

    const idleCtx = createStubContext();
    renderer.render(idleCtx, frameAt(0, { alertActive: false }));

    const alertCtx = createStubContext();
    // Quarter period: the raised-cosine pulse is mid-wave, so opacity > 0.
    renderer.render(alertCtx, frameAt(reactor.alertPulsePeriod * 250, { alertActive: true }));

    // The alert frame must issue strictly more draw work (the extra ring).
    expect(alertCtx.calls.filter((c) => c === "stroke").length)
      .toBeGreaterThan(idleCtx.calls.filter((c) => c === "stroke").length);
  });

  it("keeps lineField segments inside their track bounds while bouncing", () => {
    // A module with a single diagonal-track lineField, driven hard (full
    // load, large dt) for many frames: every drawn endpoint must stay on the
    // track segment, proving the bounce clamp holds under load growth and
    // direction flips.
    const module = normalizeOrbModule({
      id: "bounce-test",
      layers: [
        {
          type: "lineField",
          count: 4,
          tracks: [{ from: { x: -0.5, y: -0.5 }, to: { x: 0.5, y: 0.5 } }],
          widthMin: 0.02,
          widthMax: 0.04,
          idleLengthMin: 0.1,
          idleLengthMax: 0.2,
          loadLength: 0.9,
          speedMin: 0.5,
          speedMax: 1,
          loadSpeed: 1,
        },
      ],
    })!;
    const renderer = createOrbRenderer(module);
    const ctx = createStubContext();
    for (let i = 0; i < 300; i += 1) {
      renderer.render(ctx, frameAt(i * 50, { load: 1, dtSec: 0.05 }));
    }
    expect(ctx.points.length).toBeGreaterThan(0);
    // Track in pixels: from (64,64)+(-0.5,-0.5)*61.44 to (64,64)+(0.5,0.5)*61.44.
    const lo = 64 - 0.5 * 61.44;
    const hi = 64 + 0.5 * 61.44;
    for (const point of ctx.points) {
      expect(point.x).toBeGreaterThanOrEqual(lo - 1e-6);
      expect(point.x).toBeLessThanOrEqual(hi + 1e-6);
      // The track is the x = y diagonal, so endpoints must sit on it.
      expect(Math.abs(point.x - point.y)).toBeLessThan(1e-6);
    }
  });

  it("keeps independent arcField state per renderer instance", () => {
    const classic = BUILTIN_ORB_MODULES.find((module) => module.id === "classic")!;
    const a = createOrbRenderer(classic);
    const b = createOrbRenderer(classic);
    // Drive only renderer A forward; if state were shared, rendering B first
    // at t=0 after A ran for a while would throw off resample bookkeeping.
    const ctxA = createStubContext();
    for (let i = 0; i < 5; i += 1) a.render(ctxA, frameAt(i * 16));
    const ctxB = createStubContext();
    expect(() => b.render(ctxB, frameAt(0))).not.toThrow();
    expect(ctxB.calls.length).toBeGreaterThan(0);
  });
});

describe("avatar theme orbModule field", () => {
  it("defaults to classic", () => {
    expect(DEFAULT_NOVA_AVATAR_THEME.orbModule).toBe("classic");
    expect(normalizeNovaAvatarTheme({}).orbModule).toBe("classic");
  });

  it("keeps valid ids, including unknown-but-wellformed ones", () => {
    // Unknown ids are kept: the module may exist on the host even when this
    // client hasn't fetched it yet. Rendering falls back to classic until it
    // resolves.
    expect(normalizeNovaAvatarTheme({ orbModule: "aurora" }).orbModule).toBe("aurora");
  });

  it("rejects malformed ids back to classic", () => {
    expect(normalizeNovaAvatarTheme({ orbModule: "../bad" }).orbModule).toBe("classic");
    expect(normalizeNovaAvatarTheme({ orbModule: 7 }).orbModule).toBe("classic");
  });
});
