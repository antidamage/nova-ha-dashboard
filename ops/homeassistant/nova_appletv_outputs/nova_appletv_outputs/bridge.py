"""The bridge itself: one read per Apple TV, published as two states.

Kept apart from `__init__.py` (which Home Assistant loads and the config schema
lives in) because this is the half with the behaviour in it, and because a file
an agent has to read should not be the one that also holds the wiring.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from functools import partial
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
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


class AppleTVOutputsBridge:
    """Reads each Apple TV's active outputs and publishes the verdict."""

    def __init__(self, hass: HomeAssistant, tv_speakers_names: list[str]) -> None:
        self.hass = hass
        self._tv_speakers_names = tv_speakers_names
        self._cancel: list[CALLBACK_TYPE] = []
        self._watched: dict[str, ConfigEntry] = {}
        # The last published verdict per Apple TV, so the log carries changes
        # rather than a line every 15 seconds.
        self._published: dict[str, str] = {}

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
        own_ids, names = self._own_identities(entry)
        verdict = self._read(entry, own_ids, names)
        self._log_change(entry, verdict)
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
            {
                **shared,
                "friendly_name": f"{self._label(entry)} audio output",
                # What the Apple TV's own output was matched against. Publishing
                # it is the diagnosis a misclassification needs: the identifier
                # and the name are exactly what would have to change.
                "own_identifiers": sorted(own_ids),
                "own_names": sorted(names),
            },
        )

    @callback
    def _set(self, entity_id: str, state: str, attributes: dict[str, Any]) -> None:
        self.hass.states.async_set(entity_id, state, attributes)

    def _log_change(self, entry: ConfigEntry, verdict: Verdict) -> None:
        """
        One line per change, naming the outputs the Apple TV reported.

        Nothing is surfaced in the UI — the same silence specs/power-meters.md §1
        requires of the meter guard. At INFO this needs the household to raise
        the level for this component (`custom_components.nova_appletv_outputs`);
        Home Assistant's root logger is WARNING by default, which is why the
        published states, not this line, are the trail §6 relies on.
        """
        if self._published.get(entry.entry_id) == verdict.tv_speakers:
            return
        self._published[entry.entry_id] = verdict.tv_speakers
        reported = ", ".join(
            f"{output['name']} ({output['identifier']})" for output in verdict.active_outputs
        )
        _LOGGER.info(
            "%s reports %s for its audio output%s",
            entry.title,
            verdict.tv_speakers,
            f": {reported}" if reported else "",
        )

    def _own_identities(self, entry: ConfigEntry) -> tuple[set[str], set[str]]:
        """
        What the Apple TV's own output looks like when it reports itself.

        The identifiers are the config entry's — Home Assistant already stores
        every spelling of them — and the names are the Apple TV's own plus the
        labels tvOS puts on its local output.
        """
        return (
            own_identifiers(entry.unique_id, entry.data.get("identifiers")),
            own_names(entry.title, entry.data.get("name"), *self._tv_speakers_names),
        )

    def _read(self, entry: ConfigEntry, own_ids: set[str], names: set[str]) -> Verdict:
        """What HA's live connection reports, or nothing at all."""
        atv = getattr(getattr(entry, "runtime_data", None), "atv", None)
        devices: list[Any] = []
        if atv is not None:
            try:
                devices = list(atv.audio.output_devices)
            except Exception:  # noqa: BLE001 — pyatv raises per protocol; none of it is fatal
                _LOGGER.debug("Reading %s's audio outputs failed", entry.title, exc_info=True)
        return verdict_from(devices, own_ids, names)

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
