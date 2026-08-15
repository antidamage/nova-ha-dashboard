import { NextResponse } from "next/server";
import { fetchVoiceHostCatalog } from "../../../../lib/voice-host-settings";
import {
  VOICE_ACCENTS,
  VOICE_EMOTIONS,
  VOICE_LANGUAGES,
  VOICE_SETTINGS_RANGES,
  VOICE_SPEAKERS,
} from "../../../../lib/voice-settings";

export const dynamic = "force-dynamic";

// voice host publishes the voices and ranges its deployed stack supports; this
// route relays them to the Voice Agent UI. The static lists remain as the
// fallback so the section still renders while voice host is offline.
export async function GET() {
  const catalog = await fetchVoiceHostCatalog();
  if (catalog) {
    return NextResponse.json({ source: "voiceHost", ...catalog });
  }
  return NextResponse.json({
    source: "fallback",
    voices: VOICE_SPEAKERS.map(({ value, label, detail }) => ({ value, label, detail })),
    languages: VOICE_LANGUAGES.map(({ value }) => value),
    accents: VOICE_ACCENTS.map(({ value }) => value),
    emotions: VOICE_EMOTIONS.map(({ value }) => value),
    ranges: {
      speechRate: { ...VOICE_SETTINGS_RANGES.speechRate, default: 100 },
      pitch: { ...VOICE_SETTINGS_RANGES.pitch, default: 0 },
      emotionMirroring: { ...VOICE_SETTINGS_RANGES.emotionMirroring, default: 100 },
      temperature: { ...VOICE_SETTINGS_RANGES.temperature, default: 0 },
      volumeDay: { ...VOICE_SETTINGS_RANGES.volumeDay, default: 100 },
      volumeNight: { ...VOICE_SETTINGS_RANGES.volumeNight, default: 100 },
    },
  });
}
