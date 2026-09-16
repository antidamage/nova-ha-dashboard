export type VoicePreferences = {
  /** User-facing display name of the voice agent (emoji/symbols allowed). */
  agentName?: string;
  /**
   * Optional plain-text pronunciation of the agent name, used by the voice
   * service for the spoken/ASR-facing identity. Empty means "use the display
   * name".
   */
  agentNamePronunciation?: string;
  /**
   * System-wide voice killswitch. When false, the voice runtime drops all
   * microphone audio and closes any open conversation, disabling voice for the
   * entire household until it is turned back on. Defaults to true.
   */
  systemVoiceEnabled?: boolean;
  /** Learn local voice templates and personalize turns for recognized household members. */
  speakerRecognitionEnabled?: boolean;
  /**
   * Voice training. On, an unrecognized voice may still wake the assistant and
   * issue commands, and every accepted turn refines recognition — the mode for
   * enrolling someone, adding a microphone or room, or a day when a familiar
   * voice sounds different. Off, only recognized household voices are heard.
   * Bypassed entirely when speaker recognition is unavailable.
   */
  voiceTrainingEnabled?: boolean;
  /**
   * Per-satellite killswitch: satellite ids that are individually switched off.
   * The voice server drops their microphone frames while they are listed, so one
   * satellite can be silenced (e.g. while testing other devices) without stopping
   * its process. An explicit empty list enables every satellite; absent defaults
   * to Nocturnium disabled so only the primary Indium mic is processed.
   */
  disabledSatellites?: string[];
  /**
   * Run the lightweight activity/noise gate on native satellites before they
   * transmit audio. Disable temporarily to stream every frame for diagnostics.
   */
  satelliteNoiseGateEnabled?: boolean;
  /**
   * Which machine runs each of the assistant's reasoning passes: `local` on the
   * voice server, `companion` only on the paired phone, or `both` (phone first,
   * voice server when it cannot answer).
   *
   * A pass left out keeps the voice server's own default, so an absent or
   * partial map means "as shipped" rather than "route nothing".
   */
  companionRoutes?: Record<string, "local" | "companion" | "both">;
  /**
   * Whether the companion feature is on at all. Switching it off restores the
   * voice server's previous behaviour exactly, as if the feature had never
   * shipped.
   *
   * Undefined means "leave the voice server as configured" rather than a
   * dashboard default, so a deployment that has never touched this control is
   * not silently switched either way.
   */
  companionEnabled?: boolean;
  /**
   * Keep every reasoning pass on the voice server without disconnecting the
   * device or disabling its personal tools. The switch to reach for during an
   * incident: it applies immediately and undoes the same way, with nothing to
   * do on the phone.
   */
  companionForceLocal?: boolean;
  speaker?: "Ryan" | "Aiden" | "Vivian" | "Serena" | "Uncle_Fu" | "Dylan" | "Eric" | "Ono_Anna" | "Sohee";
  /**
   * Custom-engine (dots.tts) voice: a cloned-voice id from the voice server's
   * registry. Separate from `speaker` because each TTS engine has its own
   * disjoint voice namespace; each engine keeps its own last-used voice.
   */
  customSpeaker?: string;
  /**
   * Trained-engine (GPT-SoVITS) voice: a fine-tuned checkpoint id from the
   * voice server's trained-voice registry. Own namespace for the same reason
   * as `customSpeaker`. May be empty until a voice has been trained.
   */
  trainedSpeaker?: string;
  language?: "Auto" | "English" | "Chinese" | "Japanese" | "Korean" | "German" | "French" | "Russian" | "Portuguese" | "Spanish" | "Italian";
  accent?: "voice-native" | "new-zealand" | "australian" | "british" | "american" | "irish" | "scottish";
  speechRate?: number;
  pitch?: number;
  emotion?: "natural" | "calm" | "cheerful" | "empathetic" | "serious" | "dry" | "energetic";
  emotionMirroring?: number;
  /** LLM sampling temperature for spoken-response rendering (0 = deterministic). */
  temperature?: number;
  /** Chance (0-1) that a conversational reply is rendered as two to four sentences. */
  longResponseProbability?: number;
  /**
   * Spoken-word length of a verified command acknowledgement is rolled per
   * reply as a random value in [commandReplyMinWords, commandReplyMaxWords]
   * (0-10 each). Zero at both ends means a silent acknowledgement; raising
   * the minimum guarantees an audible reply every time — useful during
   * development, when silent success is easy to mistake for no response.
   */
  commandReplyMinWords?: number;
  commandReplyMaxWords?: number;
  /**
   * Let the agent look things up online when a request needs current or external
   * information. Default off — this is the only feature that sends any text off
   * the local network (the rewritten query only), so it is opt-in.
   */
  webAccessEnabled?: boolean;
  /**
   * Which backend answers a web lookup. "brave" scrapes Brave Search in a
   * headless browser (Google-tier, keyless, non-Google); "local" is keyless
   * DuckDuckGo + on-device summarize; "gemini" is retained in code only.
   */
  webBackend?: "brave" | "local" | "gemini";
  /** How many sentences a spoken web answer may run (1-5). */
  webAnswerMaxSentences?: number;
  /** Spoken wake words and common speech-recognition variants. */
  wakeWords?: string[];
  /** Legacy single wake word; migrated into wakeWords when read. */
  wakeWord?: string;
  /** Space-separated greeting prefixes accepted before the wake word. */
  wakePrefixes?: string;
  /** Response playback volume percent during the day (8:00–21:00). */
  volumeDay?: number;
  /** Response playback volume percent at night (21:00–8:00). */
  volumeNight?: number;
  /** Personality description appended to the voice agent's LLM system prompt. */
  personality?: string;
  /** Seconds a conversation stays open without a turn before the wake word is required again. */
  conversationIdleSeconds?: number;
  /**
   * Absolute seconds a conversation may live from the wake word that opened it.
   * The idle window is refreshed by every engaged turn and so cannot bound a
   * conversation on its own; this is the backstop that always closes it.
   */
  conversationMaxSeconds?: number;
  /** Milliseconds of streamed audio the satellite buffers before starting playback. */
  ttsPrerollMs?: number;
  /** Milliseconds of audio per steady-state frame sent to satellites. */
  ttsFrameMs?: number;
  /**
   * Custom (dots.tts) diffusion step count — the model-side latency/quality
   * lever. Fewer steps reach first audio sooner and cost less GPU per reply.
   * Ignored by the Classic engine.
   */
  dotsNumSteps?: number;
  /**
   * Speaker-matching tuning — TitaNet cosine similarity thresholds (0-1) that
   * control how fuzzy voice recognition is across mics, rooms, and distances.
   * Defaults mirror the voice service's historical env values.
   */
  /** Min cosine to accept a turn as a known person. Lower = recognizes more readily. */
  speakerMatchThreshold?: number;
  /** Required lead of the best match over the runner-up before it is trusted. */
  speakerMatchMargin?: number;
  /** Min cosine to merge a capture into an existing unnamed profile vs. making a new one. */
  speakerClusterThreshold?: number;
  /** Min cosine to keep the same speaker across one open conversation's follow-up turns. */
  speakerConversationMatchThreshold?: number;
  /** Transcript header decoration template (%u%/%a%/%d%/%t%/%m% tokens). */
  transcriptTemplate?: string;
  /**
   * The agent's third-person pronouns in three forms (subjective/objective/
   * possessive), passed to the language model so it refers to itself correctly.
   * Part of a saved voice personality.
   */
  pronouns?: {
    subjective?: string;
    objective?: string;
    possessive?: string;
  };
  /**
   * Speech affectations: deterministic quirks the voice service applies to the
   * finished reply text (dashboard checkboxes). Part of a saved voice
   * personality.
   */
  affectations?: {
    /** Drop first- and second-person pronouns from spoken replies. */
    pronounDrop?: boolean;
  };
  updatedAt?: string;
};
