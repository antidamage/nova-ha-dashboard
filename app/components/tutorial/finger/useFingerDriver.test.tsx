// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { isUxQuiet } from "../../uxQuiet";
import type { TutorialScriptId } from "../steps";
import { useFingerDriver } from "./useFingerDriver";

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

describe("useFingerDriver", () => {
  // PR #169 review: Next pressed mid-play onto a step with no script left
  // `playing` true, so the live idle exit could never fire.
  it("stops playing, and unmutes, when Next lands on a step with no script", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const { result, rerender } = renderHook(({ script }: { script: TutorialScriptId }) => useFingerDriver({
      script,
      getRoot: () => root,
      within: () => false,
      reset: () => Promise.resolve(),
      draw: () => undefined,
      reducedMotion: true,
    }), { initialProps: { script: "unlock" as TutorialScriptId } });
    await flush();
    expect(result.current.playing).toBe(true);
    expect(isUxQuiet()).toBe(true);
    rerender({ script: "none" });
    await flush();
    expect(result.current.playing).toBe(false);
    expect(isUxQuiet()).toBe(false);
  });
});
