import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const componentsDir = __dirname;
const dashboardSource = readFileSync(join(componentsDir, "Dashboard.tsx"), "utf8");
const voiceConfigSource = readFileSync(join(componentsDir, "VoiceConfig.tsx"), "utf8");

describe("voice transcript placement", () => {
  it("mounts the transcript accordion on the main dashboard", () => {
    expect(dashboardSource).toContain("<VoiceTranscriptPanel");
  });

  it("does not mount the transcript inside Voice Agent config", () => {
    expect(voiceConfigSource).not.toContain("<VoiceTranscriptPanel");
    expect(voiceConfigSource).not.toContain('from "./VoiceTranscriptPanel"');
  });
});
