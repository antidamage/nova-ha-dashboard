"""Tests for the signing oracle.

The interesting assertions here are the negative ones. That a valid ceremony
round-trips is table stakes; what this design has to prove is that a token
cannot be reused, that an expired token is worthless, that one nonce cannot
mint two signatures, that the counter is monotonic across a restart, and that
no key material survives the signing call or leaves it in the return value.

Hostnames are documentation values (RFC 2606 `.example`), not the household's.

Shared by every `test_authenticator_*.py`: the configs, the fast Argon2id
parameters and the `OracleTestCase` base. Holds no tests itself.
"""

from __future__ import annotations

import logging
import os
import sqlite3
import tempfile
import unittest

import nacl.pwhash

from authenticator import AuthenticatorConfig, CredentialStore
from authenticator.harness import RelyingParty

# The deliberate failure cases in the tests log a warning each; the test output is
# more useful without them.
logging.getLogger("nova-face-auth.authentik").setLevel(logging.CRITICAL)

CONFIG = AuthenticatorConfig(rp_id="rp.example", origin="https://oracle.rp.example")
OTHER_CONFIG = AuthenticatorConfig(rp_id="evil.example", origin="https://evil.example")
SUBJECT = "subject-a"
HOST_SECRET = b"host-secret-for-tests-only-not-a-real-one"

# The cheapest Argon2id parameters libsodium offers. The production values are
# in store.py; a test that spent 100 ms per derivation would be a test nobody
# runs.
FAST = {
    "opslimit": nacl.pwhash.argon2id.OPSLIMIT_MIN,
    "memlimit": nacl.pwhash.argon2id.MEMLIMIT_MIN,
}


class OracleTestCase(unittest.TestCase):
    def setUp(self):
        handle, self.path = tempfile.mkstemp(suffix=".sqlite3")
        os.close(handle)
        self.connection = sqlite3.connect(self.path)
        self.store = CredentialStore(self.connection, host_secret=HOST_SECRET, **FAST)
        self.rp = RelyingParty(config=CONFIG)

    def tearDown(self):
        self.connection.close()
        os.unlink(self.path)

    def release(self, token: str, *, subject: str = SUBJECT, ttl: int = 60, now: float = 1000.0) -> None:
        self.assertTrue(self.store.mint_release(subject, CONFIG, token, ttl_seconds=ttl, now=now))

    def registered(self, subject: str = SUBJECT):
        credential = self.store.register(subject, CONFIG)
        self.rp.register(subject, credential)
        return credential
