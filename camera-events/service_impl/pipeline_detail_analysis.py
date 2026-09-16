"""Pipeline mixin: the detail (Moondream) analysis pass for a single event.

Split from service.py; see service.py for the module-level overview.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from core import Box, evaluate_policy, point_distance
from .constants import LOG, MOONDREAM_MODEL, POLICY
from .helpers import utc_now
from .store import STORE


class PipelineDetailAnalysisMixin:
    def detail_event(self, row: sqlite3.Row) -> None:
        from PIL import Image
        frames = json.loads(row["evidence_json"])
        answers: list[str] = []
        model = self.load_detail_model()
        prompt = (
            "Describe only observable activity in this daytime security-camera frame. "
            "Mention people, cats, dogs, other non-bird animals, packages, road behavior, whether a dog and person move together, "
            "and any observable touching, reaching, chasing, following, waiting, damage, dumping, fighting, or interaction with a cat or black ute. "
            "Do not infer identity or intent. Distinguish an observed action from an unclear possibility. Use 'unclear' when uncertain."
        )
        frame_paths: list[Path] = []
        selected_frames = frames if len(frames) <= 2 else [frames[0], frames[-1]]
        for evidence in selected_frames:
            path = Path(evidence["frame"])
            if path.exists():
                frame_paths.append(path)
                result = model.query(
                    Image.open(path).convert("RGB"),
                    prompt,
                    settings={"max_tokens": 96, "temperature": 0.1, "variant": None},
                )
                answers.append(str(result.get("answer", result) if isinstance(result, dict) else result))
        text = " ".join(answers).strip()
        lower = text.lower()
        labels = json.loads(row["labels_json"])
        if any(word in lower for word in ("package", "parcel", "delivery", "placing an item", "leaves an item")):
            labels.append("possible_delivery")
        for phrase, label in (
            ("walking", "walking"), ("running", "running"), ("waiting", "waiting"),
            ("standing", "standing"), ("carrying", "carrying"), ("placing", "placing_item"),
            ("crouch", "crouching"), ("fallen", "person_fallen"), ("lying in the road", "person_fallen"),
            ("walking a dog", "dog_walking"), ("chasing", "chasing"), ("being chased", "being_chased"),
        ):
            if phrase in lower:
                labels.append(label)
        if "person" in labels and any(zone in json.loads(row["zones_json"]) for zone in ("front_path", "gate_entry", "rear_laneway")):
            labels.append("possible_visitor")
        if "vehicle_proximity" in labels and any(word in lower for word in ("touch", "door", "interact", "reaching", "beside the vehicle")):
            labels.append("possible_vehicle_interaction")
        if "person" in labels and "road" in json.loads(row["zones_json"]) and any(word in lower for word in ("standing", "waiting", "fallen", "lying", "stopped")):
            labels.append("unusual_road_behavior")
        if "person" in labels and any(word in lower for word in ("waiting", "standing still", "stopped", "pausing", "lingering")):
            labels.append("person_pausing_outside")
        if "person" in labels and any(word in lower for word in ("damage", "vandal", "dumping", "throwing rubbish", "harass", "threaten", "fighting", "prowling", "trying a door")):
            labels.append("possible_antisocial_behavior")
        if "person_cat_proximity" in labels and any(word in lower for word in ("touch", "reach", "pick up", "grab", "chase", "follow", "interact", "approach the cat")):
            labels.append("possible_person_cat_interaction")
        if "dog" in labels and "cat" in labels and any(word in lower for word in ("chasing", "attack", "fight", "lunging")):
            labels.append("possible_animal_attack")

        if "dog" in labels:
            group_distance = float(POLICY.get("thresholds", {}).get("groupDistance", 0.25))
            dog_frames = 0
            grouped_frames = 0
            for evidence in frames:
                frame_subjects = evidence.get("subjects", [])
                dogs = [Box(*item["box"]) for item in frame_subjects if item.get("class") == "dog"]
                people = [Box(*item["box"]) for item in frame_subjects if item.get("class") == "person"]
                if dogs:
                    dog_frames += 1
                if any(point_distance(dog.centre, person.centre) <= group_distance for dog in dogs for person in people):
                    grouped_frames += 1
            text_supports_group = any(phrase in lower for phrase in ("walking a dog", "on a leash", "moving together", "accompanied by"))
            if grouped_frames >= 2 and grouped_frames >= max(1, dog_frames // 2) and text_supports_group:
                labels.append("dog_accompanied")
            else:
                labels.append("dog_unaccompanied")
        subjects = json.loads(row["subjects_json"])
        if "cat" in labels:
            identity = self.reference_identity("cat", frame_paths)
            if identity:
                name, confidence = identity
                labels.append("household_cat_candidate")
                for subject in subjects:
                    if subject.get("class") == "cat":
                        subject.update({"identity": name, "identityConfidence": confidence, "identityTentative": True})
                text = f"Possible household cat {name} ({confidence:.0%} visual match). {text}"
        vehicle_match = self.vehicle_identity(frames) if any(
            subject.get("class") in {"car", "truck", "bus", "motorcycle"} for subject in subjects
        ) else None
        if vehicle_match is None and "vehicle_proximity" in labels:
            legacy_match = self.reference_identity("ute", frame_paths)
            if legacy_match:
                vehicle_match = (legacy_match[0], legacy_match[1], True)
        if vehicle_match:
            vehicle_name, vehicle_confidence, legacy_ute = vehicle_match
            labels.append("known_vehicle_candidate")
            if legacy_ute:
                labels.append("black_ute_candidate")
            for subject in subjects:
                if subject.get("class") in {"car", "truck", "bus", "motorcycle"}:
                    subject.update({"identity": vehicle_name, "identityConfidence": vehicle_confidence, "identityTentative": True})
            text = f"Possible known vehicle {vehicle_name} ({vehicle_confidence:.0%} visual match). {text}"

        owner_match = self.owner_identity(frames) if "person" in labels else None
        owner_present = owner_match is not None
        if owner_match:
            owner_name, owner_confidence = owner_match
            labels.append("owner_present")
            for subject in subjects:
                if subject.get("class") == "person":
                    subject.update({"identity": owner_name, "identityConfidence": owner_confidence, "identityTentative": False})
        labels = sorted(set(labels))
        zones = json.loads(row["zones_json"])
        decision = evaluate_policy(POLICY, labels, zones, owner_present=owner_present)
        if not decision["retain"]:
            LOG.info("event %s discarded by private policy: labels=%s zones=%s", row["id"], labels, zones)
            STORE.delete(row["id"])
            return
        priority = decision["priority"]
        summary = text[:1200] if text else row["summary"]
        title = next((label.replace("_", " ").title() for label in (
            "possible_animal_attack", "cat_in_road", "dog_on_property", "dog_unaccompanied",
            "possible_person_cat_interaction", "possible_vehicle_interaction", "vehicle_stopped_at_house",
            "possible_antisocial_behavior", "person_pausing_outside", "unusual_road_behavior",
        ) if label in labels), row["title"])
        behavior_confidence = 0.8 if any(label.startswith("possible_") or label in {"person_pausing_outside", "unusual_road_behavior"} for label in labels) else None
        with STORE.lock:
            STORE.connection.execute(
                """UPDATE events SET status='analysed',updated_at=?,priority=?,title=?,summary=?,labels_json=?,subjects_json=?,
                   detail_model=?,detail_error=NULL,retained=1,retained_reason=?,alert_reason=?,behavior_confidence=?,
                   owner_present=?,policy_version=? WHERE id=?""",
                (
                    utc_now(), priority, title, summary, json.dumps(labels), json.dumps(subjects), MOONDREAM_MODEL,
                    ",".join(decision["reasons"]), ",".join(decision["alertReasons"]) or None,
                    behavior_confidence, int(owner_present), int(POLICY.get("version", 1)), row["id"],
                ),
            )
            STORE.connection.commit()
        if decision["alert"]:
            self.notify(row["id"], title, summary)

