import unittest

from core import (
    FRAME_BUDGET_SECONDS,
    IDLE_STOP_SECONDS,
    LIVE,
    MAX_DEBT_SECONDS,
    MIN_FREE_GPU_MIB,
    OUTPUT_FPS,
    POSITION_HOLD_SECONDS,
    RATE_PROFILES,
    SOURCE_FPS,
    STALL_SECONDS,
    FrameBudget,
    Job,
    enough_gpu_memory,
    has_stalled,
    idle_expired,
    parse_render_path,
    parse_stream_path,
    render_source_args,
    source_args,
    source_frame_seconds,
    takes_over,
)


class FrameBudgetTest(unittest.TestCase):
    def test_generates_while_within_budget(self):
        budget = FrameBudget()
        for _ in range(1000):
            self.assertTrue(budget.should_generate())
            budget.record(0.027)
        self.assertEqual(budget.debt, 0.0)

    def test_stops_generating_once_too_far_over_and_recovers(self):
        budget = FrameBudget()
        while budget.should_generate():
            budget.record(0.060)
        self.assertGreater(budget.debt, MAX_DEBT_SECONDS)
        while not budget.should_generate():
            budget.record(0.005)
        self.assertTrue(budget.should_generate())

    def test_a_few_slow_frames_do_not_trip_it(self):
        budget = FrameBudget()
        for _ in range(5):
            budget.record(0.100)
        self.assertTrue(budget.should_generate())

    def test_debt_never_goes_negative(self):
        budget = FrameBudget()
        budget.record(0.0)
        self.assertEqual(budget.debt, 0.0)
        budget.record(FRAME_BUDGET_SECONDS)
        self.assertEqual(budget.debt, 0.0)

    def test_half_speed_gets_twice_the_time_per_source_frame(self):
        budget = FrameBudget(source_frame_seconds("0.5"))
        for _ in range(1000):
            budget.record(0.060)
        self.assertEqual(budget.debt, 0.0)


class RateProfileTest(unittest.TestCase):
    def test_every_rate_comes_out_at_60_fps_in_real_time(self):
        for rate, profile in RATE_PROFILES.items():
            self.assertAlmostEqual(SOURCE_FPS * float(rate) * profile.frames_per_source, OUTPUT_FPS, msg=rate)


class StreamPathTest(unittest.TestCase):
    def test_the_flat_names_are_the_live_stream(self):
        self.assertEqual(parse_stream_path("index.m3u8"), (LIVE, "index.m3u8"))
        self.assertEqual(parse_stream_path("seg_000123.ts"), (LIVE, "seg_000123.ts"))

    def test_a_position_stream_carries_its_job(self):
        self.assertEqual(
            parse_stream_path("at/recording/1793000000000/0.5/index.m3u8"),
            (Job("recording", 1793000000000, "0.5"), "index.m3u8"),
        )
        self.assertEqual(
            parse_stream_path("at/range_123/4000/1/seg_000001.ts"),
            (Job("range_123", 4000, "1"), "seg_000001.ts"),
        )

    def test_refuses_anything_else(self):
        for path in (
            "", "../index.m3u8", "seg_1.ts/../../x", "seg_abc.ts", "status", "seg_1.ts\n", ".env",
            "at/recording/1/2/index.m3u8", "at/../1/1/index.m3u8", "at/range_x/1/1/index.m3u8",
            "at/recording/-1/1/index.m3u8", "at/recording/1/1/../../index.m3u8",
        ):
            self.assertIsNone(parse_stream_path(path), path)

    def test_render_takes_only_a_range_id(self):
        self.assertEqual(parse_render_path("render/range_123.mp4"), "range_123")
        for path in ("render/../x.mp4", "render/range_.mp4", "render/range_1.mp4\n", "render/recording.mp4"):
            self.assertIsNone(parse_render_path(path), path)


class SourceTest(unittest.TestCase):
    BASE = "http://dash"

    def test_live_starts_near_the_edge_and_is_not_paced(self):
        url, options = source_args(LIVE, self.BASE)
        self.assertEqual(url, "http://dash/api/camera-proxy/outside/index.m3u8")
        self.assertEqual(options, ["-live_start_index", "-2"])

    def test_recording_starts_at_the_segment_and_is_paced_to_the_rate(self):
        url, options = source_args(Job("recording", 5000, "0.5"), self.BASE)
        self.assertEqual(url, "http://dash/api/camera-proxy/outside/index.m3u8?start=5000")
        self.assertEqual(options, ["-live_start_index", "0", "-readrate", "0.5"])

    def test_range_seeks_and_is_paced_to_the_rate(self):
        url, options = source_args(Job("range_9", 4000, "1"), self.BASE)
        self.assertEqual(url, "http://dash/api/camera/outside/saved/range_9/index.m3u8")
        self.assertEqual(options, ["-ss", "4.000", "-readrate", "1"])

    def test_render_is_not_paced(self):
        url, options = render_source_args("range_9", self.BASE)
        self.assertEqual(url, "http://dash/api/camera/outside/saved/range_9/index.m3u8")
        self.assertEqual(options, [])


class TakesOverTest(unittest.TestCase):
    POSITION = Job("range_1", 0, "1")

    def test_an_idle_card_is_anyones(self):
        self.assertTrue(takes_over(None, LIVE, 0))

    def test_a_position_takes_it_from_live(self):
        self.assertTrue(takes_over(LIVE, self.POSITION, 0))

    def test_live_waits_for_a_position_stream_to_go_quiet(self):
        self.assertFalse(takes_over(self.POSITION, LIVE, POSITION_HOLD_SECONDS - 1))
        self.assertTrue(takes_over(self.POSITION, LIVE, POSITION_HOLD_SECONDS))

    def test_a_new_position_takes_over_from_the_last(self):
        self.assertTrue(takes_over(self.POSITION, Job("range_1", 2000, "0.5"), 0))


class IdleTest(unittest.TestCase):
    def test_no_demand_yet_is_idle(self):
        self.assertTrue(idle_expired(100.0, None))

    def test_stops_only_after_the_idle_period(self):
        self.assertFalse(idle_expired(100.0, 100.0 - IDLE_STOP_SECONDS + 1))
        self.assertTrue(idle_expired(100.0, 100.0 - IDLE_STOP_SECONDS))


class GpuGuardTest(unittest.TestCase):
    def test_needs_the_minimum_free(self):
        self.assertTrue(enough_gpu_memory(MIN_FREE_GPU_MIB))
        self.assertFalse(enough_gpu_memory(MIN_FREE_GPU_MIB - 1))

    def test_unknown_counts_as_not_enough(self):
        self.assertFalse(enough_gpu_memory(None))


class StallTest(unittest.TestCase):
    def test_counts_from_start_until_the_first_output(self):
        self.assertFalse(has_stalled(10.0, 0.0, None))
        self.assertTrue(has_stalled(float(STALL_SECONDS), 0.0, None))

    def test_counts_from_the_last_output_after_that(self):
        self.assertFalse(has_stalled(100.0, 0.0, 99.0))
        self.assertTrue(has_stalled(100.0, 0.0, 100.0 - STALL_SECONDS))


if __name__ == "__main__":
    unittest.main()
