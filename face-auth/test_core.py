import math
import unittest

import numpy as np

from core import (
    LockoutState,
    Match,
    aggregate_frames,
    client_address,
    clip_bounds_reason,
    cosine_match,
    detection_reason,
    enrolment_consistency,
    even_frame_indices,
    fit_similarity,
    inter_ocular_distance,
    landmark_residual,
    liveness_decision,
    lockout_reason,
    network_allowed,
    parse_cidrs,
    preflight_reason,
    register_failure,
    release_rate_exceeded,
)

# Documentation ranges, not this household's. RFC 5737 TEST-NET-1 and the
# RFC 6598 CGNAT block the tailnet uses. The real LAN prefix is configuration
# in /etc/nova-face-auth.env and never a constant in this repo.
TEST_LAN = "192.0.2.0/24"
TAILNET = "100.64.0.0/10"

# An asymmetric five-point face in pixels, in RetinaFace order. Asymmetric on
# purpose: a symmetric shape would hide reflection bugs, because its mirror is
# reachable by a proper rotation.
BASE_SHAPE = np.array(
    [
        [-30.0, -20.0],  # left eye
        [30.0, -20.0],   # right eye
        [2.0, 6.0],      # nose tip
        [-22.0, 30.0],   # left mouth corner
        [24.0, 29.0],    # right mouth corner
    ]
)


def similarity_matrix(angle: float, scale: float) -> np.ndarray:
    return scale * np.array([[math.cos(angle), -math.sin(angle)], [math.sin(angle), math.cos(angle)]])


def rigid_track(frames: int = 25, *, noise: float = 0.2, seed: int = 7) -> np.ndarray:
    """A photograph being held, tilted and waved in front of the lens.

    Every frame is the same shape under scale, rotation and translation, plus
    sub-pixel sensor noise. Nothing about it is non-rigid.
    """

    rng = np.random.default_rng(seed)
    track = []
    for index in range(frames):
        angle = 0.35 * math.sin(index / 3.0)
        scale = 1.0 + 0.25 * math.sin(index / 5.0)
        offset = np.array([40.0 * math.sin(index / 4.0), 25.0 * math.cos(index / 6.0)])
        moved = BASE_SHAPE @ similarity_matrix(angle, scale).T + offset
        track.append(moved + rng.normal(0.0, noise, moved.shape))
    return np.stack(track)


def live_track(frames: int = 25, *, seed: int = 11) -> np.ndarray:
    """The same motion, plus a blink and a moving mouth that no rigid fit removes."""

    rng = np.random.default_rng(seed)
    track = []
    for index in range(frames):
        shape = BASE_SHAPE.copy()
        blink = 5.0 * max(0.0, math.sin(index / 2.0))
        shape[0, 1] += blink
        shape[1, 1] += blink * 0.92
        shape[3, 0] += 2.4 * math.sin(index / 1.7)
        shape[4, 0] -= 2.2 * math.sin(index / 1.9)
        shape[2, 1] += 0.8 * math.cos(index / 2.3)
        angle = 0.30 * math.sin(index / 3.0)
        scale = 1.0 + 0.20 * math.sin(index / 5.0)
        offset = np.array([35.0 * math.sin(index / 4.0), 20.0 * math.cos(index / 6.0)])
        moved = shape @ similarity_matrix(angle, scale).T + offset
        track.append(moved + rng.normal(0.0, 0.15, moved.shape))
    return np.stack(track)


def unit_vectors(dimension: int = 512) -> np.ndarray:
    """A deterministic orthonormal basis to build embeddings with known angles."""

    rng = np.random.default_rng(3)
    basis, _ = np.linalg.qr(rng.normal(size=(dimension, dimension)))
    return basis.T


BASIS = unit_vectors()


def embedding_at(angle: float, axis: int = 1) -> np.ndarray:
    """A unit vector whose cosine with BASIS[0] is exactly cos(angle)."""

    return math.cos(angle) * BASIS[0] + math.sin(angle) * BASIS[axis]


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


class MatchTests(unittest.TestCase):
    def setUp(self):
        self.probe = BASIS[0]
        self.gallery = {
            "subject-a": [embedding_at(math.acos(0.55), axis=1)],
            "subject-b": [embedding_at(math.acos(0.52), axis=2)],
        }

    def test_cosine_match_refuses_inside_the_margin(self):
        # 0.55 and 0.52 are both over threshold; the 0.03 gap is under the 0.06
        # margin, so this is an ambiguous face and there is no winner to pick.
        self.assertIsNone(cosine_match(self.probe, self.gallery))

    def test_cosine_match_accepts_a_clear_winner(self):
        self.gallery["subject-b"] = [embedding_at(math.acos(0.20), axis=2)]
        match = cosine_match(self.probe, self.gallery)
        self.assertIsNotNone(match)
        self.assertEqual(match.subject, "subject-a")
        self.assertAlmostEqual(match.score, 0.55, places=6)
        self.assertAlmostEqual(match.runner_up, 0.20, places=6)

    def test_cosine_match_refuses_below_threshold(self):
        gallery = {"subject-a": [embedding_at(math.acos(0.30), axis=1)]}
        self.assertIsNone(cosine_match(self.probe, gallery))

    def test_an_unknown_face_matches_nobody_rather_than_the_nearest_neighbour(self):
        self.assertIsNone(cosine_match(BASIS[7], self.gallery))


class FrameAggregationTests(unittest.TestCase):
    @staticmethod
    def votes(agreeing: int, total: int = 25) -> list[Match | None]:
        matched = [Match("subject-a", 0.61, 0.20) for _ in range(agreeing)]
        return matched + [None] * (total - agreeing)

    def test_eleven_of_twenty_five_is_refused(self):
        self.assertIsNone(aggregate_frames(self.votes(11)))

    def test_twelve_of_twenty_five_is_accepted(self):
        result = aggregate_frames(self.votes(12))
        self.assertIsNotNone(result)
        self.assertEqual(result.subject, "subject-a")
        self.assertEqual(result.agreeing, 12)
        self.assertEqual(result.usable, 25)

    def test_no_agreeing_frames_at_all_is_refused(self):
        self.assertIsNone(aggregate_frames([None] * 25))


class EnrolmentTests(unittest.TestCase):
    def test_an_off_centroid_member_is_rejected_and_named(self):
        embeddings = [embedding_at(angle) for angle in (0.0, 0.05, 0.08)]
        embeddings.append(embedding_at(1.4, axis=3))
        report = enrolment_consistency(embeddings)
        self.assertFalse(report.ok)
        self.assertEqual(report.index, 3)
        self.assertEqual(report.reason, "inconsistent")
        self.assertGreater(report.centroid_distance, 0.30)

    def test_a_tight_set_is_accepted(self):
        embeddings = [embedding_at(angle) for angle in (0.0, 0.05, 0.08, 0.11, 0.06)]
        report = enrolment_consistency(embeddings)
        self.assertTrue(report.ok, report)
        self.assertIsNone(report.index)

    def test_a_clip_that_matches_another_subject_is_rejected_and_named(self):
        others = {"subject-b": [embedding_at(0.02)]}
        report = enrolment_consistency([embedding_at(0.0), embedding_at(0.04)], others=others)
        self.assertFalse(report.ok)
        self.assertEqual(report.index, 0)
        self.assertEqual(report.reason, "conflicts_with_subject")
        self.assertEqual(report.nearest_other_subject, "subject-b")


class ClipShapeTests(unittest.TestCase):
    def test_clip_bounds(self):
        self.assertIsNone(clip_bounds_reason(1.0, 30.0))
        self.assertEqual(clip_bounds_reason(0.4, 30.0), "clip_too_short")
        self.assertEqual(clip_bounds_reason(4.0, 30.0), "clip_too_long")
        self.assertEqual(clip_bounds_reason(1.0, 10.0), "clip_low_fps")
        self.assertEqual(clip_bounds_reason(0.0, 0.0), "clip_undecodable")

    def test_even_frame_indices_span_the_clip_without_repeats(self):
        indices = even_frame_indices(60, 25)
        self.assertEqual(len(set(indices)), len(indices))
        self.assertEqual((indices[0], indices[-1]), (0, 59))
        self.assertEqual(even_frame_indices(9, 25), list(range(9)))

    def test_detection_refusals(self):
        self.assertIsNone(detection_reason(1, 0.9, 200))
        self.assertEqual(detection_reason(0, None, None), "no_face")
        self.assertEqual(detection_reason(2, 0.9, 200), "multiple_faces")
        self.assertEqual(detection_reason(1, 0.5, 200), "low_detection")
        self.assertEqual(detection_reason(1, 0.9, 40), "face_too_small")


class NetworkBindingTests(unittest.TestCase):
    def setUp(self):
        self.networks = parse_cidrs(f"{TEST_LAN},{TAILNET}")

    def test_an_address_inside_the_list_is_allowed(self):
        self.assertTrue(network_allowed("192.0.2.41", self.networks))
        self.assertTrue(network_allowed("100.100.7.3", self.networks))

    def test_an_address_outside_the_list_is_refused(self):
        self.assertFalse(network_allowed("203.0.113.9", self.networks))
        self.assertFalse(network_allowed("10.0.0.5", self.networks))

    def test_a_malformed_cidr_list_refuses_everything(self):
        # Default-deny: one bad entry empties the list rather than leaving a
        # shorter one that still allows something.
        broken = parse_cidrs("192.0.2.0/24,not-a-cidr")
        self.assertEqual(broken, [])
        self.assertFalse(network_allowed("192.0.2.41", broken))

    def test_an_empty_list_refuses_everything(self):
        self.assertFalse(network_allowed("192.0.2.41", parse_cidrs("")))
        self.assertFalse(network_allowed("192.0.2.41", parse_cidrs(None)))

    def test_a_missing_or_malformed_address_is_refused(self):
        self.assertFalse(network_allowed(None, self.networks))
        self.assertFalse(network_allowed("", self.networks))
        self.assertFalse(network_allowed("not-an-address", self.networks))
        self.assertFalse(network_allowed("192.0.2.999", self.networks))

    def test_a_port_suffix_and_an_ipv4_mapped_address_still_resolve(self):
        self.assertTrue(network_allowed("192.0.2.41:54321", self.networks))
        self.assertTrue(network_allowed("::ffff:192.0.2.41", self.networks))
        self.assertTrue(network_allowed("[::ffff:192.0.2.41]:443", self.networks))

    def test_the_forwarded_client_wins_and_can_be_distrusted(self):
        self.assertEqual(client_address("192.0.2.41, 10.0.0.1", "127.0.0.1"), "192.0.2.41")
        self.assertEqual(client_address("192.0.2.41", "127.0.0.1", trust_forwarded=False), "127.0.0.1")
        self.assertEqual(client_address(None, "127.0.0.1"), "127.0.0.1")
        self.assertIsNone(client_address(None, None))


class LockoutTests(unittest.TestCase):
    def test_the_counter_trips_at_the_limit_and_not_before(self):
        state = LockoutState()
        for index in range(4):
            state = register_failure(state, 1000.0 + index)
            self.assertTrue(state.armed)
            self.assertIsNone(lockout_reason(state, 1000.0 + index))
        state = register_failure(state, 1004.0)
        self.assertFalse(state.armed)
        self.assertEqual(state.failures, 5)
        self.assertEqual(lockout_reason(state, 1004.0), "disarmed")

    def test_failures_outside_the_window_start_a_new_one(self):
        state = LockoutState()
        for index in range(4):
            state = register_failure(state, 1000.0 + index)
        state = register_failure(state, 1000.0 + 900)
        self.assertEqual(state.failures, 1)
        self.assertTrue(state.armed)

    def test_a_disarmed_state_survives_a_restart_and_is_not_cleared_by_time(self):
        # The state is a value read back from SQLite; nothing in core.py can
        # re-arm it, which is the point — re-arming is a password + TOTP action.
        disarmed = LockoutState(failures=5, window_start=1000.0, armed=False)
        self.assertEqual(lockout_reason(disarmed, 1000.0), "disarmed")
        self.assertEqual(lockout_reason(disarmed, 1000.0 + 86_400), "disarmed")
        still_disarmed = register_failure(disarmed, 1000.0 + 86_400)
        self.assertFalse(still_disarmed.armed)

    def test_a_counter_at_the_limit_reports_locked_out_while_armed(self):
        # The global scope counts failures without disarming the whole service
        # on its own; it reports locked_out for the duration of its window.
        state = LockoutState(failures=12, window_start=1000.0, armed=True)
        self.assertEqual(lockout_reason(state, 1010.0, max_failures=12), "locked_out")
        self.assertIsNone(lockout_reason(state, 1000.0 + 900, max_failures=12))


class ReleaseRateTests(unittest.TestCase):
    def test_the_sixth_release_is_allowed_and_the_seventh_is_not(self):
        stamps = [1000.0 + index for index in range(5)]
        self.assertFalse(release_rate_exceeded(stamps, 1010.0))
        self.assertTrue(release_rate_exceeded(stamps + [1005.0], 1010.0))

    def test_releases_older_than_the_window_do_not_count(self):
        stamps = [1000.0 + index for index in range(6)]
        self.assertFalse(release_rate_exceeded(stamps, 1000.0 + 3600))

    def test_a_zero_cap_refuses_everything(self):
        self.assertTrue(release_rate_exceeded([], 1000.0, max_per_hour=0))


class GateOrderTests(unittest.TestCase):
    """The order is the property: all of it decides before a model is touched."""

    def test_all_gates_open_is_no_reason(self):
        self.assertIsNone(preflight_reason(nonce_ok=True, network_ok=True, lockout=None, rate_ok=True))

    def test_the_nonce_is_judged_first(self):
        self.assertEqual(
            preflight_reason(nonce_ok=False, network_ok=False, lockout="disarmed", rate_ok=False),
            "nonce_invalid",
        )

    def test_network_precedes_the_armed_state(self):
        self.assertEqual(
            preflight_reason(nonce_ok=True, network_ok=False, lockout="disarmed", rate_ok=False),
            "network_denied",
        )

    def test_the_armed_state_precedes_the_release_rate(self):
        self.assertEqual(
            preflight_reason(nonce_ok=True, network_ok=True, lockout="locked_out", rate_ok=False),
            "locked_out",
        )

    def test_the_release_rate_is_the_last_gate(self):
        self.assertEqual(
            preflight_reason(nonce_ok=True, network_ok=True, lockout=None, rate_ok=False),
            "rate_limited",
        )


if __name__ == "__main__":
    unittest.main()
