"""Publish each Apple TV's audio output as entities the dashboard can read.

Home Assistant's own `apple_tv` integration **receives** the Apple TV's output
devices from pyatv and drops them: `media_player.py`'s `outputdevices_update`
handler is empty, and no attribute carries the list. So Nova cannot read the
answer from any entity HA publishes today, and the alternative — a second pyatv
connection of Nova's own — is the thing specs/amp-appletv-power.md §1 refuses:
it would compete with HA for the device's session and need a PIN read off the
television to pair.

So this bridge hangs off **HA's own** connection (`entry.runtime_data.atv`) and
publishes two states per Apple TV:

    binary_sensor.<apple tv>_tv_speakers    on | off | unavailable
    sensor.<apple tv>_audio_output          the active outputs, by name

    on            the Apple TV's own output is active, and nothing else is
    off           something else is — Bluetooth headphones, a HomePod, an
                  AirPlay receiver
    unavailable   there is no live connection to read

Plain states rather than registry entities, on purpose: this integration owns
no device, and a registry entry invented for another integration's connection
would be a worse lie than a state. The vocabulary is the contract, and the
dashboard names it in `power.ampPowerControl.audioOutput`.

The body lives in `bridge.py`, the same shape `ops/homeassistant/tuya_mobile_mqtt_bridge`
uses; this file keeps what Home Assistant loads.

Spec: nova-ha-dashboard/specs/appletv-audio-outputs.md.
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv

from .bridge import AppleTVOutputsBridge
from .const import CONF_TV_SPEAKERS_NAMES, DEFAULT_TV_SPEAKERS_NAMES, DOMAIN

CONFIG_SCHEMA = vol.Schema(
    {
        DOMAIN: vol.Schema(
            {
                vol.Optional(
                    CONF_TV_SPEAKERS_NAMES, default=list(DEFAULT_TV_SPEAKERS_NAMES)
                ): cv.ensure_list,
            },
            extra=vol.ALLOW_EXTRA,
        )
    },
    extra=vol.ALLOW_EXTRA,
)


async def async_setup(hass: HomeAssistant, config: dict[str, Any]) -> bool:
    """Set up the bridge. One read per Apple TV, on HA's own connection."""
    options = config.get(DOMAIN) or {}
    bridge = AppleTVOutputsBridge(
        hass,
        [str(name) for name in options.get(CONF_TV_SPEAKERS_NAMES, DEFAULT_TV_SPEAKERS_NAMES)],
    )
    hass.data[DOMAIN] = bridge
    bridge.async_start()
    return True
