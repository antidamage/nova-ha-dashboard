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
      speakerName: "Adeline",
      wakeWords: ["beemo", "bimo"],
      satelliteId: "indium",
    })).toEqual({
      at: "2026-07-17T00:42:37.000Z",
      role: "assistant",
      text: "The lounge light is on.",
      agentName: "Beemo",
      speakerName: "Adeline",
      wakeWords: ["beemo", "bimo"],
      satelliteId: "indium",
    });
  });

  it("formats both roles as decorated box lines with minute precision", () => {
    const at = "2026-07-17T00:42:37.000Z";
    const user: VoiceTranscriptEvent = {
      id: "turn-1",
      at,
      role: "user",
      text: "Turn it on",
      speakerName: "Adeline",
    };
    const assistant: VoiceTranscriptEvent = {
      id: "turn-2",
      at,
      role: "assistant",
      text: "Done",
      agentName: "Beemo",
      kind: "command",
    };

    // The header timestamp renders in the viewer's local time, so build the
    // expected stamp from the same local date parts instead of hard-coding a
    // zone — this test previously flaked on hosts outside NZ time.
    const date = new Date(at);
    const pad = (part: number) => String(part).padStart(2, "0");
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
    const hour = date.getHours() % 12 || 12;
    const meridiem = date.getHours() < 12 ? "am" : "pm";
    const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
      + ` ${weekday} ${hour}:${pad(date.getMinutes())}${meridiem}`;

    expect(formatVoiceTranscriptLine(user)).toBe(
      `╭─[ Adeline ➤ ${stamp} ➤ [EXCHANGE] ]\n╰─ Turn it on`,
    );
    expect(formatVoiceTranscriptLine(assistant)).toBe(
      `╭─[ BEEMO ➤ ${stamp} ➤ [COMMAND] ]\n╰─ Done`,
    );
    expect(formatVoiceTranscriptLine(assistant)).not.toContain(":37");
  });

  it("substitutes custom template variables per role and leaves unknown tokens alone", () => {
    const at = "2026-07-17T00:42:37.000Z";
    const user: VoiceTranscriptEvent = { id: "turn-1", at, role: "user", text: "Turn it on" };
    const assistant: VoiceTranscriptEvent = {
      id: "turn-2",
      at,
      role: "assistant",
      text: "Done",
      agentName: "Beemo",
      kind: "command",
    };

    // Same local-time construction as above so the test passes in any zone.
    const date = new Date(at);
    const pad = (part: number) => String(part).padStart(2, "0");
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${weekday}`;
    const hour = date.getHours() % 12 || 12;
    const meridiem = date.getHours() < 12 ? "am" : "pm";
    const time = `${hour}:${pad(date.getMinutes())}${meridiem}`;

    const template = "%m% | %d% | %t% | %u%%a% %x%";
    expect(formatVoiceTranscriptLine(user, "Nova", template)).toBe(
      `EXCHANGE | ${day} | ${time} | USER %x%\n╰─ Turn it on`,
    );
    expect(formatVoiceTranscriptLine(assistant, "Nova", template)).toBe(
      `COMMAND | ${day} | ${time} | BEEMO %x%\n╰─ Done`,
    );
  });

  it("rejects empty text and unknown roles", () => {
    expect(() => parseVoiceTranscriptInput({ role: "system", text: "hello" })).toThrow(/role/);
    expect(() => parseVoiceTranscriptInput({ role: "user", text: "  " })).toThrow(/text/);
  });

  it("keeps a valid kind and drops an unknown one", () => {
    expect(parseVoiceTranscriptInput({ role: "user", text: "hello", kind: "command" }).kind)
      .toBe("command");
    expect(parseVoiceTranscriptInput({ role: "user", text: "hello", kind: "banter" }).kind)
      .toBeUndefined();
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
      kind: "command",
      speakerName: "Adeline",
    });
    expect(replace).toEqual({
      replacesId: "3f2a4b1c9d8e7f60",
      text: "The judge is gonna take the same thing",
      at: "2026-07-17T00:43:00.000Z",
      kind: "command",
      speakerName: "Adeline",
    });
    expect(() => parseVoiceTranscriptReplaceInput({ text: "hello" })).toThrow(/replacesId/);
    expect(() =>
      parseVoiceTranscriptReplaceInput({ replacesId: "3f2a4b1c9d8e7f60", text: "  " }),
    ).toThrow(/text/);
  });
});
