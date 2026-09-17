"""Credentials, device target tables and error types for the Tuya bridge.

Moved verbatim out of `bridge.py`; see
`nova-ha-dashboard/specs/agent-token-footprint.md`. This module is the only
owner of the bridge's module-level state.
"""
from __future__ import annotations

import logging
import os

LOG = logging.getLogger("tuya_mobile_mqtt_bridge")
TUYA_USER_AGENT = "TY-UA=APP/Android/1.1.6/SDK/null"
TUYA_API_VERSION = "1.0"
TUYA_CLIENT_ID = "3fjrekuxank9eaej3gcx"
TUYA_SECRET = (
    "93:21:9F:C2:73:E2:20:0F:4A:DE:E5:F7:19:1D:C6:56:BA:2A:2D:7B:2F:F5:D2:"
    "4C:D5:5C:4B:61:55:00:1E:40_vay9g59g9g99qf3rtqptmc3emhkanwkx_"
    "aq7xvqcyqcnegvew793pqjmhv77rneqc"
)
LIGHT_TARGET_NAMES = ["Outside light", "Nook light", "Mirror light", "Hallway light", "TV light", "Kitchen light 2"]
# Standalone temperature/humidity pucks, keyed by their CURRENT Tuya device name.
#
# The name is only a lookup key and changes whenever the device is renamed in the
# Tuya app -- so the published `slug` is pinned separately and must NOT be
# "corrected" to match the name. Every MQTT topic and, more importantly, every
# unique_id is built from the slug (nova_tuya_mobile_<slug>_<suffix>), which is
# how Home Assistant recognises an entity it already knows. Re-slugging a renamed
# device mints fresh unique_ids, so HA creates a second set of entities and the
# ids it wanted are already taken -- they come back as ..._2 and every reference
# to them breaks.
#
# This puck was named "Lounge sensor" until 2026-08-08, when it was physically
# moved to the bedroom and renamed in Tuya. Its slug stays `lounge_sensor` for
# exactly the reason above; the display name and area are set in HA's registry,
# where they belong.
SENSOR_TARGETS = {
    "Bedroom sensor": {
        "slug": "lounge_sensor",
        "dev_id": "eb7da36c9c4d149965wfsk",
        # Battery pucks can be quiet for several minutes, but hours-old data is
        # not a room measurement. Stale data must make MQTT unavailable rather
        # than be republished forever as if it were live.
        "max_stale_seconds": 30 * 60,
    },
}
# Climate devices controlled over the Tuya cloud (fallback when a unit roams off
# Home Assistant's LAN subnet so tuya_local can't reach it). dps mapping for the
# "qn" panel heater: dp1=power(bool), dp3=target temp/SETPOINT(C), dp4=current/room temp(C).
# NOTE 2026-06-29: dp3/dp4 were verified transposed vs the Tuya app (app setpoint=dp3,
# room reading=dp4). Do NOT swap these back. Both the published state AND the temperature
# command below must use dp3 for the setpoint, dp4 for the room reading.
CLIMATE_TARGET_NAMES = ["Panel Heater"]
TELEMETRY_MAX_STALE_SECONDS = 10 * 60
# Smart sockets that power illumination, exposed over the cloud as on/off
# lights so they twin with their tuya_local entity (dashboard prefers the LAN
# twin and falls back to these). Keyed by the Tuya device name; dp is the
# socket's boolean switch datapoint.
PLUG_LIGHT_TARGETS = {
    "Cupboard": {"name": "Neon lights", "slug": "neon_lights", "dp": "1", "suggested_area": "Lounge"},
}
# Heating appliances that are a plain on/off switch with their own onboard
# climate sensors. Unlike CLIMATE_TARGET_NAMES these expose no setpoint at all,
# so they are published as a switch plus separate temperature/humidity sensors
# and the thermostat loop lives in Nova (see the dashboard's
# lib/bedroom-heater-control.ts), not in the appliance.
#
# dps mapping for the "wkcz" bedroom heater, established 2026-08-07 by
# observation rather than schema (the Tuya mobile API exposes no DP schema for
# this product):
#   dp2  = power switch (bool)   — verified by toggling; device switched.
#   dp13 = temperature, x100 C   — verified: fell 2401->2356 while idle, rose
#                                  2356->2392 within 25s of the element firing.
#   dp14 = relative humidity, x10 %.
# NOTE: dp13 sits in the appliance and reads high while the element runs. Nova
# never uses it as the bedroom room thermostat; the separate pinned puck is the
# only control input.
# NOTE: dp9 is NOT the switch. Setting dp2 clears dp9 as a side effect; dp9 is
# restored to True as part of turning the heater off.
HEATER_SWITCH_TARGETS = {
    "Bedroom heater": {
        "slug": "bedroom_heater",
        "dp": "2",
        "temperature_dp": "13",
        "temperature_divisor": 100,
        "humidity_dp": "14",
        "humidity_divisor": 10,
        "suggested_area": "Bedroom",
    },
}
# Energy-monitoring smart sockets. Published as a switch plus the three live
# electrical sensors the "cz" socket profile reports. See
# nova-ha-dashboard/specs/power-meters.md.
#
# dps mapping for the "cz" socket, confirmed 2026-09-14 against the already
# working Cupboard (SH-P02) whose HA sensors read 205 mA / 26.5 W / 239.9 V
# while its dps read 18=206, 19=256, 20=2408:
#   dp1  = power switch (bool)
#   dp18 = current, mA
#   dp19 = active power, x10 W
#   dp20 = voltage, x10 V
#
# dp17 ("add_ele", cumulative energy) is deliberately NOT published. Tuya does
# not publish a schema for these sockets, the unit differs between firmwares,
# and the counter resets without warning. Nova integrates kWh from the power
# sensor itself (lib/power.ts), so a mis-scaled cumulative counter would only
# be a second, wrong answer.
#
# These two sockets are the meters Nova must never leave switched off; the
# guard that enforces that lives in the dashboard (lib/power-meter-guard.ts),
# not here. The bridge's job is only to make them commandable.
ENERGY_PLUG_TARGETS = {
    "Washing machine": {
        "name": "Washing Machine",
        "slug": "washing_machine",
        "dp": "1",
        "current_dp": "18",
        "power_dp": "19",
        "voltage_dp": "20",
        "suggested_area": "Kitchen",
    },
    "Floating meter": {
        "name": "Floating Meter",
        "slug": "floating_meter",
        "dp": "1",
        "current_dp": "18",
        "power_dp": "19",
        "voltage_dp": "20",
        "suggested_area": "Lounge",
    },
}
TARGET_NAMES = (
    LIGHT_TARGET_NAMES
    + list(SENSOR_TARGETS)
    + CLIMATE_TARGET_NAMES
    + list(PLUG_LIGHT_TARGETS)
    + list(HEATER_SWITCH_TARGETS)
    + list(ENERGY_PLUG_TARGETS)
)
MQTT_HOST = os.getenv("MQTT_HOST", "127.0.0.1")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
BASE_TOPIC = os.getenv("BASE_TOPIC", "tuya_mobile_bridge")
DISCOVERY_PREFIX = os.getenv("DISCOVERY_PREFIX", "homeassistant")
POLL_SECONDS = int(os.getenv("POLL_SECONDS", "45"))


class TuyaError(RuntimeError):
    pass


class InvalidUserSession(TuyaError):
    pass
