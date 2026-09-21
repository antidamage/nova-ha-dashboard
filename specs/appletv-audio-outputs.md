# The Apple TV's audio output, published for the amp to read

Adeline, 2026-09-21: *"when automated state is checked on, check the current
audio device of the apple tv. if it's 'TV Speakers' or similar, turn the amp on.
if it's anything else, turn the amp off. a common use-case is that I connect
bluetooth headphones."*

Task log `20260921T132638Z-7dbdef9d`. Consumer:
[amp-appletv-power.md](amp-appletv-power.md) §8, through
`power.ampPowerControl.audioOutput`.

| File | Holds |
|---|---|
| `ops/homeassistant/nova_appletv_outputs/nova_appletv_outputs/__init__.py` | what HA loads: the config schema and setup |
| `ops/homeassistant/nova_appletv_outputs/nova_appletv_outputs/bridge.py` | the bridge: one read per Apple TV, published as two states |
| `ops/homeassistant/nova_appletv_outputs/nova_appletv_outputs/outputs.py` | the verdict table, pure |
| `ops/homeassistant/nova_appletv_outputs/nova_appletv_outputs/const.py` | the state vocabulary and the signals |
| `ops/homeassistant/nova_appletv_outputs/nova_appletv_outputs/tests/test_outputs.py` | the verdict table's tests, stdlib only |
| `ops/homeassistant/nova_appletv_outputs/install.sh` | install, with a pre-flight import |
| `.../README.md` | install, verify, remove |

This is an **HA-side component of Nova's**, like `ops/homeassistant/tuya_mobile_mqtt_bridge`.
It is not part of the dashboard build and no script deploys it.

## 1. Why it has to exist

The value is the Apple TV's currently selected audio output. Home Assistant's
built-in `apple_tv` integration is pyatv, and pyatv **delivers** that list — the
integration's `AudioListener` receives `outputdevices_update` and the handler in
`media_player.py` is empty, so HA drops it on the floor. No entity attribute
carries it, and HA 2026.7.2 offers no service that reports it.

`amp-appletv-power.md` §1 already settled the other route: Nova reads an HA
entity rather than opening a second pyatv session, because a second connection
competes with HA for the device's session and pairing a new one needs a PIN read
off the television. That reasoning is what puts the bridge *inside* HA — the only
place the Apple TV's live connection already exists.

So: read-only, in-process, and it commands nothing. It never touches the Apple
TV, never sends a service call, and holds no credentials.

## 2. What it publishes

Per Apple TV, two plain states, named off the media player's own object id
(`media_player.home_theatre` → `binary_sensor.home_theatre_tv_speakers`):

| Entity | States |
|---|---|
| `binary_sensor.<apple tv>_tv_speakers` | `on` — the Apple TV's own output is active and nothing else is; `off` — something else is; `unavailable` — there is no live connection to read |
| `sensor.<apple tv>_audio_output` | the active outputs by name, or `unknown` |

Both carry `active_outputs` (identifier and name per output, as pyatv reported
them), `apple_tv` and `source: nova_appletv_outputs`.

**Plain states, not registry entities** (`hass.states.async_set`). The bridge
owns no device; a registry entry invented for another integration's connection
would be a worse lie than a state. They are visible in Developer Tools → States,
recorded by the recorder, and readable from `/api/states` — which is where the
dashboard reads them.

**The identifier source is the config entry**, not a guess:
`entry.data["identifiers"]` lists the Apple TV as `96:02:06:63:50:DB`,
`94020663-50DB-442B-9355-78C9DDCA0C94` and `9602066350DB` — one device, three
spellings — so identifiers are normalised (hex only, lower case) before
comparing, and the Apple TV's own name is the fallback match because tvOS has
spelled the television's own output more than one way. Home Assistant's
disambiguating title suffix (`Home Theatre (1485)`) is stripped before the name
comparison.

The local output's other name is matched too: tvOS calls it **"TV Speakers"**,
which is the name Adeline used when she asked for this, so that label is a
matched name by default and further spellings go in the `tv_speakers_names`
option of the `configuration.yaml` key — a household seeing a third spelling
adds it there rather than waiting for a code change. `sensor.<apple tv>_audio_output`
publishes `own_identifiers` and `own_names` so what was matched — and what would
have to change — is readable from Home Assistant itself.

Reads as three independent chances to recognise the Apple TV's own output:
identifier, its own name, or the local output's label. A miss on all three is
the tail risk of §6.

**Observed on this house's Apple TV, 2026-09-22** (the first live reading, taken
while the device reported `off` to HA — MRP answers in network standby, so the
list is readable even then):

```
active_outputs = [{"identifier": "94020663-50DB-442B-9355-78C9DDCA0C94",
                   "name": "Home Theatre"}]
verdict        = on
```

The reading confirms the identification. The Apple TV reports its own local
output under **the UID spelling** of its identifier —
`94020663-50DB-442B-9355-78C9DDCA0C94`, one of the three spellings the config
entry already stores — so the identifier branch of `is_own_output()` matches it.
Its name matches too, so this shows the identifier branch is sufficient rather
than that it is the branch that fired alone. Nothing beyond the local output was
reported in that reading, which is why the headphones row (§3) still needs an
observation with Bluetooth audio connected before it can be called verified.

## 3. The verdict

`outputs.verdict_from(devices, own_ids, own_names)`:

| pyatv reported | `tv_speakers` | Why |
|---|---|---|
| nothing at all | `unavailable` | not connected, or MRP is not up: **no opinion**, never `off` |
| the Apple TV's own output, and nothing else | `on` | this is "TV Speakers" |
| something the device named or identified, alone or alongside | `off` | Bluetooth headphones, a HomePod, an AirPlay receiver |
| an output with neither a name nor an identifier | `unavailable` | something is active, but not anything this bridge can call "something else" |

`unavailable` is the important row. The dashboard treats anything that is not
`on` or `off` as no opinion (`amp-appletv-power.md` §8.3), so a bridge that
cannot read — HA restarting, MRP down, the Apple TV off the network — leaves the
amplifier following the Apple TV's power state, exactly as it did before this
existed. It can never silence the amplifier by failing. An Apple TV that is
merely *asleep* is not this case: it answers in network standby and reports `on`
(§2), and the dashboard is what keeps the amp off, because the power state is
consulted before the audio route.

## 4. How it is wired

- `async_setup` from a `nova_appletv_outputs:` key in `configuration.yaml`; the
  key takes one option, `tv_speakers_names` (default `["TV Speakers"]`), the
  labels that count as the Apple TV's own output.
- For every `apple_tv` config entry: a read at setup, and a
  dispatcher listener on that entry's `apple_tv_connected_<unique_id>` /
  `apple_tv_disconnected_<unique_id>` (`SIGNAL_CONNECTED` from
  `homeassistant/components/apple_tv/const.py`).
- A **15-second** tick re-reads every watched Apple TV and picks up an Apple TV
  configured after setup. It is belt-and-braces: the output list itself arrives
  on pyatv's device-info push.
- **No `AudioListener` is attached.** `atv.audio.listener` is a single slot and
  Home Assistant's own media player holds it; taking it would stop the media
  player's volume updates. Reading `atv.audio.output_devices` on a tick needs no
  listener, because pyatv's MRP implementation updates that list internally from
  the device-info messages.
- Every read is wrapped: pyatv raises per protocol when a protocol is missing or
  unsupported, and any of that is reported as `unavailable`, which is the safe
  answer.
- On `EVENT_HOMEASSISTANT_STOP` the timers are cancelled. The last state stays
  in the state machine — and is stale by definition — which is why the states
  are re-read at setup on every restart.

## 5. Install, verify, remove

`install.sh` copies the component into `<config>/custom_components/`, refusing a
target outside that directory (it removes what it replaces), then imports the
component and runs its tests **inside the running HA container** — a pre-flight,
because a broken custom component is a startup log entry rather than a loud
failure. It does not edit `configuration.yaml` and does not restart HA: both are
deliberate, visible steps, printed at the end.

Verify with the Apple TV awake:

```sh
curl -s -H "Authorization: Bearer $HA_TOKEN" "$HA_URL/api/states/binary_sensor.home_theatre_tv_speakers"
curl -s -H "Authorization: Bearer $HA_TOKEN" "$HA_URL/api/states/sensor.home_theatre_audio_output"
```

`on` while it plays through the television's own speakers, `off` while the audio
is on Bluetooth headphones — and **not** `unavailable` merely because the Apple
TV is asleep: MRP answers in network standby and still lists the local output, so
the bridge reports `on` and the *dashboard* is what decides the amp should be off
(the Apple TV's power state comes first in `amp-appletv-power.md` §8.2).
`unavailable` means HA holds no connection at all: an HA restart, an Apple TV off
the network, or an `apple_tv` entry that failed to load.

Remove by deleting the directory, dropping the key, and restarting. The
dashboard's `audioOutput` config block is optional, so a removal with no config
change returns the amp to its power-state behaviour.

## 6. The tail risk, stated plainly

The Apple TV reports the television's own output **as itself**, and this bridge
identifies it by identifier first and name second. If a future tvOS reports that
output under a third spelling, the bridge would classify it as "something else"
and the dashboard would keep the amp off while she watches television — the one
failure mode worth knowing about, because it is silent.

The evidence to catch it is published: `sensor.<apple tv>_audio_output`'s history
holds exactly what the device reported, and `power.ampPowerControl.audioOutput`
can be pointed at a different entity or removed with no code change. The first
live observation with the Apple TV awake is therefore part of the acceptance,
not an optional extra.

## Done means

- With the Apple TV awake and playing through its own output,
  `binary_sensor.<apple tv>_tv_speakers` is `on`; with Bluetooth headphones
  connected it is `off`. **Asleep it is still `on`** — MRP answers in standby —
  and the amp stays off because the dashboard consults the power state first.
  `unavailable` means HA holds no connection at all.
- `sensor.<apple tv>_audio_output` names what the device reported, and its
  history is enough to diagnose a misclassification.
- With the amp's `audioOutput` block configured: the amp is on for the first
  case and off for the second, and the Apple TV's power state does not change
  across the two.
- With the block absent, nothing in the dashboard reads these entities and the
  amp behaves exactly as `amp-appletv-power.md` §1–§6 describe.
- `python3 -m unittest discover -s ops/homeassistant/nova_appletv_outputs/nova_appletv_outputs/tests`
  passes, inside the HA container as well as outside it.
- Home Assistant starts with the component installed, its own `apple_tv`
  integration unaffected — volume updates on `media_player.home_theatre` still
  arrive.
