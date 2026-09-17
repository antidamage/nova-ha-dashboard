"""The Tuya mobile cloud API client.

Moved verbatim out of `bridge.py`.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any

import requests

from .constants import (
    CLIMATE_TARGET_NAMES,
    ENERGY_PLUG_TARGETS,
    HEATER_SWITCH_TARGETS,
    LIGHT_TARGET_NAMES,
    LOG,
    PLUG_LIGHT_TARGETS,
    SENSOR_TARGETS,
    TELEMETRY_MAX_STALE_SECONDS,
    TUYA_API_VERSION,
    TUYA_CLIENT_ID,
    TUYA_SECRET,
    TUYA_USER_AGENT,
    InvalidUserSession,
    TuyaError,
)
from .targets import (
    ClimateTarget,
    EnergyPlugTarget,
    HeaterSwitchTarget,
    LightTarget,
    PlugLightTarget,
    SensorTarget,
    TuyaTarget,
    tuya_device_online,
    tuya_sensor_data_fresh,
)

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
                elif name in ENERGY_PLUG_TARGETS:
                    spec = ENERGY_PLUG_TARGETS[name]
                    target = EnergyPlugTarget(
                        name=spec["name"],
                        dev_id=dev["devId"],
                        dps=dict(dev.get("dps") or {}),
                        dp_key=spec["dp"],
                        current_dp=spec["current_dp"],
                        power_dp=spec["power_dp"],
                        voltage_dp=spec["voltage_dp"],
                        device_name=name,
                        suggested_area=spec.get("suggested_area"),
                        online=tuya_device_online(dev),
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

