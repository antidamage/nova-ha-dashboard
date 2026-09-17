"""State publication onto MQTT for every target kind.

Moved verbatim out of `bridge.py`; mixed into `Bridge` in `bridge_core.py`.
"""
from __future__ import annotations

import colorsys
from typing import Any

from .targets import (
    ClimateTarget,
    EnergyPlugTarget,
    HeaterSwitchTarget,
    PlugLightTarget,
    SensorTarget,
    TuyaTarget,
    source_report_attributes,
)


class StatePublishMixin:
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
        if isinstance(target, EnergyPlugTarget):
            self.publish_energy_plug_state(target)
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

    def publish_energy_plug_state(self, target: EnergyPlugTarget) -> None:
        self.mqtt.publish(
            target.availability_topic, "online" if target.online else "offline", retain=True
        )
        if not target.online:
            return
        is_on = bool(target.dps.get(target.dp_key))
        self.mqtt.publish(target.state_topic, "ON" if is_on else "OFF", retain=True)
        values = [
            (target.power_state_topic, self.scaled_number(target.dps.get(target.power_dp), 10)),
            (target.current_state_topic, self.scaled_number(target.dps.get(target.current_dp))),
            (target.voltage_state_topic, self.scaled_number(target.dps.get(target.voltage_dp), 10)),
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

