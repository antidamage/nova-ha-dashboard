<!-- START HERE, never here alone: read C:\workspace\AGENTS.md, then this repo's specs/README.md (the suite, in order). This file is one part of it. -->
# Typed input to the voice agent

A text box at the top of the live transcript panel's body, above the log. A
line typed there and sent with Enter goes to the voice agent as if it had been
heard. Added 2026-10-30 for testing input handling by hand and by agents.

## Behaviour

- **Enter sends.** There is no button. An IME composition's Enter does not send.
  Empty or whitespace-only text is never sent. Up to 2000 characters.
- **The box clears on success and keeps the text on failure**, with the error
  shown under it. It is disabled while a send is in flight.
- **Nothing is echoed locally.** The sent line and the agent's reply reach the
  log through the normal `voice-transcript` SSE events, so the log shows exactly
  what the voice host processed.
- Both layouts get it: portrait shows it when the panel is expanded, landscape
  inside the transcript accordion.

## What the voice host does with it

`POST /api/voice/typed-turn` `{ text }` relays to nova-voice
`POST /v1/typed-turns` with a 90 s timeout. nova-voice runs the audio
runtime's turn with the text as the transcript, entering **after STT**:

- Skipped, because they only mean something for captured sound: denoise, STT,
  speaker embedding, the transcript echo check, and the cross-microphone dedup
  (so the same test sentence sent twice runs twice).
- The turn is addressed (`wake_detected`), so it opens or extends the room's
  conversation window like a wake-word turn.
- **No attribution.** It stands for the primary household user: the enrolled
  person with the most voice samples. With no one enrolled it runs
  unattributed, and the voice-training gate does not drop it.
- **The reply is spoken**, through the first connected speaker whose
  microphone is enabled (falling back to any connected speaker). With no
  speaker connected the turn still runs and the reply appears in the log only.
- It is never a dry run: a typed command changes the house as speech would.

## Muting for automated testing

An agent testing with this input first sets the voice settings' daytime and
night-time playback volume to 0, and restores both values afterwards. The
voice host still synthesises the reply; it plays silently.

## Not this

`POST /api/voice/utterance` (the Discord module's text channel) is separate: it
calls the service directly, defaults to a dry run, never speaks and never
appears in the transcript.
