"""Framing, clip shape, capture profile and streamed-frame tests for `core`."""

import unittest

from core import (
    CAPTURE_PROFILES,
    QUICK_IDLE_TIMEOUT_SECONDS,
    STREAM_GOOD_FRAMES,
    FrameHold,
    capture_profile,
    framing_reason,
    clip_bounds_reason,
    detection_reason,
    even_frame_indices,
)


class FramingTests(unittest.TestCase):
    """A face the anti-spoof stage cannot honestly assess is refused early.

    The anti-spoof crop widens the face box by up to 4x. When the widened box
    runs off the frame the border is reflected, so a face that was already
    clipped gets judged partly on invented texture. Measured 2026-09-03: the
    same face scored 0.9998 framed normally and 0.13-0.46 when clipped and
    reflected. Refusing is both more honest and more actionable.
    """

    def test_a_face_well_inside_the_frame_is_fine(self):
        self.assertIsNone(framing_reason((100, 80, 400, 500), 1280, 720))

    def test_a_face_touching_any_edge_is_clipped(self):
        for bbox in (
            (0, 80, 400, 500),        # left
            (100, 0, 400, 500),       # top
            (100, 80, 1280, 500),     # right
            (100, 80, 400, 720),      # bottom
        ):
            self.assertEqual(framing_reason(bbox, 1280, 720), "face_clipped", bbox)

    def test_a_face_filling_the_frame_is_too_close(self):
        # Inside the edges, but almost no context left for the texture model.
        self.assertEqual(
            framing_reason((300, 5, 900, 715), 1280, 720, max_frame_fraction=0.92),
            "face_too_close",
        )

    def test_the_measured_good_framings_are_accepted(self):
        # The two captures that scored 0.999: face at ~0.75 of frame height, in
        # landscape and in a small frame. The bound is a backstop, not a
        # framing preference, and must not reject what already works.
        self.assertIsNone(framing_reason((398, 43, 769, 586), 1280, 720))
        self.assertIsNone(framing_reason((149, 16, 288, 220), 480, 270))

    def test_clipping_is_checked_before_closeness(self):
        # A clipped face is also usually a close one; the actionable reason is
        # that it is cut off, not that it is large.
        self.assertEqual(framing_reason((0, 0, 1280, 720), 1280, 720), "face_clipped")


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


class CaptureProfiles(unittest.TestCase):
    """The profile table, and the properties that must hold across every row.

    These are written as invariants rather than as a copy of the table because a
    test that just restates the constants catches a typo and nothing else. What
    matters is that recognition never varies, and that a profile which drops the
    photo defences always carries the session bound that replaces them.
    """

    def test_standard_runs_both_gates(self):
        profile = capture_profile("standard")
        self.assertTrue(profile.liveness)
        self.assertTrue(profile.antispoof)
        self.assertFalse(profile.single_image)
        # Nothing bounds a standard session: it did not trade anything away.
        self.assertIsNone(profile.idle_timeout_seconds)

    def test_none_means_standard(self):
        self.assertEqual(capture_profile(None).name, "standard")
        self.assertEqual(capture_profile("").name, "standard")

    def test_names_are_case_and_space_insensitive(self):
        self.assertEqual(capture_profile("  QUICK ").name, "quick")

    def test_unknown_profile_is_refused_not_downgraded(self):
        # The failure that matters: a caller asking for a gate this build does
        # not have must not silently get a different one.
        with self.assertRaises(ValueError):
            capture_profile("relaxed")

    def test_dropping_the_photo_defences_always_buys_a_bounded_session(self):
        for profile in CAPTURE_PROFILES.values():
            if profile.liveness and profile.antispoof:
                continue
            with self.subTest(profile=profile.name):
                self.assertEqual(profile.idle_timeout_seconds, QUICK_IDLE_TIMEOUT_SECONDS)

    def test_quick_streams_two_good_frames_and_either_may_match(self):
        # Adeline, 2026-09-11: take the first two good images, then sign in.
        quick = capture_profile("quick")
        self.assertTrue(quick.frame_stream)
        self.assertFalse(quick.single_image)
        self.assertEqual(quick.min_frames, STREAM_GOOD_FRAMES)
        self.assertEqual(STREAM_GOOD_FRAMES, 2)
        self.assertEqual(quick.min_agreeing, 1)

    def test_streamed_profiles_never_run_the_pixel_gates(self):
        # Streamed stills are held as detections, not pixels, so there is
        # nothing for anti-spoof to score or for liveness to track.
        for profile in CAPTURE_PROFILES.values():
            if profile.frame_stream:
                with self.subTest(profile=profile.name):
                    self.assertFalse(profile.liveness)
                    self.assertFalse(profile.antispoof)

    def test_standard_clip_floor_unchanged(self):
        self.assertEqual(clip_bounds_reason(0.5, 30.0), "clip_too_short")
        self.assertEqual(clip_bounds_reason(1.0, 10.0), "clip_low_fps")

    def test_image_can_be_decided_on_a_single_frame(self):
        # "Accepts the first image it recognises" is only possible if one frame
        # clears both the frame floor and the agreement vote.
        image = capture_profile("image")
        self.assertTrue(image.single_image)
        self.assertEqual(image.min_frames, 1)
        self.assertEqual(image.min_agreeing, 1)

    def test_standard_does_not_lower_the_frame_or_vote_floors(self):
        profile = capture_profile("standard")
        self.assertIsNone(profile.min_frames)
        self.assertIsNone(profile.min_agreeing)


class FrameHoldTests(unittest.TestCase):
    def test_keeps_only_the_first_two_good_frames(self):
        hold = FrameHold(good_needed=2)
        held = hold.get("n", 0.0)
        hold.record(held, [], ["low_detection"])
        self.assertFalse(hold.complete(held))
        hold.record(held, ["a"], [])
        hold.record(held, ["b"], [])
        hold.record(held, ["c"], [])
        self.assertTrue(hold.complete(held))
        self.assertEqual(held.good, ["a", "b"])
        self.assertEqual(held.rejections, ["low_detection"])
        self.assertEqual(held.analysed, 4)

    def test_take_removes_the_entry(self):
        hold = FrameHold()
        hold.record(hold.get("n", 0.0), ["a"], [])
        self.assertEqual(hold.take("n").good, ["a"])
        self.assertIsNone(hold.take("n"))

    def test_expired_entries_are_swept(self):
        hold = FrameHold(ttl_seconds=20.0)
        hold.record(hold.get("old", 0.0), ["a"], [])
        hold.get("new", 25.0)
        self.assertIsNone(hold.take("old"))

    def test_analysis_is_capped_per_nonce(self):
        hold = FrameHold(max_frames=3)
        held = hold.get("n", 0.0)
        for _ in range(3):
            hold.record(held, [], ["no_face"])
        self.assertTrue(hold.exhausted(held))


if __name__ == "__main__":
    unittest.main()
