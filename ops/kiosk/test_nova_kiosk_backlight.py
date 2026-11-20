"""State-machine tests for nova-kiosk-backlight.py (specs/kiosk-backlight.md).

    python3 -m unittest ops/kiosk/test_nova_kiosk_backlight.py
"""
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import nova_kiosk_backlight_settings as settings  # noqa: E402

_spec = importlib.util.spec_from_file_location("kiosk_backlight", HERE / "nova-kiosk-backlight.py")
svc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(svc)


class FakePanel:
    def __init__(self):
        self.on = True

    def set_percent(self, pct):
        pass

    def forget(self):
        pass

    def is_on(self):
        return self.on

    def power(self, on):
        self.on = on


class FakePage:
    def push(self, state):
        pass


class BacklightTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        settings.STATE = Path(self.tmp.name) / "state.json"
        svc.HOLD_FLAG = Path(self.tmp.name) / "no-hold"
        self.clock = [1000.0]
        svc.time.monotonic = lambda: self.clock[0]
        svc.time.sleep = lambda seconds: None
        self.b = svc.Backlight(FakePanel(), FakePage())
        self.b.level = 0.0
        self.b.enter("rise", self.clock[0])

    def tearDown(self):
        self.tmp.cleanup()

    def run_for(self, seconds):
        end = self.clock[0] + seconds
        while self.clock[0] < end:
            self.clock[0] += 0.05
            self.b.tick(self.clock[0])

    def configure(self, target, dim, off):
        self.b.set_settings(target, dim, off, self.clock[0])

    def test_day_dims_to_its_level_and_stays(self):
        self.configure(100, 30, False)
        self.run_for(2.1 + 30 + 30.2 + 300)
        self.assertEqual(self.b.phase, "dark")
        self.assertAlmostEqual(self.b.level, 30)
        self.assertFalse(self.b.dark())  # 30% is readable: taps go through

    def test_night_dims_to_zero_then_blanks(self):
        self.configure(60, 0, True)
        self.run_for(2.1 + 30 + 30.2 + 121)
        self.assertEqual(self.b.phase, "off")
        self.assertTrue(self.b.blank())

    def test_raising_the_dim_level_mid_fade_never_brightens(self):
        self.configure(60, 0, True)
        self.run_for(2.1 + 30 + 15)  # halfway through the fade, about 30%
        self.assertEqual(self.b.phase, "dim")
        before = self.b.level
        self.configure(100, 30, False)  # sunrise
        levels = []
        for _ in range(40):
            self.run_for(0.5)
            levels.append(self.b.level)
        self.assertLessEqual(max(levels), before + 0.01)

    def test_sunset_while_dimmed_fades_on_down_and_blanks(self):
        self.configure(100, 30, False)
        self.run_for(2.1 + 30 + 30.2 + 10)
        self.configure(60, 0, True)
        self.assertEqual(self.b.phase, "dim")
        self.run_for(30.2)
        self.assertAlmostEqual(self.b.level, 0)
        self.run_for(121)
        self.assertEqual(self.b.phase, "off")

    def test_sunrise_leaves_a_blank_panel_alone_until_touched(self):
        self.configure(60, 0, True)
        self.run_for(2.1 + 30 + 30.2 + 121)
        self.configure(100, 30, False)
        self.run_for(5)
        self.assertEqual(self.b.phase, "off")
        self.b.touch(self.clock[0], True)
        self.run_for(2.1)
        self.assertEqual(self.b.phase, "hold")
        self.assertAlmostEqual(self.b.level, 100)

    def test_blank_newly_set_while_dark_waits_its_120_s(self):
        self.configure(100, 30, False)
        self.run_for(2.1 + 30 + 30.2 + 300)
        self.configure(100, 30, True)
        self.run_for(60)
        self.assertEqual(self.b.phase, "dark")
        self.run_for(61)
        self.assertEqual(self.b.phase, "off")

    def test_an_older_page_sending_only_a_target_gets_the_first_version(self):
        self.assertEqual(settings.clamp_settings(80, None, None), (80, 0.0, True))
        self.assertEqual(settings.clamp_settings(50, 90, False), (50, 50, False))


if __name__ == "__main__":
    unittest.main()
