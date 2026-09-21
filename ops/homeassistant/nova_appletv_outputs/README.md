# Nova Apple TV audio outputs

A Home Assistant component of Nova's that publishes **which speakers an Apple TV
is currently playing through**, so the dashboard can power the amplifier only
when the audio is going to the television's own speakers.

It exists because nothing else can answer that question. Home Assistant's
built-in `apple_tv` integration *receives* the Apple TV's output devices from
pyatv and **drops them**: `media_player.py`'s `outputdevices_update` handler is
empty, and no attribute carries the list. The alternative — Nova opening its own
pyatv connection — is the thing `specs/amp-appletv-power.md` §1 refuses: it would
compete with HA for the device's session, and pairing a second one needs a PIN
read off the television.

So this bridge hangs off **Home Assistant's own** connection
(`apple_tv` config entry → `entry.runtime_data.atv`) and reuses it. No second
session, no credentials, no pairing.

Spec: [`specs/appletv-audio-outputs.md`](../../../specs/appletv-audio-outputs.md).
Consumer: `specs/amp-appletv-power.md` §8, `power.ampPowerControl.audioOutput`.

## What it publishes

Two plain states per Apple TV, named off the media player's own object id
(`media_player.home_theatre` → `binary_sensor.home_theatre_tv_speakers`):

| Entity | States |
|---|---|
| `binary_sensor.<apple tv>_tv_speakers` | `on` the Apple TV's own output is active and nothing else is; `off` something else is — Bluetooth headphones, a HomePod, an AirPlay receiver; `unavailable` there is no live connection to read |
| `sensor.<apple tv>_audio_output` | the active outputs by name, `unknown` when there are none |

Both carry `active_outputs` (what pyatv reported), `apple_tv` and `source`.

`unavailable` is deliberately **not** `off`: a bridge that cannot read must never
be able to switch the amplifier off. The dashboard treats anything that is not
`on` or `off` as no opinion (`specs/amp-appletv-power.md` §8.3).

These are plain states, not registry entities: the component owns no device, and
a registry entry invented for another integration's connection would be a worse
lie than a state. They appear in Developer Tools → States, are recorded by the
recorder, and are readable through `/api/states`.

## Install

1. Copy the component into Home Assistant's config directory:

   ```sh
   sudo ops/homeassistant/nova_appletv_outputs/install.sh
   ```

2. Add the key to `configuration.yaml` (a bare key — it takes no options):

   ```yaml
   nova_appletv_outputs:
   ```

3. Restart Home Assistant.

4. Verify: with the Apple TV awake,

   ```sh
   curl -s -H "Authorization: Bearer $HA_TOKEN" \
     "$HA_URL/api/states/binary_sensor.home_theatre_tv_speakers"
   ```

   `on` while it plays through the television's own speakers, `off` while the
   audio is on Bluetooth headphones, `unavailable` while it is asleep.

## Remove

Delete `custom_components/nova_appletv_outputs`, drop the key from
`configuration.yaml`, restart Home Assistant. Nothing else refers to it, and the
dashboard's `power.ampPowerControl.audioOutput` block is optional — without it
the amp follows the Apple TV's power state exactly as it did before.

## Tests

The verdict is a pure module, so it runs anywhere:

```sh
python3 -m unittest discover -s ops/homeassistant/nova_appletv_outputs/tests
```

## Known tail risk

The Apple TV reports the television's own output as *itself*, and this bridge
identifies it by device identifier first (the entry lists all three forms of it)
and by name second. If a future tvOS spells that output some third way, the
bridge would call it "something else" and the amp would stay off while she
watches television. The `sensor.<apple tv>_audio_output` state is the evidence:
its history shows exactly what was reported, and `power.ampPowerControl.audioOutput`
can be pointed at whatever the device actually says (or removed) without a code
change.
