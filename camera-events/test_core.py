import unittest

from core import Box, point_in_polygon, priority_for, prompt_road_crossing, vehicle_proximity


class CameraEventCoreTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()

