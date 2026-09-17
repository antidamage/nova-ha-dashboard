"""Home Assistant MQTT discovery payloads for heaters, climate and sensors.

Moved verbatim out of `bridge.py`; mixed into `Bridge` in `bridge_core.py`.
"""
from __future__ import annotations

import json

from .constants import DISCOVERY_PREFIX
from .targets import ClimateTarget, HeaterSwitchTarget, SensorTarget


class DiscoveryClimateMixin:
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

