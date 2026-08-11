import unittest

from core import Box, evaluate_policy, event_window_closed, normalized_crop_bounds, point_distance, point_in_polygon, priority_for, prompt_road_crossing, subject_gap_seconds, vehicle_proximity


class CameraEventCoreTests(unittest.TestCase):
    def test_point_distance_supports_runtime_proximity_rules(self):
        self.assertAlmostEqual(point_distance((0.1, 0.2), (0.4, 0.6)), 0.5)

    def test_normalized_crop_bounds_orders_clamps_and_rounds_outward(self):
        self.assertEqual(normalized_crop_bounds((0.8, -0.2, 0.2, 0.75), 100, 80), (20, 0, 80, 60))

    def test_normalized_crop_bounds_rejects_tiny_designations(self):
        with self.assertRaisesRegex(ValueError, "at least 32 pixels"):
            normalized_crop_bounds((0.1, 0.1, 0.11, 0.11), 1000, 600)

    def test_zone_uses_boundary_and_ground_point(self):
        polygon = [(0.1, 0.2), (0.9, 0.2), (0.9, 0.8), (0.1, 0.8)]
        self.assertTrue(point_in_polygon((0.5, 0.8), polygon))
        self.assertFalse(point_in_polygon((0.5, 0.9), polygon))

    def test_vehicle_proximity_catches_person_beside_vehicle(self):
        vehicle = Box(0.2, 0.3, 0.5, 0.55)
        beside = Box(0.49, 0.25, 0.58, 0.53)
        far = Box(0.75, 0.2, 0.82, 0.45)
        self.assertTrue(vehicle_proximity(beside, vehicle))
        self.assertFalse(vehicle_proximity(far, vehicle))

    def test_prompt_crossing_rejects_linger_and_reversal(self):
        prompt = [(0, 0.4, 0.18), (3, 0.4, 0.28), (6, 0.41, 0.42)]
        linger = [(0, 0.4, 0.18), (4, 0.4, 0.25), (9, 0.4, 0.25), (13, 0.4, 0.42)]
        reversal = [(0, 0.4, 0.18), (3, 0.4, 0.34), (5, 0.4, 0.27), (9, 0.4, 0.43)]
        self.assertTrue(prompt_road_crossing(prompt))
        self.assertFalse(prompt_road_crossing(linger))
        self.assertFalse(prompt_road_crossing(reversal))

    def test_priority(self):
        self.assertEqual(priority_for(["person"], ["far_footpath"]), "routine")
        self.assertEqual(priority_for(["person"], ["front_path"]), "important")
        self.assertEqual(priority_for(["possible_animal_attack"], ["front_path"]), "urgent")

    def test_policy_separates_retention_from_alerting(self):
        policy = {"rules": [
            {"id": "lane", "match": {"allLabels": ["person"], "anyZones": ["lane"]}, "retain": True, "alert": False, "priority": "important"},
            {"id": "danger", "match": {"allLabels": ["danger"]}, "retain": True, "alert": True, "priority": "urgent"},
        ]}
        lane = evaluate_policy(policy, ["person"], ["lane"])
        self.assertTrue(lane["retain"])
        self.assertFalse(lane["alert"])
        danger = evaluate_policy(policy, ["danger"], ["road"])
        self.assertTrue(danger["alert"])
        self.assertEqual(danger["priority"], "urgent")

    def test_person_holds_the_event_open_longer_than_a_transient_subject(self):
        self.assertEqual(subject_gap_seconds(["cat"], default_gap=20, person_gap=45), 20)
        self.assertEqual(subject_gap_seconds(["cat", "person"], default_gap=20, person_gap=45), 45)

    def test_gap_never_closes_before_the_post_roll_has_been_published(self):
        # A 20s gap with a 20s post-roll cuts the clip at the live edge and loses
        # the tail; the floor keeps finalisation clear of it.
        self.assertEqual(subject_gap_seconds(["cat"], default_gap=20, person_gap=45, minimum=26), 26)
        self.assertEqual(subject_gap_seconds(["person"], default_gap=20, person_gap=45, minimum=26), 45)

    def test_event_stays_open_while_the_analysed_position_trails_the_subject(self):
        # A backlogged fast pass has only looked 8s past the last detection, so the
        # subject may still be walking through segments awaiting analysis.
        self.assertFalse(event_window_closed(100, 130, 138, gap=45, max_duration=600))
        # Once analysis passes the gap without seeing them again, the event is over.
        self.assertTrue(event_window_closed(100, 130, 176, gap=45, max_duration=600))

    def test_detection_dropout_shorter_than_the_gap_does_not_split_the_event(self):
        self.assertFalse(event_window_closed(0, 30, 60, gap=45, max_duration=600))

    def test_event_is_capped_so_a_stuck_detection_cannot_grow_forever(self):
        self.assertTrue(event_window_closed(0, 700, 701, gap=45, max_duration=600))

    def test_owner_suppression_keeps_safety_override(self):
        policy = {"rules": [
            {"id": "ordinary", "match": {"allLabels": ["person"]}, "retain": True, "suppressWhenOwner": True},
            {"id": "safety", "match": {"allLabels": ["cat_in_road"]}, "retain": True, "alert": True, "priority": "urgent", "suppressWhenOwner": True, "safetyOverride": True},
        ]}
        ordinary = evaluate_policy(policy, ["person"], ["path"], owner_present=True)
        self.assertFalse(ordinary["retain"])
        safety = evaluate_policy(policy, ["person", "cat_in_road"], ["road"], owner_present=True)
        self.assertTrue(safety["alert"])


if __name__ == "__main__":
    unittest.main()
