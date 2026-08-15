# Browser voice satellite

Lets any dashboard browser (phone, tablet, kiosk) act as a voice satellite: the
status orb becomes a push-to-talk affordance with a listening glow, and the
device streams microphone audio to the voice server through a dashboard-hosted
mTLS bridge.

Per-device behaviour is set on the config page **This Device** group
(`app/components/VoiceInputDeviceGroup.tsx`). Input is always *this browser's*
own microphone — there is no native/custom selection:

- **Voice Agent** — the master switch for this device's web voice input. When
  off, the browser never opens its microphone and the always-on option is
  disabled. It does **not** stop the dashboard's voice animations/events (orb
  glow, transcripts, agent-speech playback), and it does **not** touch any
  separate native satellite process running on the same machine — a native PC
  satellite keeps capturing exactly as before. Defaults to **off**, so kiosks
  (e.g. Nocturnium) never open a browser mic until explicitly enabled.
- **Always-on voice agent** — the app loads with voice mode on and never
  idle-disables. Only settable while Voice Agent is on. Otherwise the orb is a
  tap-to-talk button (tap to open a turn; 10 s without transcribable input
  stands it down).

## Architecture

```
browser mic ─getUserMedia→ AudioWorklet ─16 kHz int16 640B NVAF frames→
  wss://nova.tuatara-dory.ts.net/voice-satellite ─Caddy→
    https://127.0.0.1:8767/voice-satellite  (lib/voice-satellite-bridge.ts)
    ─mTLS /v1/satellites→ Iridium voice server
```

- **Client runtime**: `app/components/dashboard/browserSatellite.ts`
  (capture + resample + NVAF framing + playback), driven by the shared
  `voiceMode.ts` store and mounted headless via
  `app/components/dashboard/BrowserVoiceSatellite.tsx`.
- **TLS front**: Caddy serves the canonical Tailscale HTTPS name and proxies
  `/voice-satellite` to the bridge over loopback. Its `get_certificate tailscale`
  integration obtains and automatically renews the publicly trusted certificate.
- **Bridge**: `lib/voice-satellite-bridge.ts`, started from `instrumentation.ts`.
  A browser cannot present a client certificate, so the bridge relays every frame
  to Iridium over a fresh mTLS socket using the dashboard's existing **client**
  identity in `data/nova-voice-tls/`. It is a dumb pipe — all DSP, turn gating,
  and the push-to-talk `begin_turn` frame are handled server-side.
- **Voice server**: `nova-voice` accepts `client: "browser"` +
  `supervisor: "none"` and a `capturePolicy` of `always` (always-on) or
  `push-to-talk`. A tap sends a `begin_turn` CONTROL frame that arms the wake so
  the next segment is treated as wake-initiated without a spoken wake word
  (`src/nova_voice/satellites/protocol.py`, `api.py`).

## Secure context (required)

Browser mic capture only works in a **secure context** (HTTPS or localhost).
The canonical household URL is therefore:

`https://nova.tuatara-dory.ts.net`

Nova and each browser device must be enrolled in the `tuatara-dory` tailnet.
Iridium does not need Tailscale for this path: Nova reaches Iridium directly on
the household LAN and the browser never connects to Iridium. A new device needs
only Tailscale enrollment plus its normal browser microphone permission; it does
not need the Nova household CA.

`http://192.168.8.14` and `http://nova.local` remain useful non-voice LAN
fallbacks. `https://nova.local` and the HTTPS IP form work only on devices that
already trust the household CA. Do not use those aliases as browser-voice
bookmarks.

### Environment

| Variable | Where | Purpose |
|---|---|---|
| `NOVA_DASHBOARD_TLS_CERT` / `NOVA_DASHBOARD_TLS_KEY` | dashboard server | Server cert/key for the internal bridge TLS hop. **Bridge is disabled until both are set.** |
| `NOVA_VOICE_BRIDGE_PORT` | dashboard server | Bridge listen port (default `8767`). |
| `NOVA_VOICE_BRIDGE_TOKEN` | dashboard server | Optional shared secret; browsers must pass `?token=`. |
| `NOVA_VOICE_HOST_URL` | dashboard server | Voice server base; bridge derives `wss://…/v1/satellites`. The older `NOVA_VOICE_IRIDIUM_URL` still works. |
| `data/nova-voice-tls/{ca,client}.{crt,key}` | dashboard server | Existing mTLS client identity reused for the upstream leg. |
| `NEXT_PUBLIC_NOVA_VOICE_BRIDGE_PORT` / `NEXT_PUBLIC_NOVA_VOICE_BRIDGE_URL` | browser | Optional development/legacy override. Production defaults to same-origin `wss://<page-host>/voice-satellite`. |
| `NEXT_PUBLIC_NOVA_BROWSER_SAT_ROOM` | browser | HA area a browser satellite plays back into (default `lounge`). |

Until `NOVA_DASHBOARD_TLS_CERT/KEY` are provisioned the bridge is inert. On plain
HTTP, `useVoiceMode` also gates the feature because the page is not a secure
context, so the browser will not offer a microphone permission prompt.
