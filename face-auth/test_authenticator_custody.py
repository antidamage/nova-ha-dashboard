"""Signing-oracle counter and key-material custody tests."""

from __future__ import annotations

import json
import sqlite3
import unittest

from authenticator import CredentialStore, ctap
from authenticator.harness import VerificationError
from authenticator.store import secret_box, wipe
from authenticator_fixtures import CONFIG, FAST, HOST_SECRET, SUBJECT, OracleTestCase


class CounterTests(OracleTestCase):
    def test_the_counter_increments_and_persists_across_a_reopen(self):
        self.registered()
        counters = []
        for index in range(3):
            token = f"token-{index}"
            self.release(token)
            assertion = self.store.sign_assertion(
                subject_id=SUBJECT, challenge=self.rp.challenge(), config=CONFIG,
                release_token=token, now=1001.0 + index,
            )
            counters.append(assertion["signCount"])
        self.assertEqual(counters, [1, 2, 3])

        # A restart is the cheapest thing an attacker on the LAN can cause. The
        # counter must not go backwards across one.
        self.connection.close()
        reopened = sqlite3.connect(self.path)
        store = CredentialStore(reopened, host_secret=HOST_SECRET, **FAST)
        self.assertEqual(store.sign_count(SUBJECT, CONFIG.rp_id), 3)
        store.mint_release(SUBJECT, CONFIG, "after-restart", ttl_seconds=60, now=2000.0)
        assertion = store.sign_assertion(
            subject_id=SUBJECT, challenge=self.rp.challenge(), config=CONFIG,
            release_token="after-restart", now=2001.0,
        )
        self.assertEqual(assertion["signCount"], 4)
        reopened.close()
        self.connection = sqlite3.connect(self.path)  # for tearDown

    def test_the_relying_party_refuses_a_counter_that_does_not_advance(self):
        self.registered()
        self.release("a")
        first_challenge = self.rp.challenge()
        assertion = self.store.sign_assertion(
            subject_id=SUBJECT, challenge=first_challenge, config=CONFIG,
            release_token="a", now=1001.0,
        )
        self.assertTrue(self.rp.verify(SUBJECT, assertion, first_challenge))
        replayed_challenge = self.rp.challenge()
        self.rp.issued.add(first_challenge)
        with self.assertRaises(VerificationError):
            self.rp.verify(SUBJECT, assertion, first_challenge)
        self.assertIn(replayed_challenge, self.rp.issued)


class KeyMaterialTests(OracleTestCase):
    """The property the whole custody design exists to hold."""

    def plaintext_after_signing(self) -> bytearray:
        self.registered()
        self.release("observed")
        captured: list[bytearray] = []
        self.store.sign_assertion(
            subject_id=SUBJECT, challenge=self.rp.challenge(), config=CONFIG,
            release_token="observed", now=1001.0,
            _observe_plaintext=captured.append,
        )
        self.assertEqual(len(captured), 1)
        return captured[0]

    def test_the_plaintext_scalar_is_zeroed_after_the_call(self):
        # The observer is handed the very buffer sign_assertion owns, so this
        # asserts about the real object rather than a copy of it.
        scalar = self.plaintext_after_signing()
        self.assertEqual(len(scalar), 32)
        self.assertEqual(bytes(scalar), b"\x00" * 32)

    def test_the_plaintext_is_zeroed_even_when_signing_raises(self):
        self.registered()
        self.release("boom")
        captured: list[bytearray] = []

        def observe(buffer: bytearray) -> None:
            captured.append(buffer)
            raise RuntimeError("signing blew up")

        with self.assertRaises(RuntimeError):
            self.store.sign_assertion(
                subject_id=SUBJECT, challenge=self.rp.challenge(), config=CONFIG,
                release_token="boom", now=1001.0, _observe_plaintext=observe,
            )
        self.assertEqual(bytes(captured[0]), b"\x00" * 32)

    def test_the_returned_assertion_carries_no_key_material(self):
        self.registered()
        self.release("t")
        # Capture the scalar before it is wiped so the search knows what to
        # look for; the value is compared against every field of the result.
        seen: list[bytes] = []
        assertion = self.store.sign_assertion(
            subject_id=SUBJECT, challenge=self.rp.challenge(), config=CONFIG,
            release_token="t", now=1001.0, _observe_plaintext=lambda buffer: seen.append(bytes(buffer)),
        )
        scalar = seen[0]
        self.assertNotEqual(scalar, b"\x00" * 32)
        blob = json.dumps(assertion).encode()
        self.assertNotIn(scalar, blob)
        self.assertNotIn(ctap.b64url(scalar).encode(), blob)
        for field, value in assertion.items():
            self.assertNotIsInstance(value, (bytes, bytearray), field)
        # The key set is pinned so a field cannot be added without someone
        # deciding it carries nothing private. `credential` was added
        # 2026-09-03 for the WebAuthn wire shape; its contents are checked
        # below and by AssertionWireShapeTests.
        self.assertEqual(
            set(assertion),
            {"subject", "credential", "credentialId", "clientDataJSON", "authenticatorData",
             "signature", "userHandle", "signCount"},
        )
        nested = assertion["credential"]
        self.assertNotIn(scalar, json.dumps(nested).encode())
        for field, value in nested["response"].items():
            self.assertNotIsInstance(value, (bytes, bytearray), field)

    def test_no_helper_hands_back_a_private_key(self):
        self.registered()
        # The public surface: what registration returns, and what the store
        # will look up afterwards. None of it is private material.
        credential = self.store.register(SUBJECT, CONFIG)
        self.assertFalse(hasattr(credential, "private_key"))
        self.assertNotIn("private", credential.as_dict())
        self.assertIsNotNone(self.store.public_key(SUBJECT, CONFIG.rp_id))
        self.assertFalse(
            [name for name in dir(self.store) if "private" in name.lower() or name.endswith("_scalar")]
        )

    def test_the_stored_blob_is_not_the_key(self):
        self.registered()
        row = self.store.credential_row(SUBJECT, CONFIG.rp_id)
        sealed = bytes(row["sealed_key"])
        self.assertGreater(len(sealed), 32)  # nonce + tag, not a bare scalar
        self.release("t")
        seen: list[bytes] = []
        self.store.sign_assertion(
            subject_id=SUBJECT, challenge=self.rp.challenge(), config=CONFIG,
            release_token="t", now=1001.0, _observe_plaintext=lambda buffer: seen.append(bytes(buffer)),
        )
        self.assertNotIn(seen[0], sealed)

    def test_the_release_row_stores_a_hash_not_the_token(self):
        self.registered()
        self.release("secret-token-value")
        row = self.connection.execute("SELECT * FROM credential_releases").fetchone()
        blob = b"".join(bytes(value) if isinstance(value, (bytes, bytearray)) else str(value).encode()
                        for value in row)
        self.assertNotIn(b"secret-token-value", blob)

    def test_wipe_zeroes_both_buffer_kinds(self):
        mutable = bytearray(b"\xff" * 32)
        wipe(mutable)
        self.assertEqual(bytes(mutable), b"\x00" * 32)
        immutable = bytes(bytearray(b"\xab" * 32))
        wipe(immutable)
        self.assertEqual(immutable, b"\x00" * 32)

    def test_the_secret_box_context_wipes_the_key_it_retained(self):
        key = bytearray(b"\x11" * 32)
        with secret_box(key) as box:
            retained = box._key
            self.assertNotEqual(retained, b"\x00" * 32)
        self.assertEqual(retained, b"\x00" * 32)


if __name__ == "__main__":
    unittest.main()
