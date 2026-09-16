import { fetchVoiceHostJson, requestVoiceHostJson } from "./client";
import { SPEAKER_PROFILES_PATH } from "./endpoints";
import type { SpeakerProfileSummary, SpeakerProfilesPayload, VoiceHostJsonResult } from "./types";

export async function fetchVoiceHostSpeakerProfiles(): Promise<SpeakerProfilesPayload | null> {
  const payload = await fetchVoiceHostJson(SPEAKER_PROFILES_PATH, "speaker profiles");
  if (!payload || !Array.isArray((payload as SpeakerProfilesPayload).profiles)) return null;
  return payload as SpeakerProfilesPayload;
}

export async function updateVoiceHostSpeakerProfile(
  personId: string,
  update: {
    displayName?: string;
    pronouns?: string | null;
    speechPreferences?: NonNullable<SpeakerProfileSummary["speechPreferences"]>;
  },
): Promise<VoiceHostJsonResult> {
  return requestVoiceHostJson(
    `${SPEAKER_PROFILES_PATH}/${encodeURIComponent(personId)}`,
    "speaker profile update",
    { method: "PATCH", body: {
      ...(update.displayName === undefined ? {} : { display_name: update.displayName }),
      ...(update.pronouns === undefined ? {} : { pronouns: update.pronouns }),
      ...(update.speechPreferences === undefined
        ? {}
        : { speech_preferences: update.speechPreferences }),
    } },
  );
}

export async function deleteVoiceHostSpeakerProfile(personId: string): Promise<VoiceHostJsonResult> {
  return requestVoiceHostJson(
    `${SPEAKER_PROFILES_PATH}/${encodeURIComponent(personId)}`,
    "speaker profile deletion",
    { method: "DELETE" },
  );
}

export async function deleteVoiceHostSpeakerTemplate(templateId: string): Promise<VoiceHostJsonResult> {
  return requestVoiceHostJson(
    `/v1/speaker-templates/${encodeURIComponent(templateId)}`,
    "speaker template deletion",
    { method: "DELETE" },
  );
}

export async function deleteAllVoiceHostSpeakerTemplates(): Promise<VoiceHostJsonResult> {
  return requestVoiceHostJson(
    "/v1/speaker-templates",
    "all speaker templates deletion",
    { method: "DELETE" },
  );
}

export async function assignVoiceHostSpeakerTemplate(
  templateId: string,
  personId: string,
): Promise<VoiceHostJsonResult> {
  return requestVoiceHostJson(
    `/v1/speaker-templates/${encodeURIComponent(templateId)}`,
    "speaker template assignment",
    { method: "PATCH", body: { person_id: personId } },
  );
}
