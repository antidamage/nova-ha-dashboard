import { describe, expect, it } from "vitest";
import {
  formatVoiceTranscriptLine,
  formatVoiceTranscriptParts,
  parseVoiceTranscriptInput,
  parseVoiceTranscriptReplaceInput,
  voiceTranscriptModeLabel,
  voiceTranscriptStatus,
  VOICE_TRANSCRIPT_PENDING_TIMEOUT_MS,
  type VoiceTranscriptEvent,
} from "../voice-transcript";

describe("voice transcript outcome", () => {
  const command = (extra: Partial<VoiceTranscriptEvent> = {}): VoiceTranscriptEvent => ({
    at: "2026-08-13T02:00:00.000Z",
    id: "aaaaaaaa",
    kind: "command",
    role: "user",
    text: "turn on the kitchen lights",
    ...extra,
  });

  it("distinguishes a command that ran from one that did not", () => {
    // `kind` alone collapses these into one label, which is how a failed
    // command used to read exactly like a successful one.
    expect(voiceTranscriptModeLabel(command({ outcome: "executed" }))).toBe("COMMAND");
    expect(voiceTranscriptModeLabel(command())).toBe("COMMAND");
    expect(voiceTranscriptModeLabel(command({ outcome: "failed" }))).toBe("COMMAND FAILED");
    expect(voiceTranscriptModeLabel(command({ outcome: "dry-run" }))).toBe("COMMAND DRY-RUN");
    expect(voiceTranscriptModeLabel(command({ outcome: "shadowed" }))).toBe("COMMAND SHADOWED");
  });

  it("leaves conversational and thinking turns alone", () => {
    expect(voiceTranscriptModeLabel(command({ kind: undefined, outcome: "answered" })))
      .toBe("EXCHANGE");
    expect(voiceTranscriptModeLabel(command({ kind: "thinking" }))).toBe("THINKING");
  });

  it("carries the outcome through parsing and into the rendered parts", () => {
    const parsed = parseVoiceTranscriptInput({
      decision: "execute",
      kind: "command",
      outcome: "failed",
      role: "assistant",
      text: "I could not reach the kitchen light.",
    });

    expect(parsed.outcome).toBe("failed");
    expect(parsed.decision).toBe("execute");
    expect(formatVoiceTranscriptParts({ ...parsed, id: "b" } as VoiceTranscriptEvent).outcome)
      .toBe("failed");
  });

  it("ignores an outcome or decision it does not recognise", () => {
    const parsed = parseVoiceTranscriptInput({
      decision: "improvise",
      outcome: "probably-fine",
      role: "user",
      text: "hello",
    });

    expect(parsed.outcome).toBeUndefined();
    expect(parsed.decision).toBeUndefined();
  });

  it("carries the outcome on an in-place upgrade", () => {
    // The [COMMAND] tag arrives on this upgrade, so its qualifier has to as
    // well or the line reads as a plain successful command.
    expect(parseVoiceTranscriptReplaceInput({
      kind: "command",
      outcome: "dry-run",
      replacesId: "aaaaaaaa",
      text: "turn on the kitchen lights",
    })).toMatchObject({ kind: "command", outcome: "dry-run" });
  });
});

describe("voice transcript status marker", () => {
  const AT = "2026-08-13T02:00:00.000Z";
  const DURING = new Date("2026-08-13T02:00:05.000Z");
  const turn = (extra: Partial<VoiceTranscriptEvent> = {}): VoiceTranscriptEvent => ({
    at: AT,
    id: "aaaaaaaa",
    role: "user",
    text: "make it brighter",
    ...extra,
  });

  it("shows a working marker while the turn is still in flight", () => {
    expect(voiceTranscriptStatus(turn(), DURING)).toBe("working");
    // The runtime does not know it is a command until the turn resolves, so
    // the working state cannot wait for the [COMMAND] tag.
    expect(voiceTranscriptStatus(turn({ kind: "command" }), DURING)).toBe("working");
  });

  it("resolves a command turn to success or failure", () => {
    const command = (outcome: VoiceTranscriptEvent["outcome"]) =>
      voiceTranscriptStatus(turn({ kind: "command", outcome }), DURING);

    expect(command("executed")).toBe("success");
    expect(command("answered")).toBe("success");
    // Every runtime-test turn comes back dry-run; a test suite must not read
    // as a wall of failures because the harness withheld the side effect.
    expect(command("dry-run")).toBe("success");
    expect(command("shadowed")).toBe("success");
    expect(command("failed")).toBe("failure");
    expect(command("ignored")).toBe("failure");
  });

  it("claims nothing for a resolved turn that was not a command", () => {
    expect(voiceTranscriptStatus(turn({ outcome: "answered" }), DURING)).toBeUndefined();
    expect(voiceTranscriptStatus(turn({ kind: "thinking", outcome: "answered" }), DURING))
      .toBeUndefined();
  });

  it("never marks the agent's reply", () => {
    expect(voiceTranscriptStatus(turn({ role: "assistant" }), DURING)).toBeUndefined();
    expect(
      voiceTranscriptStatus(turn({ role: "assistant", kind: "command", outcome: "executed" }), DURING),
    ).toBeUndefined();
  });

  it("gives up on a turn that never came back", () => {
    const started = new Date(AT).getTime();
    const justBefore = new Date(started + VOICE_TRANSCRIPT_PENDING_TIMEOUT_MS - 1);
    const atTimeout = new Date(started + VOICE_TRANSCRIPT_PENDING_TIMEOUT_MS);

    expect(voiceTranscriptStatus(turn(), justBefore)).toBe("working");
    expect(voiceTranscriptStatus(turn(), atTimeout)).toBe("failure");
  });

  it("appends the glyph to the rendered parts and line", () => {
    const parts = formatVoiceTranscriptParts(
      turn({ kind: "command", outcome: "executed" }),
      "Nova",
      undefined,
      DURING,
    );
    expect(parts.status).toBe("success");
    expect(parts.statusGlyph).toBe("⭕");

    const line = formatVoiceTranscriptLine(
      turn({ kind: "command", outcome: "failed" }),
      "Nova",
      undefined,
      DURING,
    );
    expect(line).toContain("make it brighter   ❌");

    // An unmarked line keeps its trailing text exactly as it was.
    const plain = formatVoiceTranscriptLine(
      turn({ outcome: "answered" }),
      "Nova",
      undefined,
      DURING,
    );
    expect(plain.endsWith("make it brighter")).toBe(true);
  });
});
