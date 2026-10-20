import { describe, expect, it } from "vitest";
import {
  formatRouteLines,
  formatVoiceTranscriptParts,
  parseVoiceTranscriptInput,
  type VoiceTranscriptEvent,
} from "../voice-transcript";

describe("route chain on a transcript line", () => {
  it("gives each stack its own line, so the two can be compared directly", () => {
    // Grouped by where rather than by execution order: two interleaved lists
    // make "what did each side cost me" a subtraction done in the head.
    expect(
      formatRouteLines([
        { pass: "interpret", source: "local", ms: 3480.5 },
        { pass: "interpret", source: "companion", ms: 2100 },
        { pass: "render_response", source: "local", ms: 1200 },
        { pass: "render_response", source: "companion", ms: 1796.5 },
      ]),
    ).toEqual([
      "server  interpret 3.5s · render_response 1.2s  = 4.7s",
      "device  interpret 2.1s · render_response 1.8s  = 3.9s",
    ]);
  });

  it("ends each line with that stack's total, which is the decision number", () => {
    const [server] = formatRouteLines([
      { pass: "interpret", source: "local", ms: 3000 },
      { pass: "render_response", source: "local", ms: 1000 },
    ]);

    expect(server).toBe("server  interpret 3.0s · render_response 1.0s  = 4.0s");
  });

  it("omits a total that would just repeat the only figure on the line", () => {
    expect(formatRouteLines([{ pass: "interpret", source: "local", ms: 3000 }])).toEqual([
      "server  interpret 3.0s",
    ]);
  });

  it("gives a one-sided turn one line, implying no comparison that never happened", () => {
    const lines = formatRouteLines([{ pass: "interpret", source: "companion", ms: 900 }]);

    expect(lines).toEqual(["device  interpret 900ms"]);
  });

  it("is empty when no routed pass ran", () => {
    expect(formatRouteLines([])).toEqual([]);
    expect(formatRouteLines(undefined)).toEqual([]);
  });

  it("survives a round trip through the transcript parser", () => {
    const parsed = parseVoiceTranscriptInput({
      role: "assistant",
      text: "Done.",
      routes: [{ pass: "interpret", source: "local", ms: 3000 }],
    });

    expect(parsed.routes).toEqual([{ pass: "interpret", source: "local", ms: 3000 }]);
  });

  it("drops a malformed chain rather than showing a partial one", () => {
    // A chain missing a hop is worse than no chain: the question it answers is
    // "did anything else also run", and a partial answer is a wrong answer.
    const parsed = parseVoiceTranscriptInput({
      role: "assistant",
      text: "Done.",
      routes: [{ pass: "interpret", source: "local", ms: 3000 }, { pass: "render_response" }],
    });

    expect(parsed.routes).toBeUndefined();
  });

  it("puts the lines on the formatted parts", () => {
    const parts = formatVoiceTranscriptParts(
      {
        id: "1",
        at: new Date().toISOString(),
        role: "assistant",
        text: "Done.",
        routes: [
          { pass: "interpret", source: "local", ms: 3000 },
          { pass: "interpret", source: "companion", ms: 900 },
        ],
      } as VoiceTranscriptEvent,
      "Nova",
    );

    expect(parts.routeLines).toEqual(["server  interpret 3.0s", "device  interpret 900ms"]);
  });
});
