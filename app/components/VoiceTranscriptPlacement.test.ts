import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const componentsDir = __dirname;
const voicePanelSource = readFileSync(join(componentsDir, "dashboard", "VoicePanel.tsx"), "utf8");
const voiceConfigSource = readFileSync(join(componentsDir, "VoiceConfig.tsx"), "utf8");

describe("voice transcript placement", () => {
  it("mounts the transcript panel directly in the Voice zone, with no Advanced fold wrapper", () => {
    expect(voicePanelSource).toContain("<VoiceTranscriptPanel");
    expect(voicePanelSource).not.toContain("AdvancedFold");
    expect(voicePanelSource).not.toContain("advanced=");
  });

  it("does not mount the transcript inside Voice Agent config", () => {
    expect(voiceConfigSource).not.toContain("<VoiceTranscriptPanel");
    expect(voiceConfigSource).not.toContain('from "./VoiceTranscriptPanel"');
  });
});
