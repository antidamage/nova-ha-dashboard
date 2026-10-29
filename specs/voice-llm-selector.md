<!-- START HERE, never here alone: read C:\workspace\AGENTS.md, then this repo's specs/README.md (the suite, in order). This file is one part of it. -->
# Language model picker

A picker in Config → Voice Agent, directly under the voice engine picker, that
chooses which interpretation LLM the voice server runs. Added 2026-10-30, when
Bonsai 9B was installed beside LFM3 1.7B. The voice server owns the model list,
the switch and the routing; nova-voice `SPEC.md` "Interpretation model
selection" describes them.

## Behaviour

- **The options come from the voice server** (`GET /v1/llm`'s `llms`: id, label,
  one-line detail). The dashboard hardcodes no model, so a model registered on
  the voice server appears with no dashboard release. Today: LFM3 1.7B (the
  default) and Bonsai 9B.
- Same control as the voice engine picker: `cyber-checkbox-row` radio buttons
  (`MomentaryFeedbackButton`, `role="radio"`), the routed model labelled
  "· active". Choosing another opens a confirm step ("Switch to …" with
  `system-confirm-go`, "Cancel" with `system-confirm-cancel`). Nothing switches
  without that tap.
- **An option the voice server marks unavailable is disabled**, with its
  `unavailableReason` shown under it. Bonsai is unavailable while the Custom
  voice engine is loaded: it needs the whole GPU and is unusably slow when
  pushed partly onto the CPU.
- The confirm step says what happens: the new model loads while the current one
  keeps answering (Bonsai takes under a minute), then the voice agent moves to it
  and the old one is shut down. There is no voice outage.
- While a switch is in flight the picker is disabled and a status line follows
  the switcher's phases (starting, routing, stopping), polling every 3 s. It
  ends with "Switched to …" when `llm` equals the target and the phase is
  `ready`, or with the switcher's error when the phase is `failed`. A failed
  switch leaves the previous model serving.
- When the voice server is unreachable the section reads "Voice server
  unavailable" and offers no options.

## Routes

- `GET /api/voice/llm` relays nova-voice `GET /v1/llm`:
  `{ reachable: true, llm, llms, switch? }`, or `{ reachable: false }`.
- `POST /api/voice/llm` `{ llm }` relays nova-voice `POST /v1/llm`. 400 when
  `llm` is not a non-empty string. A refusal (409) is passed through as 409 with
  the model's `unavailableReason`. Other failures return 502.
