"""Landmark geometry, liveness residual and orientation tests for `core`."""

import math
import unittest

import numpy as np

from core import (
    quarter_turns_to_upright,
    roll_degrees,
    fit_similarity,
    inter_ocular_distance,
    landmark_residual,
    liveness_decision,
)
from core_fixtures import BASE_SHAPE, similarity_matrix, rigid_track, live_track


class SimilarityFitTests(unittest.TestCase):
    def test_fit_recovers_a_similarity_exactly(self):
        moved = BASE_SHAPE @ similarity_matrix(0.4, 1.7).T + np.array([12.0, -5.0])
        fit = fit_similarity(BASE_SHAPE, moved)
        np.testing.assert_allclose(fit.apply(BASE_SHAPE), moved, atol=1e-9)
        self.assertAlmostEqual(fit.scale, 1.7, places=9)

    def test_fit_never_returns_a_reflection(self):
        # The classic bug: an unguarded SVD fit mirrors the source and drives the
        # residual to zero, so a flipped face passes liveness perfectly.
        mirrored = BASE_SHAPE * np.array([-1.0, 1.0])
        fit = fit_similarity(mirrored, BASE_SHAPE)
        self.assertAlmostEqual(float(np.linalg.det(fit.rotation)), 1.0, places=9)
        error = np.linalg.norm(fit.apply(mirrored) - BASE_SHAPE, axis=1).max()
        self.assertGreater(error / inter_ocular_distance(BASE_SHAPE), 0.05)

    def test_a_mirrored_track_does_not_fit(self):
        track = rigid_track()
        flipped = track.copy()
        flipped[13:] = flipped[13:] * np.array([-1.0, 1.0])
        self.assertGreater(landmark_residual(flipped).residual, landmark_residual(track).residual * 10)


class ResidualInvarianceTests(unittest.TestCase):
    """The whole design rests on the residual meaning one thing at any distance."""

    def setUp(self):
        self.track = live_track()
        self.baseline = landmark_residual(self.track).residual

    def test_residual_is_invariant_to_global_scale(self):
        scaled = self.track * 3.75
        self.assertAlmostEqual(landmark_residual(scaled).residual, self.baseline, places=9)

    def test_residual_is_invariant_to_global_rotation(self):
        rotated = self.track @ similarity_matrix(0.9, 1.0).T
        self.assertAlmostEqual(landmark_residual(rotated).residual, self.baseline, places=9)

    def test_residual_is_invariant_to_global_translation(self):
        translated = self.track + np.array([511.0, -237.0])
        self.assertAlmostEqual(landmark_residual(translated).residual, self.baseline, places=9)


class LivenessTests(unittest.TestCase):
    def test_a_rigid_track_fails_liveness(self):
        decision = liveness_decision(rigid_track())
        self.assertFalse(decision.ok)
        self.assertEqual(decision.reason, "liveness_rigid")
        self.assertEqual(decision.status, 401)

    def test_a_non_rigid_track_passes_liveness(self):
        decision = liveness_decision(live_track())
        self.assertTrue(decision.ok, decision)
        self.assertIsNone(decision.reason)

    def test_the_eyes_dominate_a_blinking_track(self):
        report = landmark_residual(live_track())
        self.assertGreater(
            max(report.per_landmark["leftEye"], report.per_landmark["rightEye"]),
            report.per_landmark["nose"],
        )

    def test_pure_noise_is_unstable_rather_than_very_alive(self):
        rng = np.random.default_rng(23)
        noise = np.stack([BASE_SHAPE + rng.normal(0.0, 12.0, BASE_SHAPE.shape) for _ in range(25)])
        decision = liveness_decision(noise)
        self.assertFalse(decision.ok)
        self.assertEqual(decision.reason, "liveness_unstable")
        self.assertEqual(decision.status, 422)

    def test_a_short_track_is_refused_before_the_residual_is_believed(self):
        decision = liveness_decision(live_track(frames=9))
        self.assertFalse(decision.ok)
        self.assertEqual(decision.reason, "too_few_frames")
        self.assertEqual(decision.status, 422)


class OrientationTests(unittest.TestCase):
    """Rotated captures are corrected from the eye line, not from metadata.

    A phone records portrait as landscape frames plus a rotation flag, and the
    flag does not survive a MediaRecorder re-encode or cv2.VideoCapture. The
    eye landmarks are the only orientation cue left.
    """

    @staticmethod
    def _eyes(roll_deg):
        angle = math.radians(roll_deg)
        half = 30.0
        centre = np.array([100.0, 100.0])
        offset = np.array([math.cos(angle), math.sin(angle)]) * half
        return np.array([centre - offset, centre + offset, centre, centre, centre])

    def test_roll_is_measured_from_the_eye_line(self):
        self.assertAlmostEqual(roll_degrees(self._eyes(0.0)), 0.0, places=6)
        self.assertAlmostEqual(roll_degrees(self._eyes(90.0)), 90.0, places=6)
        self.assertAlmostEqual(roll_degrees(self._eyes(-90.0)), -90.0, places=6)

    def test_quarter_turns_for_each_rotation(self):
        self.assertEqual(quarter_turns_to_upright(0.0), 0)
        self.assertEqual(quarter_turns_to_upright(90.0), 1)
        self.assertEqual(quarter_turns_to_upright(180.0), 2)
        self.assertEqual(quarter_turns_to_upright(-90.0), 3)

    def test_negative_rolls_are_snapped_against_the_signed_multiple(self):
        # Reducing modulo 4 before measuring the distance made -90 compare
        # against 270, look 360 degrees away, and be left on its side.
        self.assertEqual(quarter_turns_to_upright(-88.0), 3)
        self.assertEqual(quarter_turns_to_upright(-175.0), 2)

    def test_a_measured_real_rotation_is_corrected(self):
        # The live 90-degree capture measured +98 degrees of roll.
        self.assertEqual(quarter_turns_to_upright(98.0), 1)

    def test_a_tilted_head_is_left_alone(self):
        # Someone leaning their head is not a rotated capture, and rotating for
        # it would fight the residual, which is deliberately rotation-invariant.
        for roll in (5.0, -8.0, 20.0, 45.0, 60.0, -60.0, 135.0):
            self.assertEqual(quarter_turns_to_upright(roll), 0, roll)

    def test_roll_needs_both_eyes(self):
        with self.assertRaises(ValueError):
            roll_degrees(np.array([[0.0, 0.0]]))


if __name__ == "__main__":
    unittest.main()
