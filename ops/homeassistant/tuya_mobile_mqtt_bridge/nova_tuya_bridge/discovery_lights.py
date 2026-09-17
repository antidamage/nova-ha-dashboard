"""Home Assistant MQTT discovery payloads for lights and plugs.

Moved verbatim out of `bridge.py`; mixed into `Bridge` in `bridge_core.py`.
"""
from __future__ import annotations

import json

from .constants import DISCOVERY_PREFIX
from .targets import (
    ClimateTarget,
    EnergyPlugTarget,
    HeaterSwitchTarget,
    PlugLightTarget,
    SensorTarget,
    TuyaTarget,
)


class DiscoveryLightsMixin:
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
        if isinstance(target, EnergyPlugTarget):
            self.publish_energy_plug_discovery(target)
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

    def publish_energy_plug_discovery(self, target: EnergyPlugTarget) -> None:
        # An energy-monitoring socket: one switch plus power, current and
        # voltage. `name: None` on the switch makes the entity take the device
        # name rather than doubling it, as for the heater switch.
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
            "device_class": "outlet",
        }
        self.mqtt.publish(
            f"{DISCOVERY_PREFIX}/switch/tuya_mobile_{target.slug}/config",
            json.dumps(switch_config, separators=(",", ":")),
            retain=True,
        )
        sensors = [
            ("power", target.power_state_topic, "Power", "power", "W"),
            ("current", target.current_state_topic, "Current", "current", "mA"),
            ("voltage", target.voltage_state_topic, "Voltage", "voltage", "V"),
        ]
        for suffix, state_topic, name, device_class, unit in sensors:
            config = {
                **common,
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

