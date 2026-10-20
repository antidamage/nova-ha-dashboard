"""Network binding, lockout, release rate and gate ordering tests for `core`."""

import unittest

from core import (
    LockoutState,
    client_address,
    lockout_reason,
    network_allowed,
    parse_cidrs,
    preflight_reason,
    register_failure,
    release_rate_exceeded,
)
from core_fixtures import TEST_LAN, TAILNET


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
