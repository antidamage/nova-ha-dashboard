# Product decisions from prior work

These decisions were recovered from project memory and are part of the intended
behavior unless explicitly changed:

- The dashboard is for the live Nova Home Assistant environment; Iridium never
  acts as a dashboard or Home Assistant environment.
- Nova is the only dashboard/HA host. Iridium is the dedicated Nova Voice
  inference host and is not an automatic dashboard fallback target. Voice
  preferences remain durable on Nova under `/api/voice`; a change sends Iridium
  a collection signal, and Iridium fetches and applies the complete contract.
- Non-voice/non-personality runtime controls live in a separate Agent accordion.
  The Agent contract is durable under `/api/agent` and is included when Iridium
  collects `/api/voice`. Its Ralph Wiggum verification loop is enabled by
  default and exposes a maximum state-check count, pause between checks, and
  wall-clock failure deadline. A smart-home mutation is sent once; only
  authoritative state reads repeat, stopping at whichever bound is reached first.
- Voice satellites are managed computers with the `voiceSatellite` capability;
  no machine is named in code. The config Voice Agent section lists each one
  with live status from Iridium's satellite registry (`/api/voice/satellites`)
  and a Reconnect button (`/api/voice/satellites/reconnect`) that restarts the
  satellite service on that host over the managed-computer SSH channel
  (macOS LaunchAgent kickstart with bootstrap fallback; Linux user service
  restart). The relaunched satellite reconnects to Iridium on its own.
- The Voice Infrastructure accordion opens with a system-wide voice killswitch
  ("Voice enabled"), a single master on/off written to the shared
  `systemVoiceEnabled` voice setting (POSTed to `/api/voice`, then pulled by
  Iridium). When off, Iridium drops every microphone frame and closes the open
  conversation, disabling voice for the whole household until it is turned back
  on; the default is on and only an explicit `false` disables it. This is the
  shared host-backed switch, distinct from the per-device browser voice-input
  toggle in Voice Agent config.
- Voice Infrastructure also exposes a shared Satellite noise gate switch. It
  defaults on and is part of the `/api/voice` contract as
  `satelliteNoiseGateEnabled`; Iridium pushes changes over the already-open
  native satellite sockets. Off is an explicit diagnostic bypass that makes
  each enabled native satellite transmit every captured 20 ms frame, while on
  keeps silence local and sends probable speech with protected pre-roll/tail.
- The per-satellite voice killswitch defaults Nocturnium off so a fresh/reset
  config processes only Indium. An explicit toggle can still enable Nocturnium
  or disable Indium without stopping either supervised process.
- The config page carries an always-visible voice-server status readout at the
  top: the dashboard probes Iridium's `/health` over mTLS via
  `/api/voice/server-status`, and the readout polls that endpoint every five
  seconds (skipping hidden tabs and never stacking overlapping probes). It
  shows the configured host name, overall state (online with latency,
  degraded, unreachable with the failure reason), and per-service dots for
  interpretation, speech to text, text to speech, the dashboard link, and the
  noise-suppression sidecar when reported. The readout is hidden in demo mode.
- Iridium posts accepted user speech and spoken replies to
  `/api/voice/transcript`. A standalone accordion on the main dashboard shows the bounded, live
  two-sided transcript; new lines share the dashboard SSE stream. The panel can be
  collapsed, and its Clear action erases the server snapshot and broadcasts
  the reset to every open dashboard. Voice Agent config does not contain the
  transcript display. Each entry renders as a two-line box decoration: a
  templated header line and a fixed `╰─ ` body lead-in before the message
  text. The header comes from the editable `transcriptTemplate` voice
  setting (Transcript decoration field at the bottom of Voice Agent config,
  with a live two-line preview; clearing the field restores the stock
  decoration, `╭─[ %u%%a% ➤ %d% %t% ➤ [%m%] ]`). Template tokens: `%u%`
  substitutes `USER` on user lines and empty on agent lines; `%a%` the
  upper-cased current agent name on agent lines and empty on user lines
  (speaker labels carry no emojis); unknown `%x%`-style tokens render
  literally. The remaining tokens: `%d%` is the locale-independent local
  date `2026-07-18 Sat`; `%t%` the minute-precision local time `10:59am`;
  and `%m%` the turn mode, reading `COMMAND` when the turn executed or
  shadowed a dashboard command and `EXCHANGE` otherwise (the voice server
  tags command turns, upgrading the displayed line in place once
  interpretation completes). Box glyphs and header share the meta
  styling — user prefixes render dimmed, agent prefixes in the highlight
  colour with a soft glow and an italicised body — so the two speakers are
  distinguishable at a glance. The log renders as a CRT screen: a scanline
  texture tinted by the transcript background colour (overlay-blended, with
  opacity and pitch scale sliders in the Transcript Background theme
  widget), a text glow (intensity and size sliders in the Transcript Text
  theme widget), and a static curved-glass gloss overlay inside a subtle
  bezel frame.
- The Outside camera normally uses the physical MacroSilicon S-Video capture
  feed; the generated signal test remains available as an explicit or
  device-absent fallback.
- The top-level Devices dashboard section was intentionally removed.
- Kitchen light 2 is expected to appear as `light.kitchen_light_2` under
  Kitchen and Everything when HA exposes it.
- Illumination-like switches belong in the lighting layer and in Everything.
- The outside light is excluded from broad inside/everything commands.
- Candlelight is adaptive by sun state: warm white by day, true candlelight by
  night.
- Adaptive lighting updates already-on lights at sunrise/sunset but does not
  turn lights on.
- White and custom color clear adaptive candlelight memory for a zone.
- Dashboard Auto aircon is app-managed thermostat behavior, not native Gree/HA
  auto.
- The aircon delta invariant must not be reversed.
- Dashboard UI controls and chrome should use the existing theme token system.
- Power graph colors may remain purpose-specific.
- Tasks include a read-only iCloud mirror and local editable task store.
- The Nova avatar is a host-load/status visualization mounted globally.
