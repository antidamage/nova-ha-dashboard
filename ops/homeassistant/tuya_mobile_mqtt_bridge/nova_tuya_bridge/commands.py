"""MQTT connect/subscribe and inbound command handling for `Bridge`.

Moved verbatim out of `bridge.py`; mixed into `Bridge` in `bridge_core.py`.
"""
from __future__ import annotations

import colorsys
from typing import Any

import paho.mqtt.client as mqtt

from .constants import LOG, InvalidUserSession
from .targets import (
    ClimateTarget,
    EnergyPlugTarget,
    HeaterSwitchTarget,
    LightTarget,
    PlugLightTarget,
)


class CommandsMixin:
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
            elif isinstance(target, (PlugLightTarget, HeaterSwitchTarget, EnergyPlugTarget)):
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
        meter = next(
            (
                t
                for t in self.targets.values()
                if isinstance(t, EnergyPlugTarget)
                if msg.topic == t.command_topic
            ),
            None,
        )
        target = light or climate or plug or heater or meter
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
                elif isinstance(target, (PlugLightTarget, EnergyPlugTarget)):
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
