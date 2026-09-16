"use client";

import {
  PERSONALITY_MAX_LENGTH,
  VOICE_ACCENTS,
  VOICE_EMOTIONS,
  VOICE_LANGUAGES,
  WAKE_PREFIXES_PATTERN,
  type VoiceAccent,
  type VoiceEmotion,
  type VoiceLanguage,
  type VoiceSpeaker,
} from "../../../../lib/voice-settings";
import { VoicePersonalityLibraryControl } from "../../VoicePersonalityLibraryControl";
import { AffectationsControl } from "./AffectationsControl";
import { PronounsControl } from "./PronounsControl";
import { SelectControl } from "./SelectControl";
import { TextAreaControl } from "./TextAreaControl";
import { TextControl } from "./TextControl";
import type { VoiceAgentController } from "./useVoiceAgentPersonality";
import { WakeWordsControl } from "./WakeWordsControl";

// Personality library row, then wake words, voice, language, accent/mood and persona fields.
export function VoicePersonalitySection({ voice }: { voice: VoiceAgentController }) {
  const {
    activePersonalityVisible,
    personalityLibrary,
    personalityDirty,
    visiblePersonalities,
    loadPersonality,
    currentSubset,
    engine,
    testPersonality,
    engineLabel,
    agentName,
    settings,
    commit,
    capabilities,
    activeVoiceValue,
    engineVoiceOptions,
    selectedSpeaker,
    voiceField,
    voiceOptions,
  } = voice;

  return (
    <>
      <div className="mb-4 grid gap-1.5">
        <p className="text-xs font-black uppercase text-neutral-400">Personality</p>
        <VoicePersonalityLibraryControl
          activeId={activePersonalityVisible ? personalityLibrary.library.activeId : null}
          dirty={personalityDirty}
          entries={visiblePersonalities}
          onLoad={loadPersonality}
          onSaveChanges={() => personalityLibrary.saveChanges(currentSubset)}
          onSaveAs={(name) => personalityLibrary.saveAs(name, currentSubset, engine)}
          onRename={(id, name) => personalityLibrary.rename(id, name)}
          onDuplicate={(id) => personalityLibrary.duplicate(id)}
          onDelete={(id) => personalityLibrary.remove(id)}
          onTest={testPersonality}
        />
        <p className="font-sans text-xs leading-snug text-neutral-500">
          A personality bundles the voice, language, accent, baseline mood, description, pronouns,
          affectations, and speech shaping below, and is tied to the engine it was saved under —
          only {engineLabel(engine)} profiles show here. Load one to apply it
          live; the agent name, wake words, volume, and conversation window stay global. Save
          captures the current settings back into the selected personality. Test asks {agentName} a
          random question and plays the spoken reply in this browser.
        </p>
        {personalityLibrary.error ? (
          <p role="status" className="font-sans text-xs text-red-200">{personalityLibrary.error}</p>
        ) : null}
      </div>

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <WakeWordsControl
          value={settings.wakeWords}
          onCommit={(wakeWords) => void commit("wakeWords", wakeWords)}
        />
        <TextControl
          label="Wake prefixes"
          value={settings.wakePrefixes}
          pattern={WAKE_PREFIXES_PATTERN}
          detail="Space-separated greetings accepted before the wake word (e.g. hey ok yo)."
          onCommit={(wakePrefixes) => void commit("wakePrefixes", wakePrefixes)}
        />
        {capabilities.usesCustomVoiceDropdown ? (
          <SelectControl<string>
            label="Voice"
            value={activeVoiceValue}
            options={engineVoiceOptions}
            detail={selectedSpeaker?.detail ?? `${engineLabel(engine)} voice`}
            onChange={(value) => void commit(voiceField, value)}
          />
        ) : (
          <SelectControl<VoiceSpeaker>
            label="Voice"
            value={settings.speaker}
            options={voiceOptions as readonly { label: string; value: VoiceSpeaker }[]}
            detail={selectedSpeaker?.detail ?? "Qwen CustomVoice preset"}
            onChange={(speaker) => void commit("speaker", speaker)}
          />
        )}
        <SelectControl<VoiceLanguage>
          label="Language"
          value={settings.language}
          options={VOICE_LANGUAGES}
          detail="Sets pronunciation and text interpretation for generated speech."
          onChange={(language) => void commit("language", language)}
        />
        {/* Accent and Baseline mood are Classic (Qwen) engine controls: they map
            to the Qwen `instruct` string. Engines that clone or synthesize from
            a trained voice have no accent-instruct surface and infer mood from
            the text, so these are hidden unless the active engine uses them. */}
        {capabilities.usesAccentMood && (
          <>
            <SelectControl<VoiceAccent>
              label="Accent"
              value={settings.accent}
              options={VOICE_ACCENTS}
              detail="Guides accent while preserving the selected voice's timbre."
              onChange={(accent) => void commit("accent", accent)}
            />
            <SelectControl<VoiceEmotion>
              label="Baseline mood"
              value={settings.emotion}
              options={VOICE_EMOTIONS}
              detail={`Sets ${agentName}'s resting delivery before conversational emotion is blended in.`}
              onChange={(emotion) => void commit("emotion", emotion)}
            />
          </>
        )}
        <TextAreaControl
          label="Personality description"
          value={settings.personality}
          maxLength={PERSONALITY_MAX_LENGTH}
          placeholder="You are a bright, bubbly helper!"
          detail="Included with the language model's system prompt to shape how the agent behaves and speaks. Clear it to run with the stock prompt."
          onCommit={(personality) => void commit("personality", personality)}
        />
        <PronounsControl
          value={settings.pronouns}
          onCommit={(pronouns) => void commit("pronouns", pronouns)}
        />
        <AffectationsControl
          value={settings.affectations}
          onCommit={(affectations) => void commit("affectations", affectations)}
        />
      </div>
    </>
  );
}
