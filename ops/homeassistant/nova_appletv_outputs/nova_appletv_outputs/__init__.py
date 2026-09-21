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

Configuration is a bare key in `configuration.yaml`:

    nova_appletv_outputs:

Spec: nova-ha-dashboard/specs/appletv-audio-outputs.md.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from functools import partial
from typing import Any

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.util import slugify

from .const import (
    APPLE_TV_DOMAIN,
    AUDIO_OUTPUT_SUFFIX,
    DOMAIN,
    ENTITY_DOMAINS,
    POLL_SECONDS,
    SIGNAL_CONNECTED,
    SIGNAL_DISCONNECTED,
    TV_SPEAKERS_SUFFIX,
)
from .outputs import Verdict, own_identifiers, own_names, verdict_from

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = vol.Schema(
    {DOMAIN: vol.Schema({}, extra=vol.ALLOW_EXTRA)},
    extra=vol.ALLOW_EXTRA,
)


async def async_setup(hass: HomeAssistant, config: dict[str, Any]) -> bool:
    """Set up the bridge. One read per Apple TV, on HA's own connection."""
    bridge = AppleTVOutputsBridge(hass)
    hass.data[DOMAIN] = bridge
    bridge.async_start()
    return True


class AppleTVOutputsBridge:
    """Reads each Apple TV's active outputs and publishes the verdict."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._cancel: list[CALLBACK_TYPE] = []
        self._watched: dict[str, ConfigEntry] = {}

    @callback
    def async_start(self) -> None:
        """Watch every Apple TV, and keep watching for a later one."""
        for entry in self.hass.config_entries.async_entries(APPLE_TV_DOMAIN):
            self._async_watch(entry)
        # Only for a connection that came up without a dispatch: the list
        # itself arrives on pyatv's device-info push, and a listener of this
        # bridge's would take a slot that belongs to HA's media player.
        self._cancel.append(
            async_track_time_interval(self.hass, self._async_tick, timedelta(seconds=POLL_SECONDS))
        )
        self.hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, self._async_stop)

    @callback
    def _async_stop(self, _event: Any) -> None:
        """Stop reading. The last published state stays until HA restarts."""
        for cancel in self._cancel:
            cancel()
        self._cancel.clear()

    @callback
    def _async_tick(self, _now: Any = None) -> None:
        """Catch an Apple TV configured after setup, and re-read the rest."""
        for entry in self.hass.config_entries.async_entries(APPLE_TV_DOMAIN):
            self._async_watch(entry)
        for entry in list(self._watched.values()):
            self._async_publish(entry)

    @callback
    def _async_watch(self, entry: ConfigEntry) -> None:
        if entry.entry_id in self._watched:
            return
        self._watched[entry.entry_id] = entry
        self._cancel.append(
            async_dispatcher_connect(
                self.hass,
                f"{SIGNAL_CONNECTED}_{entry.unique_id}",
                partial(self._async_publish, entry),
            )
        )
        self._cancel.append(
            async_dispatcher_connect(
                self.hass,
                f"{SIGNAL_DISCONNECTED}_{entry.unique_id}",
                partial(self._async_publish, entry),
            )
        )
        _LOGGER.debug("Watching the audio outputs of %s", entry.title)
        self._async_publish(entry)

    @callback
    def _async_publish(self, entry: ConfigEntry, _atv: Any = None) -> None:
        """Publish both states for one Apple TV. Called on connect and on tick."""
        verdict = self._read(entry)
        shared = {
            "active_outputs": verdict.active_outputs,
            "apple_tv": entry.title,
            "source": DOMAIN,
        }
        self._set(
            self._entity_id(entry, TV_SPEAKERS_SUFFIX),
            verdict.tv_speakers,
            {
                **shared,
                "audio_output": verdict.audio_output,
                "friendly_name": f"{self._label(entry)} TV speakers",
            },
        )
        self._set(
            self._entity_id(entry, AUDIO_OUTPUT_SUFFIX),
            verdict.audio_output,
            {**shared, "friendly_name": f"{self._label(entry)} audio output"},
        )

    @callback
    def _set(self, entity_id: str, state: str, attributes: dict[str, Any]) -> None:
        self.hass.states.async_set(entity_id, state, attributes)

    def _read(self, entry: ConfigEntry) -> Verdict:
        """What HA's live connection reports, or nothing at all."""
        atv = getattr(getattr(entry, "runtime_data", None), "atv", None)
        devices: list[Any] = []
        if atv is not None:
            try:
                devices = list(atv.audio.output_devices)
            except Exception:  # noqa: BLE001 — pyatv raises per protocol; none of it is fatal
                _LOGGER.debug("Reading %s's audio outputs failed", entry.title, exc_info=True)
        return verdict_from(
            devices,
            own_identifiers(entry.unique_id, entry.data.get("identifiers")),
            own_names(entry.title, entry.data.get("name")),
        )

    def _entity_id(self, entry: ConfigEntry, suffix: str) -> str:
        return f"{ENTITY_DOMAINS[suffix]}.{self._slug(entry)}_{suffix}"

    def _slug(self, entry: ConfigEntry) -> str:
        """
        The media player's own object id, so this bridge's states sit beside the
        entity the household already knows:

            media_player.home_theatre  ->  binary_sensor.home_theatre_tv_speakers
        """
        registry = er.async_get(self.hass)
        for entity in er.async_entries_for_config_entry(registry, entry.entry_id):
            if entity.domain == "media_player":
                return entity.entity_id.split(".", 1)[1]
        return slugify(entry.title)

    def _label(self, entry: ConfigEntry) -> str:
        """HA titles a second Apple TV "Home Theatre (1485)"; the device does not."""
        return entry.data.get("name") or entry.title
