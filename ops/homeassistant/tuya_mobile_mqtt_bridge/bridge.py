#!/usr/bin/env python3
from __future__ import annotations

import colorsys
import hashlib
import hmac
import json
import logging
import os
import signal
import threading
import time
from dataclasses import dataclass
from typing import Any

import paho.mqtt.client as mqtt
import requests

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
TARGET_NAMES = (
    LIGHT_TARGET_NAMES
    + list(SENSOR_TARGETS)
    + CLIMATE_TARGET_NAMES
    + list(PLUG_LIGHT_TARGETS)
    + list(HEATER_SWITCH_TARGETS)
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


TuyaTarget = LightTarget | SensorTarget | ClimateTarget | PlugLightTarget | HeaterSwitchTarget


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


class TuyaMobileApi:
    def __init__(self, email: str, password: str) -> None:
        self.endpoint = "https://a1.tuyaus.com/api.json"
        self.email = email
        self.password = password
        self.country_code = ""
        self.session = requests.Session()
        self.sid: str | None = None

    def login(self) -> None:
        token_info = self._api(
            "tuya.m.user.email.token.create",
            {"countryCode": self.country_code, "email": self.email},
            requires_sid=False,
        )
        login_info = self._api(
            "tuya.m.user.email.password.login",
            {
                "countryCode": self.country_code,
                "email": self.email,
                "ifencrypt": 1,
                "options": '{"group": 1}',
                "passwd": self._enc_password(
                    token_info["publicKey"],
                    token_info["exponent"],
                    self.password,
                ),
                "token": token_info["token"],
            },
            requires_sid=False,
        )
        self.sid = login_info["sid"]
        LOG.info("Logged into Tuya mobile API")

    def list_targets(self) -> dict[str, TuyaTarget]:
        targets: dict[str, TuyaTarget] = {}
        slug_counts: dict[str, int] = {}
        for group in self._api("tuya.m.location.list"):
            for dev in self._api(
                "tuya.m.my.group.device.list",
                extra_params={"gid": str(group["groupId"])},
            ):
                name = dev.get("name")
                if name in LIGHT_TARGET_NAMES:
                    base_slug = name.lower().replace(" ", "_")
                    slug_counts[base_slug] = slug_counts.get(base_slug, 0) + 1
                    occurrence = slug_counts[base_slug]
                    slug = base_slug if occurrence == 1 else f"{base_slug}_{occurrence}"
                    display_name = name if occurrence == 1 else f"{name} {occurrence}"
                    target = LightTarget(
                        name=display_name,
                        dev_id=dev["devId"],
                        dps=dict(dev.get("dps") or {}),
                        online=tuya_device_online(dev),
                        slug_name=slug,
                    )
                    targets[target.slug] = target
                elif name in SENSOR_TARGETS:
                    spec = SENSOR_TARGETS[name]
                    if dev.get("devId") != spec["dev_id"]:
                        LOG.error(
                            "Refusing unexpected Tuya device named %s: %s",
                            name,
                            dev.get("devId"),
                        )
                        continue
                    target = SensorTarget(
                        name=name,
                        dev_id=dev["devId"],
                        dps=dict(dev.get("dps") or {}),
                        device_update_ms=dev.get("dpMaxTime"),
                        max_stale_seconds=spec["max_stale_seconds"],
                        online=(
                            tuya_device_online(dev)
                            and tuya_sensor_data_fresh(dev, spec["max_stale_seconds"])
                        ),
                        slug_name=spec["slug"],
                    )
                    targets[target.slug] = target
                elif name in CLIMATE_TARGET_NAMES:
                    target = ClimateTarget(
                        name=name,
                        dev_id=dev["devId"],
                        dps=dict(dev.get("dps") or {}),
                        device_update_ms=dev.get("dpMaxTime"),
                        online=tuya_device_online(dev) and tuya_sensor_data_fresh(dev, TELEMETRY_MAX_STALE_SECONDS),
                    )
                    targets[target.slug] = target
                elif name in HEATER_SWITCH_TARGETS:
                    spec = HEATER_SWITCH_TARGETS[name]
                    target = HeaterSwitchTarget(
                        name=name,
                        dev_id=dev["devId"],
                        dps=dict(dev.get("dps") or {}),
                        dp_key=spec["dp"],
                        temperature_dp=spec["temperature_dp"],
                        temperature_divisor=spec["temperature_divisor"],
                        humidity_dp=spec["humidity_dp"],
                        humidity_divisor=spec["humidity_divisor"],
                        device_update_ms=dev.get("dpMaxTime"),
                        suggested_area=spec.get("suggested_area"),
                        online=tuya_device_online(dev),
                        telemetry_fresh=tuya_sensor_data_fresh(dev, TELEMETRY_MAX_STALE_SECONDS),
                        slug_name=spec["slug"],
                    )
                    targets[target.slug] = target
                elif name in PLUG_LIGHT_TARGETS:
                    spec = PLUG_LIGHT_TARGETS[name]
                    target = PlugLightTarget(
                        name=spec["name"],
                        dev_id=dev["devId"],
                        dps=dict(dev.get("dps") or {}),
                        dp_key=spec["dp"],
                        device_name=name,
                        suggested_area=spec.get("suggested_area"),
                        online=tuya_device_online(dev),
                        slug_name=spec["slug"],
                    )
                    targets[target.slug] = target
        return targets

    def publish_dps(self, dev_id: str, dps: dict[str, Any]) -> bool:
        result = self._api("tuya.m.device.dp.publish", {"devId": dev_id, "dps": dps})
        return bool(result)

    def _api(
        self,
        action: str,
        payload: dict[str, Any] | None = None,
        extra_params: dict[str, str] | None = None,
        requires_sid: bool = True,
    ) -> Any:
        params: dict[str, str] = {
            "a": action,
            "clientId": TUYA_CLIENT_ID,
            "v": TUYA_API_VERSION,
            "time": str(int(time.time())),
            **(extra_params or {}),
        }
        if requires_sid:
            if self.sid is None:
                raise InvalidUserSession("not logged in")
            params["sid"] = self.sid
        data: dict[str, str] = {}
        if payload is not None:
            data["postData"] = json.dumps(payload, separators=(",", ":"))
        params["sign"] = self._sign({**params, **data})
        response = self.session.post(
            self.endpoint,
            params=params,
            data=data,
            headers={"User-Agent": TUYA_USER_AGENT},
            timeout=25,
        )
        response.raise_for_status()
        return self._handle(response.json())

    def _sign(self, data: dict[str, str]) -> str:
        str_to_sign = ""
        for key in sorted(data.keys()):
            if key == "gid":
                continue
            value = self._mobile_hash(data[key]) if key == "postData" else data[key]
            str_to_sign += ("||" if str_to_sign else "") + key + "=" + value
        return hmac.new(TUYA_SECRET.encode(), str_to_sign.encode(), hashlib.sha256).hexdigest()

    @staticmethod
    def _mobile_hash(data: str) -> str:
        prehash = hashlib.md5(data.encode()).hexdigest()
        return prehash[8:16] + prehash[0:8] + prehash[24:32] + prehash[16:24]

    @staticmethod
    def _handle(result: dict[str, Any]) -> Any:
        if result.get("success"):
            return result.get("result")
        code = result.get("errorCode") or result.get("code") or "UNKNOWN"
        msg = result.get("errorMsg") or result.get("msg") or "Tuya API error"
        if code == "USER_SESSION_INVALID":
            raise InvalidUserSession(msg)
        raise TuyaError(f"{msg} ({code})")

    @staticmethod
    def _plain_rsa_encrypt(modulus: str, exponent: str, message: bytes) -> bytes:
        message_int = int.from_bytes(message, "big")
        enc_message_int = pow(message_int, int(exponent), int(modulus))
        return enc_message_int.to_bytes(256, "big")

    def _enc_password(self, modulus: str, exponent: str, password: str) -> str:
        passwd_hash = hashlib.md5(password.encode("utf8")).hexdigest().encode("utf8")
        return self._plain_rsa_encrypt(modulus, exponent, passwd_hash).hex()


class Bridge:
    def __init__(self) -> None:
        self.api = TuyaMobileApi(os.environ["TUYA_EMAIL"], os.environ["TUYA_PASSWORD"])
        self.targets: dict[str, TuyaTarget] = {}
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        # A command-level DEVICE_OFFLINE result is stronger evidence than an
        # omitted isOnline flag. Keep the target unavailable until Tuya shows a
        # newer device report, rather than flipping it online every poll.
        self.offline_latches: dict[str, int | None] = {}
        self.mqtt = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id="tuya-mobile-mqtt-bridge",
        )
        self.mqtt.on_connect = self.on_connect
        self.mqtt.on_message = self.on_message

    def run(self) -> None:
        signal.signal(signal.SIGTERM, lambda *_: self.stop_event.set())
        signal.signal(signal.SIGINT, lambda *_: self.stop_event.set())
        self.login_and_sync()
        self.mqtt.connect(MQTT_HOST, MQTT_PORT, 60)
        self.mqtt.loop_start()
        try:
            while not self.stop_event.wait(POLL_SECONDS):
                self.safe_sync()
        finally:
            for target in self.targets.values():
                self.mqtt.publish(target.availability_topic, "offline", retain=True)
                if isinstance(target, HeaterSwitchTarget):
                    self.mqtt.publish(target.telemetry_availability_topic, "offline", retain=True)
            self.mqtt.loop_stop()
            self.mqtt.disconnect()

    def login_and_sync(self) -> None:
        self.api.login()
        self.targets = self.api.list_targets()
        found = {
            target.device_name if isinstance(target, PlugLightTarget) and target.device_name else target.name
            for target in self.targets.values()
        }
        missing = sorted(set(TARGET_NAMES) - found)
        if missing:
            LOG.warning("Missing Tuya devices in mobile API: %s", ", ".join(missing))
        for target in self.targets.values():
            self.publish_discovery(target)
            self.publish_state(target)

    def safe_sync(self) -> None:
        try:
            with self.lock:
                self.targets = self.api.list_targets()
                for target in self.targets.values():
                    latched_at = self.offline_latches.get(target.dev_id)
                    if target.dev_id not in self.offline_latches:
                        continue
                    current_at = getattr(target, "device_update_ms", None)
                    if current_at is not None and (latched_at is None or current_at > latched_at):
                        self.offline_latches.pop(target.dev_id, None)
                    else:
                        target.online = False
                for target in self.targets.values():
                    self.publish_discovery(target)
                    self.publish_state(target)
        except InvalidUserSession:
            LOG.info("Tuya session expired; logging in again")
            self.login_and_sync()
        except Exception:
            LOG.exception("State sync failed")

    def on_connect(
        self,
        client: mqtt.Client,
        userdata: Any,
        flags: Any,
        reason_code: Any,
        properties: Any | None = None,
    ) -> None:
        LOG.info("Connected to MQTT: %s", reason_code)
        for target in self.targets.values():
            if isinstance(target, LightTarget):
                client.subscribe(target.command_topic)
                client.subscribe(target.brightness_command_topic)
                client.subscribe(target.rgb_command_topic)
            elif isinstance(target, (PlugLightTarget, HeaterSwitchTarget)):
                client.subscribe(target.command_topic)
            elif isinstance(target, ClimateTarget):
                client.subscribe(target.power_command_topic)
                client.subscribe(target.mode_command_topic)
                client.subscribe(target.temperature_command_topic)
            self.publish_discovery(target)
            self.publish_state(target)

    def on_message(self, client: mqtt.Client, userdata: Any, msg: mqtt.MQTTMessage) -> None:
        payload = msg.payload.decode(errors="replace").strip()
        light = next(
            (
                t
                for t in self.targets.values()
                if isinstance(t, LightTarget)
                if msg.topic in {t.command_topic, t.brightness_command_topic, t.rgb_command_topic}
            ),
            None,
        )
        climate = next(
            (
                t
                for t in self.targets.values()
                if isinstance(t, ClimateTarget)
                if msg.topic
                in {t.power_command_topic, t.mode_command_topic, t.temperature_command_topic}
            ),
            None,
        )
        plug = next(
            (
                t
                for t in self.targets.values()
                if isinstance(t, PlugLightTarget)
                if msg.topic == t.command_topic
            ),
            None,
        )
        heater = next(
            (
                t
                for t in self.targets.values()
                if isinstance(t, HeaterSwitchTarget)
                if msg.topic == t.command_topic
            ),
            None,
        )
        target = light or climate or plug or heater
        if not target:
            return
        try:
            with self.lock:
                if isinstance(target, LightTarget):
                    if msg.topic == target.command_topic:
                        state = payload.upper() == "ON"
                        self.api.publish_dps(target.dev_id, {"20": state})
                        target.dps["20"] = state
                    elif msg.topic == target.brightness_command_topic:
                        brightness = max(1, min(255, int(payload)))
                        tuya_brightness = max(10, min(1000, round(brightness / 255 * 1000)))
                        if target.dps.get("21") == "colour":
                            colour = self.tuya_colour_value(target.dps.get("24"))
                            colour = f"{colour[:8]}{tuya_brightness:04x}"
                            update = {"20": True, "24": colour}
                            target.dps["24"] = colour
                        else:
                            update = {"20": True, "22": tuya_brightness}
                            target.dps["22"] = tuya_brightness
                        self.api.publish_dps(target.dev_id, update)
                        target.dps["20"] = True
                    elif msg.topic == target.rgb_command_topic:
                        red, green, blue = (
                            max(0, min(255, int(part.strip())))
                            for part in payload.split(",", 2)
                        )
                        hue, saturation, _ = colorsys.rgb_to_hsv(red / 255, green / 255, blue / 255)
                        current = self.tuya_colour_value(target.dps.get("24"))
                        current_value = int(current[8:12], 16)
                        colour = (
                            f"{round(hue * 360):04x}"
                            f"{round(saturation * 1000):04x}"
                            f"{current_value:04x}"
                        )
                        update = {"20": True, "21": "colour", "24": colour}
                        self.api.publish_dps(target.dev_id, update)
                        target.dps.update(update)
                elif isinstance(target, PlugLightTarget):
                    state = payload.upper() == "ON"
                    self.api.publish_dps(target.dev_id, {target.dp_key: state})
                    target.dps[target.dp_key] = state
                elif isinstance(target, HeaterSwitchTarget):
                    state = payload.upper() == "ON"
                    # Setting the power datapoint clears dp9 as a side effect.
                    # Restore it when switching off so the appliance is left in
                    # the state it shipped in rather than a half-configured one.
                    # Write ONLY the power datapoint. We used to also send
                    # dp9=True on every turn-off, on the cosmetic assumption
                    # that dp2 "cleared" it and it wanted restoring. That was
                    # guesswork about an unlabelled register on a product Tuya
                    # publishes no schema for, and it changed device state the
                    # owner had deliberately set (the Tuya-side mode flipped
                    # from manual to auto). Never write a datapoint we cannot
                    # name.
                    update: dict[str, Any] = {target.dp_key: state}
                    self.api.publish_dps(target.dev_id, update)
                    target.dps.update(update)
                elif isinstance(target, ClimateTarget):
                    if msg.topic == target.temperature_command_topic:
                        temperature = int(round(float(payload)))
                        self.api.publish_dps(target.dev_id, {"3": temperature})
                        target.dps["3"] = temperature
                    else:
                        # power_command_topic ("ON"/"OFF") and mode_command_topic
                        # ("heat"/"off") both reduce to the heater's dp1 switch.
                        power = payload.upper() == "ON" or payload.lower() == "heat"
                        self.api.publish_dps(target.dev_id, {"1": power})
                        target.dps["1"] = power
                self.publish_state(target)
        except InvalidUserSession:
            LOG.info("Tuya session expired during command; retrying once")
            self.api.login()
            self.on_message(client, userdata, msg)
        except Exception as error:
            LOG.exception("Command failed for %s", target.name)
            if "DEVICE_OFFLINE" in str(error).upper() or "DEVICE OFFLINE" in str(error).upper():
                self.offline_latches[target.dev_id] = getattr(target, "device_update_ms", None)
            target.online = False
            self.mqtt.publish(target.availability_topic, "offline", retain=True)

    def publish_discovery(self, target: TuyaTarget) -> None:
        if isinstance(target, SensorTarget):
            self.publish_sensor_discovery(target)
            return
        if isinstance(target, ClimateTarget):
            self.publish_climate_discovery(target)
            return
        if isinstance(target, PlugLightTarget):
            self.publish_plug_light_discovery(target)
            return
        if isinstance(target, HeaterSwitchTarget):
            self.publish_heater_switch_discovery(target)
            return

        config = {
            "name": target.name,
            "unique_id": f"nova_tuya_mobile_{target.slug}",
            "default_entity_id": f"light.tuya_mobile_{target.slug}",
            "command_topic": target.command_topic,
            "state_topic": target.state_topic,
            "payload_on": "ON",
            "payload_off": "OFF",
            "brightness_command_topic": target.brightness_command_topic,
            "brightness_state_topic": target.brightness_state_topic,
            "brightness_scale": 255,
            "rgb_command_topic": target.rgb_command_topic,
            "rgb_state_topic": target.rgb_state_topic,
            "availability_topic": target.availability_topic,
            "payload_available": "online",
            "payload_not_available": "offline",
            "device": {
                "identifiers": [f"tuya_mobile_{target.dev_id}"],
                "name": target.name,
                "manufacturer": "Tuya",
                "model": "Mobile cloud bridge",
            },
            "origin": {"name": "Nova Tuya mobile bridge", "sw": "1.0"},
        }
        topic = f"{DISCOVERY_PREFIX}/light/tuya_mobile_{target.slug}/config"
        self.mqtt.publish(topic, json.dumps(config, separators=(",", ":")), retain=True)

    def publish_plug_light_discovery(self, target: PlugLightTarget) -> None:
        # An on/off light (no brightness) backed by a smart-socket datapoint.
        # `name: None` makes the entity take the device name ("Neon lights")
        # instead of doubling it.
        config = {
            "name": None,
            "unique_id": f"nova_tuya_mobile_{target.slug}",
            "default_entity_id": f"light.tuya_mobile_{target.slug}",
            "command_topic": target.command_topic,
            "state_topic": target.state_topic,
            "payload_on": "ON",
            "payload_off": "OFF",
            "availability_topic": target.availability_topic,
            "payload_available": "online",
            "payload_not_available": "offline",
            "device": {
                "identifiers": [f"tuya_mobile_{target.dev_id}"],
                "name": target.name,
                "manufacturer": "Tuya",
                "model": "Mobile cloud bridge",
                **({"suggested_area": target.suggested_area} if target.suggested_area else {}),
            },
            "origin": {"name": "Nova Tuya mobile bridge", "sw": "1.0"},
        }
        topic = f"{DISCOVERY_PREFIX}/light/tuya_mobile_{target.slug}/config"
        self.mqtt.publish(topic, json.dumps(config, separators=(",", ":")), retain=True)

    def publish_heater_switch_discovery(self, target: HeaterSwitchTarget) -> None:
        # A heating appliance with no setpoint: one switch plus the two onboard
        # sensors. `name: None` on the switch makes the entity take the device
        # name rather than doubling it.
        device = {
            "identifiers": [f"tuya_mobile_{target.dev_id}"],
            "name": target.name,
            "manufacturer": "Tuya",
            "model": "Mobile cloud bridge",
            **({"suggested_area": target.suggested_area} if target.suggested_area else {}),
        }
        common = {
            "availability_topic": target.availability_topic,
            "payload_available": "online",
            "payload_not_available": "offline",
            "json_attributes_topic": target.attributes_topic,
            "device": device,
            "origin": {"name": "Nova Tuya mobile bridge", "sw": "1.0"},
        }
        switch_config = {
            **common,
            "name": None,
            "unique_id": f"nova_tuya_mobile_{target.slug}",
            "default_entity_id": f"switch.tuya_mobile_{target.slug}",
            "command_topic": target.command_topic,
            "state_topic": target.state_topic,
            "payload_on": "ON",
            "payload_off": "OFF",
            "device_class": "switch",
        }
        self.mqtt.publish(
            f"{DISCOVERY_PREFIX}/switch/tuya_mobile_{target.slug}/config",
            json.dumps(switch_config, separators=(",", ":")),
            retain=True,
        )
        sensors = [
            ("temperature", target.temperature_state_topic, "Temperature", "temperature", "°C"),
            ("humidity", target.humidity_state_topic, "Humidity", "humidity", "%"),
        ]
        for suffix, state_topic, name, device_class, unit in sensors:
            config = {
                **common,
                # Sensors follow report freshness, not the switch: hours-old
                # numbers must go unavailable rather than sit on the dashboard
                # looking like a live room reading.
                "availability_topic": target.telemetry_availability_topic,
                "name": name,
                "unique_id": f"nova_tuya_mobile_{target.slug}_{suffix}",
                "default_entity_id": f"sensor.tuya_mobile_{target.slug}_{suffix}",
                "state_topic": state_topic,
                "device_class": device_class,
                "state_class": "measurement",
                "unit_of_measurement": unit,
            }
            self.mqtt.publish(
                f"{DISCOVERY_PREFIX}/sensor/tuya_mobile_{target.slug}_{suffix}/config",
                json.dumps(config, separators=(",", ":")),
                retain=True,
            )

    def publish_climate_discovery(self, target: ClimateTarget) -> None:
        config = {
            "name": target.name,
            "unique_id": f"nova_tuya_mobile_{target.slug}",
            "default_entity_id": f"climate.tuya_mobile_{target.slug}",
            "modes": ["off", "heat"],
            "mode_command_topic": target.mode_command_topic,
            "mode_state_topic": target.mode_state_topic,
            "power_command_topic": target.power_command_topic,
            "payload_on": "ON",
            "payload_off": "OFF",
            "temperature_command_topic": target.temperature_command_topic,
            "temperature_state_topic": target.temperature_state_topic,
            "current_temperature_topic": target.current_temperature_topic,
            "temperature_unit": "C",
            "min_temp": 15,
            "max_temp": 35,
            "temp_step": 1,
            "precision": 1.0,
            "availability_topic": target.availability_topic,
            "payload_available": "online",
            "payload_not_available": "offline",
            "json_attributes_topic": target.attributes_topic,
            "device": {
                "identifiers": [f"tuya_mobile_{target.dev_id}"],
                "name": target.name,
                "manufacturer": "Tuya",
                "model": "Mobile cloud bridge",
                "suggested_area": "Climate",
            },
            "origin": {"name": "Nova Tuya mobile bridge", "sw": "1.0"},
        }
        topic = f"{DISCOVERY_PREFIX}/climate/tuya_mobile_{target.slug}/config"
        self.mqtt.publish(topic, json.dumps(config, separators=(",", ":")), retain=True)

    def publish_sensor_discovery(self, target: SensorTarget) -> None:
        common = {
            "availability_topic": target.availability_topic,
            "payload_available": "online",
            "payload_not_available": "offline",
            "json_attributes_topic": target.attributes_topic,
            "device": {
                "identifiers": [f"tuya_mobile_{target.dev_id}"],
                "name": target.name,
                "manufacturer": "Tuya",
                "model": "Mobile cloud bridge",
            },
            "origin": {"name": "Nova Tuya mobile bridge", "sw": "1.0"},
        }
        sensors = [
            (
                "temperature",
                target.temperature_state_topic,
                "Temperature",
                "temperature",
                "measurement",
                "\u00b0C",
            ),
            (
                "humidity",
                target.humidity_state_topic,
                "Humidity",
                "humidity",
                "measurement",
                "%",
            ),
            (
                "battery",
                target.battery_state_topic,
                "Battery",
                "battery",
                "measurement",
                "%",
            ),
        ]
        for suffix, state_topic, name, device_class, state_class, unit in sensors:
            config = {
                **common,
                "name": name,
                "unique_id": f"nova_tuya_mobile_{target.slug}_{suffix}",
                "default_entity_id": f"sensor.tuya_mobile_{target.slug}_{suffix}",
                "state_topic": state_topic,
                "device_class": device_class,
                "state_class": state_class,
                "unit_of_measurement": unit,
            }
            topic = f"{DISCOVERY_PREFIX}/sensor/tuya_mobile_{target.slug}_{suffix}/config"
            self.mqtt.publish(topic, json.dumps(config, separators=(",", ":")), retain=True)

    @staticmethod
    def scaled_number(value: Any, divisor: float = 1) -> str | None:
        try:
            number = float(value) / divisor
        except (TypeError, ValueError):
            return None
        return f"{number:g}"

    @staticmethod
    def tuya_colour_value(value: Any) -> str:
        text = str(value or "").lower()
        if len(text) == 12:
            try:
                int(text, 16)
                return text
            except ValueError:
                pass
        return "000003e803e8"

    def publish_state(self, target: TuyaTarget) -> None:
        if isinstance(target, SensorTarget):
            self.publish_sensor_state(target)
            return
        if isinstance(target, ClimateTarget):
            self.publish_climate_state(target)
            return
        if isinstance(target, HeaterSwitchTarget):
            self.publish_heater_switch_state(target)
            return
        if isinstance(target, PlugLightTarget):
            is_on = bool(target.dps.get(target.dp_key))
            self.mqtt.publish(
                target.availability_topic, "online" if target.online else "offline", retain=True
            )
            self.mqtt.publish(target.state_topic, "ON" if is_on else "OFF", retain=True)
            return

        is_on = bool(target.dps.get("20"))
        colour = self.tuya_colour_value(target.dps.get("24"))
        raw_brightness = int(colour[8:12], 16) if target.dps.get("21") == "colour" else int(target.dps.get("22") or 1000)
        brightness = max(1, min(255, round(raw_brightness / 1000 * 255)))
        hue = min(360, int(colour[:4], 16)) / 360
        saturation = min(1000, int(colour[4:8], 16)) / 1000
        red, green, blue = colorsys.hsv_to_rgb(hue, saturation, 1)
        self.mqtt.publish(target.availability_topic, "online" if target.online else "offline", retain=True)
        self.mqtt.publish(target.state_topic, "ON" if is_on else "OFF", retain=True)
        self.mqtt.publish(target.brightness_state_topic, str(brightness), retain=True)
        self.mqtt.publish(
            target.rgb_state_topic,
            f"{round(red * 255)},{round(green * 255)},{round(blue * 255)}",
            retain=True,
        )

    def publish_sensor_state(self, target: SensorTarget) -> None:
        self.mqtt.publish(target.attributes_topic, source_report_attributes(target.device_update_ms), retain=True)
        self.mqtt.publish(target.availability_topic, "online" if target.online else "offline", retain=True)
        if not target.online:
            return
        values = [
            (target.temperature_state_topic, self.scaled_number(target.dps.get("1"), 10)),
            (target.humidity_state_topic, self.scaled_number(target.dps.get("2"))),
            (target.battery_state_topic, self.scaled_number(target.dps.get("4"))),
        ]
        for topic, value in values:
            if value is not None:
                self.mqtt.publish(topic, value, retain=True)

    def publish_heater_switch_state(self, target: HeaterSwitchTarget) -> None:
        self.mqtt.publish(target.attributes_topic, source_report_attributes(target.device_update_ms), retain=True)
        self.mqtt.publish(
            target.availability_topic, "online" if target.online else "offline", retain=True
        )
        telemetry_online = target.online and target.telemetry_fresh
        self.mqtt.publish(
            target.telemetry_availability_topic,
            "online" if telemetry_online else "offline",
            retain=True,
        )
        if not target.online:
            return
        is_on = bool(target.dps.get(target.dp_key))
        self.mqtt.publish(target.state_topic, "ON" if is_on else "OFF", retain=True)
        if not telemetry_online:
            return
        values = [
            (
                target.temperature_state_topic,
                self.scaled_number(target.dps.get(target.temperature_dp), target.temperature_divisor),
            ),
            (
                target.humidity_state_topic,
                self.scaled_number(target.dps.get(target.humidity_dp), target.humidity_divisor),
            ),
        ]
        for topic, value in values:
            if value is not None:
                self.mqtt.publish(topic, value, retain=True)

    def publish_climate_state(self, target: ClimateTarget) -> None:
        is_on = bool(target.dps.get("1"))
        self.mqtt.publish(target.attributes_topic, source_report_attributes(target.device_update_ms), retain=True)
        self.mqtt.publish(target.availability_topic, "online" if target.online else "offline", retain=True)
        if not target.online:
            return
        self.mqtt.publish(target.mode_state_topic, "heat" if is_on else "off", retain=True)
        target_temp = self.scaled_number(target.dps.get("3"))
        if target_temp is not None:
            self.mqtt.publish(target.temperature_state_topic, target_temp, retain=True)
        current_temp = self.scaled_number(target.dps.get("4"))
        if current_temp is not None:
            self.mqtt.publish(target.current_temperature_topic, current_temp, retain=True)


if __name__ == "__main__":
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    Bridge().run()
