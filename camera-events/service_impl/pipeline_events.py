"""Pipeline mixin: fast-pass event collection (observe / _refresh_active).

Split from service.py; see service.py for the module-level overview.
"""

from __future__ import annotations

import uuid
from typing import Any

import cv2
import numpy as np

from core import Box, point_distance, priority_for, vehicle_proximity
from .constants import DEFAULT_ZONES, EVENT_ROOT, LOG, POLICY
from .helpers import iso_time, zone_for, zones_for
from .store import STORE


class PipelineEventsMixin:
    def observe(self, frame: np.ndarray, timestamp: float, detections: list[dict[str, Any]]) -> None:
        settings = STORE.get_setting("analysis") or {}
        zones = settings.get("zones", DEFAULT_ZONES)
        resolved: list[dict[str, Any]] = []
        birds = 0
        vehicles: list[tuple[dict[str, Any], Box]] = []
        people: list[tuple[dict[str, Any], Box]] = []
        animals: list[tuple[dict[str, Any], Box]] = []
        for detection in detections:
            box = Box(*detection["box"])
            if detection["class"] == "bird":
                birds += 1
                continue
            zone = zone_for(box, zones)
            if zone is None:
                continue
            memberships = zones_for(box, zones)
            detection = {**detection, "zone": zone, "zones": memberships or ["unmapped"]}
            resolved.append(detection)
            if detection["class"] in {"car", "truck", "bus", "motorcycle"}:
                vehicles.append((detection, box))
            elif detection["class"] == "person":
                people.append((detection, box))
            elif detection["class"] not in {"bicycle"}:
                animals.append((detection, box))

        candidate_subjects = set(POLICY.get("candidateSubjects", ["person", "cat", "dog"]))
        meaningful = [item for item in resolved if item["class"] in candidate_subjects]
        black_ute_zones = set(POLICY.get("zones", {}).get("blackUte", []))
        person_in_black_ute_zone = any(black_ute_zones & set(person.get("zones", [])) for person, _ in people)
        vehicle_near = person_in_black_ute_zone or any(vehicle_proximity(person_box, vehicle_box) for _, person_box in people for _, vehicle_box in vehicles)
        near_animal = any(
            point_distance(cat_box.centre, dog_box.centre) < 0.16
            for cat, cat_box in animals if cat["class"] == "cat"
            for dog, dog_box in animals if dog["class"] == "dog"
        )
        thresholds = POLICY.get("thresholds", {})
        if vehicle_near:
            self.vehicle_proximity_since = self.vehicle_proximity_since or timestamp
        else:
            self.vehicle_proximity_since = None
        confirmed_vehicle_near = self.vehicle_proximity_since is not None and timestamp - self.vehicle_proximity_since >= float(thresholds.get("vehicleProximitySeconds", 2))

        frontage_zones = set(POLICY.get("zones", {}).get("frontage", []))
        frontage_vehicles = [(item, box) for item, box in vehicles if frontage_zones & set(item["zones"])]
        vehicle_stopped = False
        if frontage_vehicles:
            item, box = max(frontage_vehicles, key=lambda pair: pair[0]["confidence"])
            centre = box.centre
            state = self.road_vehicle_state
            if state is None or timestamp - state["last"] > 4:
                state = {"centre": centre, "last": timestamp, "moving": False, "stoppedSince": None}
            else:
                distance = point_distance(centre, state["centre"])
                if distance > 0.012:
                    state["moving"] = True
                    state["stoppedSince"] = None
                elif state["moving"]:
                    state["stoppedSince"] = state["stoppedSince"] or timestamp
                state["centre"] = centre
                state["last"] = timestamp
            self.road_vehicle_state = state
            vehicle_stopped = state["stoppedSince"] is not None and timestamp - state["stoppedSince"] >= float(thresholds.get("vehicleStopSeconds", 8))
        elif self.road_vehicle_state is not None and timestamp - self.road_vehicle_state["last"] > 4:
            self.road_vehicle_state = None

        if not meaningful and not confirmed_vehicle_near and not vehicle_stopped:
            return

        labels = {item["class"] for item in resolved}
        if confirmed_vehicle_near:
            labels.add("vehicle_proximity")
            if person_in_black_ute_zone:
                labels.add("black_ute_candidate")
        if near_animal:
            labels.add("animal_close_proximity")
        if vehicle_stopped:
            labels.add("vehicle_stopped_at_house")
        zone_ids = {zone for item in resolved for zone in item["zones"]}
        road_zones = set(POLICY.get("zones", {}).get("road", []))
        property_zones = set(POLICY.get("zones", {}).get("property", []))
        group_distance = float(thresholds.get("groupDistance", 0.25))
        if any(item["class"] == "cat" and road_zones & set(item["zones"]) for item in resolved):
            labels.add("cat_in_road")
        if any(item["class"] == "dog" and property_zones & set(item["zones"]) for item in resolved):
            labels.add("dog_on_property")
        dog_accompanied = any(
            point_distance(dog_box.centre, person_box.centre) <= group_distance
            for dog, dog_box in animals if dog["class"] == "dog"
            for _, person_box in people
        ) if any(item["class"] == "dog" for item, _ in animals) else False
        if "dog" in labels and not dog_accompanied:
            labels.add("dog_unaccompanied_candidate")
        if "cat" in labels and "person" in labels and any(
            point_distance(cat_box.centre, person_box.centre) <= 0.20
            for cat, cat_box in animals if cat["class"] == "cat"
            for _, person_box in people
        ):
            labels.add("person_cat_proximity")

        if self.active is None:
            event_id = uuid.uuid4().hex
            event_dir = EVENT_ROOT / event_id
            event_dir.mkdir(parents=True, exist_ok=True)
            thumbnail = event_dir / "thumbnail.jpg"
            cv2.imwrite(str(thumbnail), frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
            self.active = {
                "id": event_id, "start": timestamp, "last": timestamp,
                "startedAt": iso_time(timestamp), "zones": sorted(zone_ids), "labels": sorted(labels),
                "subjects": [], "evidence": [], "thumbnail": str(thumbnail), "lastEvidence": 0.0,
                "roadObservations": [],
            }
            self._refresh_active(resolved, frame, timestamp)
            STORE.create(self.active)
            LOG.info("event %s started: %s", event_id, sorted(labels))
        else:
            self.active["last"] = timestamp
            self.active["zones"] = sorted(set(self.active["zones"]) | zone_ids)
            self.active["labels"] = sorted(set(self.active["labels"]) | labels)
            self._refresh_active(resolved, frame, timestamp)
            STORE.update_collection(self.active)

    def _refresh_active(self, detections: list[dict[str, Any]], frame: np.ndarray, timestamp: float) -> None:
        assert self.active is not None
        subjects: dict[str, dict[str, Any]] = {item["class"]: item for item in self.active["subjects"]}
        for detection in detections:
            current = subjects.get(detection["class"])
            if current is None or detection["confidence"] > current["confidence"]:
                subjects[detection["class"]] = {
                    "class": detection["class"], "confidence": detection["confidence"],
                    "zone": detection["zone"], "box": detection["box"],
                }
            if detection["class"] == "person" and "road" in detection.get("zones", [detection["zone"]]):
                box = Box(*detection["box"])
                self.active["roadObservations"].append((timestamp, box.foot[0], box.foot[1]))
        self.active["subjects"] = sorted(subjects.values(), key=lambda item: item["class"])
        if timestamp - self.active["lastEvidence"] >= 4.0 and len(self.active["evidence"]) < 12:
            path = self.evidence_frame(self.active["id"], frame, timestamp)
            self.active["evidence"].append({
                "at": iso_time(timestamp), "frame": path,
                "subjects": [{"class": item["class"], "box": item["box"], "confidence": item["confidence"], "zones": item.get("zones", [item["zone"]])} for item in detections],
            })
            self.active["lastEvidence"] = timestamp
        zones = self.active["zones"]
        labels = self.active["labels"]
        self.active["priority"] = priority_for(labels, zones)
        noun = ", ".join(item["class"] for item in self.active["subjects"][:3]) or "activity"
        self.active["title"] = f"{noun.title()} detected"
        self.active["summary"] = f"Fast pass detected {noun} in {', '.join(zones)}. Detailed analysis pending."

