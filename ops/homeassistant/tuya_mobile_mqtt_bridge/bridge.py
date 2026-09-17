#!/usr/bin/env python3
"""Tuya mobile cloud -> MQTT bridge: entry point and public surface.

The container runs `python3 /app/bridge.py` with this directory mounted
read-only at /app, so this file keeps its path and its name. The body lives in
the `nova_tuya_bridge` package beside it -- moved there verbatim, see
`nova-ha-dashboard/specs/agent-token-footprint.md`. Every name this module used
to define is re-exported below, so anything importing `bridge` is unaffected.
"""
from __future__ import annotations

import logging
import os

from nova_tuya_bridge.api import TuyaMobileApi
from nova_tuya_bridge.bridge_core import Bridge
from nova_tuya_bridge.constants import (
    BASE_TOPIC,
    CLIMATE_TARGET_NAMES,
    DISCOVERY_PREFIX,
    ENERGY_PLUG_TARGETS,
    HEATER_SWITCH_TARGETS,
    LIGHT_TARGET_NAMES,
    LOG,
    MQTT_HOST,
    MQTT_PORT,
    PLUG_LIGHT_TARGETS,
    POLL_SECONDS,
    SENSOR_TARGETS,
    TARGET_NAMES,
    TELEMETRY_MAX_STALE_SECONDS,
    TUYA_API_VERSION,
    TUYA_CLIENT_ID,
    TUYA_SECRET,
    TUYA_USER_AGENT,
    InvalidUserSession,
    TuyaError,
)
from nova_tuya_bridge.targets import (
    ClimateTarget,
    EnergyPlugTarget,
    HeaterSwitchTarget,
    LightTarget,
    PlugLightTarget,
    SensorTarget,
    TuyaTarget,
    source_report_attributes,
    tuya_device_online,
    tuya_sensor_data_fresh,
)

__all__ = [
    "BASE_TOPIC",
    "Bridge",
    "CLIMATE_TARGET_NAMES",
    "ClimateTarget",
    "DISCOVERY_PREFIX",
    "ENERGY_PLUG_TARGETS",
    "EnergyPlugTarget",
    "HEATER_SWITCH_TARGETS",
    "HeaterSwitchTarget",
    "InvalidUserSession",
    "LIGHT_TARGET_NAMES",
    "LOG",
    "LightTarget",
    "MQTT_HOST",
    "MQTT_PORT",
    "PLUG_LIGHT_TARGETS",
    "POLL_SECONDS",
    "PlugLightTarget",
    "SENSOR_TARGETS",
    "SensorTarget",
    "TARGET_NAMES",
    "TELEMETRY_MAX_STALE_SECONDS",
    "TUYA_API_VERSION",
    "TUYA_CLIENT_ID",
    "TUYA_SECRET",
    "TUYA_USER_AGENT",
    "TuyaError",
    "TuyaMobileApi",
    "TuyaTarget",
    "source_report_attributes",
    "tuya_device_online",
    "tuya_sensor_data_fresh",
]


if __name__ == "__main__":
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    Bridge().run()
