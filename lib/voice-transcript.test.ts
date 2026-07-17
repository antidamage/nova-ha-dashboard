import { describe, expect, it } from "vitest";
import {
  formatVoiceTranscriptLine,
  parseVoiceTranscriptInput,
  parseVoiceTranscriptReplaceInput,
  type VoiceTranscriptEvent,
} from "./voice-transcript";

describe("voice transcript", () => {
  it("normalizes an Iridium transcript payload", () => {
    expect(parseVoiceTranscriptInput({
      at: "2026-07-17T00:42:37.000Z",
      role: "assistant",
      text: "  The lounge light is on.  ",
      agentName: "Beemo",
      wakeWords: ["beemo", "bimo"],
      satelliteId: "indium",
    })).toEqual({
      at: "2026-07-17T00:42:37.000Z",
      role: "assistant",
      text: "The lounge light is on.",
      agentName: "Beemo",
      wakeWords: ["beemo", "bimo"],
      satelliteId: "indium",
    });
  });

  it("formats both roles with a date and minute precision", () => {
    const common = { id: "turn-1", at: "2026-07-17T00:42:37.000Z" };
    const user: VoiceTranscriptEvent = { ...common, role: "user", text: "Turn it on" };
    const assistant: VoiceTranscriptEvent = {
      ...common,
      id: "turn-2",
      role: "assistant",
      text: "Done",
      agentName: "Beemo",
    };

    expect(formatVoiceTranscriptLine(user, "en-NZ")).toBe("17 Jul 2026, 12:42 pm User: Turn it on");
    expect(formatVoiceTranscriptLine(assistant, "en-NZ")).toBe("17 Jul 2026, 12:42 pm Beemo: Done");
    expect(formatVoiceTranscriptLine(assistant, "en-NZ")).not.toContain(":37");
  });

  it("rejects empty text and unknown roles", () => {
    expect(() => parseVoiceTranscriptInput({ role: "system", text: "hello" })).toThrow(/role/);
    expect(() => parseVoiceTranscriptInput({ role: "user", text: "  " })).toThrow(/text/);
  });

  it("keeps a valid supplied id and drops a malformed one", () => {
    const supplied = parseVoiceTranscriptInput({
      role: "user",
      text: "hello",
      id: "3f2a4b1c9d8e7f60",
    });
    expect(supplied.id).toBe("3f2a4b1c9d8e7f60");
    const malformed = parseVoiceTranscriptInput({
      role: "user",
      text: "hello",
      id: "<script>",
    });
    expect(malformed.id).toBeUndefined();
  });

  it("parses a replace request and rejects a missing target", () => {
    const replace = parseVoiceTranscriptReplaceInput({
      replacesId: "3f2a4b1c9d8e7f60",
      text: "The judge is gonna take the same thing",
      at: "2026-07-17T00:43:00.000Z",
    });
    expect(replace).toEqual({
      replacesId: "3f2a4b1c9d8e7f60",
      text: "The judge is gonna take the same thing",
      at: "2026-07-17T00:43:00.000Z",
    });
    expect(() => parseVoiceTranscriptReplaceInput({ text: "hello" })).toThrow(/replacesId/);
    expect(() =>
      parseVoiceTranscriptReplaceInput({ replacesId: "3f2a4b1c9d8e7f60", text: "  " }),
    ).toThrow(/text/);
  });
});
