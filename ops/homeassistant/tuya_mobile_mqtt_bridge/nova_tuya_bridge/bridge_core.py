"""The `Bridge` class: lifecycle, login, polling and MQTT wiring.

Moved verbatim out of `bridge.py`. The discovery, command and state-publishing
halves live in sibling mixins; the method bodies are unchanged.
"""
from __future__ import annotations

import os
import signal
import threading

import paho.mqtt.client as mqtt

from .api import TuyaMobileApi
from .commands import CommandsMixin
from .constants import LOG, MQTT_HOST, MQTT_PORT, POLL_SECONDS, TARGET_NAMES, InvalidUserSession
from .discovery_climate import DiscoveryClimateMixin
from .discovery_lights import DiscoveryLightsMixin
from .state_publish import StatePublishMixin
from .targets import EnergyPlugTarget, HeaterSwitchTarget, PlugLightTarget, TuyaTarget


class Bridge(
    CommandsMixin,
    DiscoveryLightsMixin,
    DiscoveryClimateMixin,
    StatePublishMixin,
):
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
            target.device_name
            if isinstance(target, (PlugLightTarget, EnergyPlugTarget)) and target.device_name
            else target.name
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
