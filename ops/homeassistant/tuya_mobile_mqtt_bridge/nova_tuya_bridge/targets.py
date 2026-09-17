"""Per-device target dataclasses and the freshness/availability helpers.

Moved verbatim out of `bridge.py`. Every MQTT topic and unique_id in the house
is built from these properties -- see the slug note in `constants.py`.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any

from .constants import BASE_TOPIC, TELEMETRY_MAX_STALE_SECONDS

@dataclass
class LightTarget:
    name: str
    dev_id: str
    dps: dict[str, Any]
    online: bool = True
    slug_name: str | None = None

    @property
    def slug(self) -> str:
        return self.slug_name or self.name.lower().replace(" ", "_")

    @property
    def state_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/state"

    @property
    def command_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/set"

    @property
    def brightness_state_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/brightness/state"

    @property
    def brightness_command_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/brightness/set"

    @property
    def rgb_state_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/rgb/state"

    @property
    def rgb_command_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/rgb/set"

    @property
    def availability_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/availability"

    @property
    def attributes_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/attributes"


@dataclass
class SensorTarget:
    name: str
    dev_id: str
    dps: dict[str, Any]
    device_update_ms: int | None
    max_stale_seconds: int
    online: bool = True
    slug_name: str | None = None

    @property
    def slug(self) -> str:
        # Pinned slug wins over the Tuya name, so renaming the device in the app
        # does not change its unique_ids. See SENSOR_TARGETS.
        return self.slug_name or self.name.lower().replace(" ", "_")

    @property
    def temperature_state_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/temperature/state"

    @property
    def humidity_state_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/humidity/state"

    @property
    def battery_state_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/battery/state"

    @property
    def availability_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/availability"

    @property
    def attributes_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/attributes"


@dataclass
class ClimateTarget:
    name: str
    dev_id: str
    dps: dict[str, Any]
    device_update_ms: int | None = None
    max_stale_seconds: int = TELEMETRY_MAX_STALE_SECONDS
    online: bool = True

    @property
    def slug(self) -> str:
        return self.name.lower().replace(" ", "_")

    @property
    def mode_command_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/mode/set"

    @property
    def mode_state_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/mode/state"

    @property
    def power_command_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/power/set"

    @property
    def temperature_command_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/temperature/set"

    @property
    def temperature_state_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/temperature/state"

    @property
    def current_temperature_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/current_temperature/state"

    @property
    def availability_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/availability"

    @property
    def attributes_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/attributes"


@dataclass
class PlugLightTarget:
    name: str
    dev_id: str
    dps: dict[str, Any]
    dp_key: str
    device_name: str | None = None
    suggested_area: str | None = None
    online: bool = True
    slug_name: str | None = None

    @property
    def slug(self) -> str:
        return self.slug_name or self.name.lower().replace(" ", "_")

    @property
    def state_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/state"

    @property
    def command_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/set"

    @property
    def availability_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/availability"


@dataclass
class HeaterSwitchTarget:
    name: str
    dev_id: str
    dps: dict[str, Any]
    dp_key: str
    temperature_dp: str
    temperature_divisor: float
    humidity_dp: str
    humidity_divisor: float
    device_update_ms: int | None = None
    max_stale_seconds: int = TELEMETRY_MAX_STALE_SECONDS
    suggested_area: str | None = None
    online: bool = True
    # Report freshness gates the two onboard SENSORS only, never the switch.
    # An idle wall switch has no reason to push a datapoint every few minutes,
    # so folding freshness into `online` made a healthy heater flap unavailable
    # between reports -- and an unavailable switch cannot be commanded OFF.
    telemetry_fresh: bool = True
    slug_name: str | None = None

    @property
    def slug(self) -> str:
        return self.slug_name or self.name.lower().replace(" ", "_")

    @property
    def state_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/state"

    @property
    def command_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/set"

    @property
    def temperature_state_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/temperature/state"

    @property
    def humidity_state_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/humidity/state"

    @property
    def availability_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/availability"

    @property
    def telemetry_availability_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/telemetry/availability"

    @property
    def attributes_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/attributes"


@dataclass
class EnergyPlugTarget:
    name: str
    dev_id: str
    dps: dict[str, Any]
    dp_key: str
    current_dp: str
    power_dp: str
    voltage_dp: str
    device_name: str | None = None
    suggested_area: str | None = None
    online: bool = True
    slug_name: str | None = None

    @property
    def slug(self) -> str:
        return self.slug_name or self.name.lower().replace(" ", "_")

    @property
    def state_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/state"

    @property
    def command_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/set"

    @property
    def power_state_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/power/state"

    @property
    def current_state_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/current/state"

    @property
    def voltage_state_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/voltage/state"

    @property
    def availability_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.slug}/availability"


TuyaTarget = (
    LightTarget | SensorTarget | ClimateTarget | PlugLightTarget | HeaterSwitchTarget | EnergyPlugTarget
)


def tuya_device_online(dev: dict[str, Any]) -> bool:
    # Some Tuya mobile responses omit isOnline for passive sensors while still
    # carrying fresh DPS values.
    return dev.get("isOnline") is not False


def tuya_sensor_data_fresh(dev: dict[str, Any], max_stale_seconds: int) -> bool:
    try:
        update_seconds = float(dev["dpMaxTime"]) / 1000
    except (KeyError, TypeError, ValueError):
        return False
    age_seconds = time.time() - update_seconds
    return -60 <= age_seconds <= max_stale_seconds


def source_report_attributes(device_update_ms: int | None) -> str:
    try:
        reported_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(float(device_update_ms) / 1000))
    except (TypeError, ValueError, OSError):
        reported_at = None
    return json.dumps({"source_reported_at": reported_at}, separators=(",", ":"))

