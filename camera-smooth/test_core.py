import unittest

from core import (
    FRAME_BUDGET_SECONDS,
    IDLE_STOP_SECONDS,
    MAX_DEBT_SECONDS,
    MIN_FREE_GPU_MIB,
    STALL_SECONDS,
    FrameBudget,
    enough_gpu_memory,
    has_stalled,
    idle_expired,
    is_served_name,
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


class ServedNameTest(unittest.TestCase):
    def test_serves_only_the_playlist_and_segments(self):
        self.assertTrue(is_served_name("index.m3u8"))
        self.assertTrue(is_served_name("seg_000123.ts"))

    def test_refuses_anything_else(self):
        for name in ("", "../index.m3u8", "seg_1.ts/../../x", "seg_abc.ts", "status", "seg_1.ts\n", ".env"):
            self.assertFalse(is_served_name(name), name)


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
