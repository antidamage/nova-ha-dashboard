// Lifecycle contract for the fluid background: stop drawing while hidden,
// release the GL context on unmount, recover from context loss up to a limit.
// specs/wallpaper-background-mode.md "WebGL lifecycle".

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME_SET, type DeviceTheme } from "../../accentColor";
import { FluidBackground, MAX_CONTEXT_RECOVERIES } from "./FluidBackground";

const loseContext = vi.fn();
const createProgram = vi.fn();

vi.mock("./gl-program", async () => {
  const actual = await vi.importActual<typeof import("./gl-program")>("./gl-program");
  return {
    ...actual,
    createProgram: (...args: unknown[]) => createProgram(...args),
    createMosaicTexture: () => ({}),
    resizeCanvas: () => {},
  };
});

vi.mock("./diagnostics", () => ({ reportDiagnosticsOnce: () => () => {} }));

function stubGl() {
  const gl = {
    ARRAY_BUFFER: 0,
    FLOAT: 0,
    TEXTURE0: 0,
    TEXTURE_2D: 0,
    TRIANGLES: 0,
    activeTexture: vi.fn(),
    bindBuffer: vi.fn(),
    bindTexture: vi.fn(),
    deleteBuffer: vi.fn(),
    deleteProgram: vi.fn(),
    deleteTexture: vi.fn(),
    drawArrays: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    getExtension: vi.fn((name: string) => (name === "WEBGL_lose_context" ? { loseContext } : null)),
    uniform1f: vi.fn(),
    uniform1i: vi.fn(),
    uniform2f: vi.fn(),
    uniform3fv: vi.fn(),
    useProgram: vi.fn(),
    vertexAttribPointer: vi.fn(),
  };
  return gl as unknown as WebGLRenderingContext;
}

const theme = DEFAULT_THEME_SET.themes.dark as DeviceTheme;

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("FluidBackground lifecycle", () => {
  let gl: WebGLRenderingContext;
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    gl = stubGl();
    frames = [];
    loseContext.mockClear();
    createProgram.mockReset();
    createProgram.mockImplementation(() => ({
      attribute: 0,
      buffer: {},
      gl,
      program: {},
      uniforms: {},
    }));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });

  it("releases the WebGL context on unmount so repeat mounts do not leak one", () => {
    const view = render(<FluidBackground theme={theme} />);
    expect(loseContext).not.toHaveBeenCalled();

    view.unmount();

    expect(gl.deleteBuffer).toHaveBeenCalled();
    expect(gl.deleteProgram).toHaveBeenCalled();
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it("stops scheduling frames while the page is hidden and resumes when visible", () => {
    render(<FluidBackground theme={theme} />);
    const scheduledAtMount = frames.length;
    expect(scheduledAtMount).toBeGreaterThan(0);

    setHidden(true);
    const scheduledWhileHidden = frames.length;
    // Running the pending frame must not queue another one while hidden.
    frames[frames.length - 1]?.(performance.now());
    expect(frames.length).toBe(scheduledWhileHidden);

    setHidden(false);
    expect(frames.length).toBeGreaterThan(scheduledWhileHidden);
  });

  it("rebuilds the program after a recoverable context loss", () => {
    const view = render(<FluidBackground theme={theme} />);
    const canvas = view.container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(createProgram).toHaveBeenCalledTimes(1);

    const lost = new Event("webglcontextlost", { cancelable: true });
    act(() => {
      canvas?.dispatchEvent(lost);
    });
    expect(lost.defaultPrevented).toBe(true);

    expect(createProgram.mock.calls.length).toBeGreaterThan(1);
    expect(view.container.querySelector("canvas")).not.toBeNull();
  });

  it("gives up and renders nothing once the context is lost past the limit", () => {
    const view = render(<FluidBackground theme={theme} />);

    for (let attempt = 0; attempt <= MAX_CONTEXT_RECOVERIES; attempt += 1) {
      const canvas = view.container.querySelector("canvas");
      if (!canvas) {
        break;
      }
      act(() => {
        canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
      });
    }

    expect(view.container.querySelector("canvas")).toBeNull();
  });
});
