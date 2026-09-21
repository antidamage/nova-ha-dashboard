"""The verdict table, with no Home Assistant in the way.

    python3 -m unittest discover -s ops/homeassistant/nova_appletv_outputs/tests

`nova_appletv_outputs/__init__.py` needs Home Assistant, and the module under
test does not — that is the point of keeping the verdict pure, so this file
runs on a stdlib python3 anywhere, and inside the HA container:

    docker exec homeassistant python3 -m unittest discover \
        -s /config/custom_components/nova_appletv_outputs/tests
"""

import importlib
import pathlib
import sys
import types
import unittest

PACKAGE_DIR = pathlib.Path(__file__).resolve().parents[1] / "nova_appletv_outputs"

# The package's own `__init__` imports Home Assistant; loading the directory as
# a namespace package under an alias reaches the pure modules without it.
_ALIAS = "nova_appletv_outputs_pure"
if _ALIAS not in sys.modules:
    shim = types.ModuleType(_ALIAS)
    shim.__path__ = [str(PACKAGE_DIR)]
    sys.modules[_ALIAS] = shim

outputs = importlib.import_module(f"{_ALIAS}.outputs")


class ReportedOutput:
    """One entry of pyatv's `atv.audio.output_devices`."""

    def __init__(self, identifier: str, name: str | None = None) -> None:
        self.identifier = identifier
        self.name = name


class VerdictTest(unittest.TestCase):
    """The Apple TV this bridge was written for, by its three identifiers."""

    OWN_IDS = outputs.own_identifiers(
        "96:02:06:63:50:DB",
        ["96:02:06:63:50:DB", "94020663-50DB-442B-9355-78C9DDCA0C94", "9602066350DB"],
    )
    NAMES = outputs.own_names("Home Theatre (1485)", "Home Theatre (1485)")

    def verdict(self, devices):
        return outputs.verdict_from(devices, self.OWN_IDS, self.NAMES)

    def test_nothing_reported_is_unavailable_never_off(self):
        # A bridge that cannot read must not be able to silence the amplifier
        # (specs/amp-appletv-power.md §8.3).
        for devices in (None, []):
            self.assertEqual(self.verdict(devices).tv_speakers, "unavailable")
            self.assertEqual(self.verdict(devices).audio_output, "unknown")

    def test_the_apple_tvs_own_output_is_tv_speakers(self):
        verdict = self.verdict([ReportedOutput("96:02:06:63:50:DB", "Home Theatre")])

        self.assertEqual(verdict.tv_speakers, "on")
        self.assertEqual(verdict.audio_output, "Home Theatre")

    def test_identifier_forms_all_match(self):
        for identifier in ("96:02:06:63:50:DB", "94020663-50DB-442B-9355-78C9DDCA0C94", "9602066350DB"):
            self.assertEqual(self.verdict([ReportedOutput(identifier)]).tv_speakers, "on")

    def test_the_name_matches_when_the_identifier_does_not(self):
        # The fallback: tvOS has spelled the television's own output different
        # ways, and Home Assistant's own name for the device carries a suffix.
        self.assertEqual(self.verdict([ReportedOutput("AA:BB:CC:DD:EE:FF", "home theatre")]).tv_speakers, "on")

    def test_the_local_outputs_own_label_matches_too(self):
        # tvOS calls the local output "TV Speakers", and that is the name
        # Adeline used. It is matched like one of the Apple TV's own names.
        names = outputs.own_names("Home Theatre (1485)", "Home Theatre", "TV Speakers")

        self.assertIn("tv speakers", names)
        self.assertEqual(
            outputs.verdict_from([ReportedOutput("AA:BB:CC:DD:EE:FF", "TV Speakers")], set(), names).tv_speakers,
            "on",
        )

    def test_another_output_switches_the_amp_off(self):
        # The use case Adeline named: Bluetooth headphones.
        verdict = self.verdict([ReportedOutput("AA:BB:CC:DD:EE:FF", "Addie's AirPods Pro")])

        self.assertEqual(verdict.tv_speakers, "off")
        self.assertEqual(verdict.audio_output, "Addie's AirPods Pro")

    def test_the_apple_tv_alongside_another_output_is_off(self):
        verdict = self.verdict(
            [
                ReportedOutput("96:02:06:63:50:DB", "Home Theatre"),
                ReportedOutput("AA:BB:CC:DD:EE:FF", "Living Room HomePod"),
            ]
        )

        self.assertEqual(verdict.tv_speakers, "off")
        self.assertEqual(verdict.audio_output, "Home Theatre, Living Room HomePod")

    def test_the_identifiers_are_normalised_before_comparing(self):
        own = outputs.own_identifiers("9602066350DB", None)

        self.assertEqual(own, {"9602066350db"})
        self.assertTrue(outputs.is_own_output(ReportedOutput("96:02:06:63:50:db"), own, set()))


class NameTest(unittest.TestCase):
    def test_the_disambiguating_suffix_is_stripped(self):
        self.assertEqual(outputs.own_names("Home Theatre (1485)"), {"home theatre"})

    def test_an_empty_name_matches_nothing(self):
        self.assertEqual(outputs.own_names(None, ""), set())


if __name__ == "__main__":
    unittest.main()
