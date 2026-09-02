"""Tests for the signing oracle.

The interesting assertions here are the negative ones. That a valid ceremony
round-trips is table stakes; what this design has to prove is that a token
cannot be reused, that an expired token is worthless, that one nonce cannot
mint two signatures, that the counter is monotonic across a restart, and that
no key material survives the signing call or leaves it in the return value.

Hostnames are documentation values (RFC 2606 `.example`), not the household's.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import tempfile
import unittest

import nacl.pwhash

from authenticator import AuthenticatorConfig, CredentialStore, ctap
from authenticator.authentik import AuthentikClient, AuthentikError
from authenticator.harness import RelyingParty, VerificationError
from authenticator.store import secret_box, wipe

# The deliberate failure cases below log a warning each; the test output is
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


class RoundTripTests(OracleTestCase):
    def test_register_then_assert_verifies_at_the_relying_party(self):
        self.registered()
        self.release("face-session-1")
        challenge = self.rp.challenge()
        assertion = self.store.sign_assertion(
            subject_id=SUBJECT, challenge=challenge, config=CONFIG,
            release_token="face-session-1", now=1001.0,
        )
        self.assertTrue(self.rp.verify(SUBJECT, assertion, challenge))

    def test_the_origin_is_the_pinned_one_whatever_the_caller_wanted(self):
        # There is no origin parameter to abuse: the oracle is a host
        # authenticator, and an origin supplied by its caller would assert
        # nothing at all.
        self.registered()
        self.release("t")
        assertion = self.store.sign_assertion(
            subject_id=SUBJECT, challenge=self.rp.challenge(), config=CONFIG,
            release_token="t", now=1001.0,
        )
        document = json.loads(ctap.b64url_decode(assertion["clientDataJSON"]))
        self.assertEqual(document["origin"], CONFIG.origin)
        self.assertEqual(document["type"], "webauthn.get")
        self.assertIs(document["crossOrigin"], False)

    def test_the_rp_id_hash_is_the_pinned_one(self):
        self.registered()
        self.release("t")
        assertion = self.store.sign_assertion(
            subject_id=SUBJECT, challenge=self.rp.challenge(), config=CONFIG,
            release_token="t", now=1001.0,
        )
        data = ctap.b64url_decode(assertion["authenticatorData"])
        self.assertEqual(data[:32], ctap.rp_id_hash(CONFIG.rp_id))
        self.assertTrue(data[32] & ctap.FLAG_UP)
        self.assertTrue(data[32] & ctap.FLAG_UV)

    def test_a_configuration_without_https_or_a_name_is_refused(self):
        with self.assertRaises(ValueError):
            AuthenticatorConfig(rp_id="", origin="https://x.example")
        with self.assertRaises(ValueError):
            AuthenticatorConfig(rp_id="rp.example", origin="http://x.example")

    def test_a_store_without_a_host_secret_refuses_to_exist(self):
        with self.assertRaises(ValueError):
            CredentialStore(sqlite3.connect(":memory:"), host_secret=b"")


class TokenLifecycleTests(OracleTestCase):
    def test_a_reused_token_cannot_sign_a_second_time(self):
        self.registered()
        self.release("once")
        self.store.sign_assertion(
            subject_id=SUBJECT, challenge=self.rp.challenge(), config=CONFIG,
            release_token="once", now=1001.0,
        )
        with self.assertRaises(PermissionError):
            self.store.sign_assertion(
                subject_id=SUBJECT, challenge=self.rp.challenge(), config=CONFIG,
                release_token="once", now=1002.0,
            )

    def test_an_expired_token_cannot_sign(self):
        self.registered()
        self.release("stale", ttl=60, now=1000.0)
        with self.assertRaises(PermissionError):
            self.store.sign_assertion(
                subject_id=SUBJECT, challenge=self.rp.challenge(), config=CONFIG,
                release_token="stale", now=1000.0 + 61,
            )

    def test_one_nonce_cannot_mint_two_signatures(self):
        # The face nonce is spent by the service, which mints exactly one
        # release per nonce; the release is then consumed on the UPDATE's
        # rowcount. Two concurrent submissions of the same token therefore
        # produce one signature and one refusal, never two signatures.
        self.registered()
        self.release("nonce-bound-token")
        first = self.store.sign_assertion(
            subject_id=SUBJECT, challenge=self.rp.challenge(), config=CONFIG,
            release_token="nonce-bound-token", now=1001.0,
        )
        self.assertIn("signature", first)
        for _ in range(3):
            with self.assertRaises(PermissionError):
                self.store.sign_assertion(
                    subject_id=SUBJECT, challenge=self.rp.challenge(), config=CONFIG,
                    release_token="nonce-bound-token", now=1001.0,
                )

    def test_an_unknown_token_cannot_sign(self):
        self.registered()
        with self.assertRaises(PermissionError):
            self.store.sign_assertion(
                subject_id=SUBJECT, challenge=self.rp.challenge(), config=CONFIG,
                release_token="never-issued", now=1001.0,
            )

    def test_a_token_minted_for_one_subject_cannot_release_another(self):
        self.registered(SUBJECT)
        self.registered("subject-b")
        self.release("borrowed", subject="subject-b")
        with self.assertRaises(PermissionError):
            self.store.sign_assertion(
                subject_id=SUBJECT, challenge=self.rp.challenge(), config=CONFIG,
                release_token="borrowed", now=1001.0,
            )

    def test_a_subject_without_a_credential_gets_no_release_and_no_signature(self):
        self.assertFalse(self.store.mint_release("nobody", CONFIG, "t", ttl_seconds=60, now=1000.0))
        with self.assertRaises(PermissionError):
            self.store.sign_assertion(
                subject_id="nobody", challenge=self.rp.challenge(), config=CONFIG,
                release_token="t", now=1001.0,
            )


class RelyingPartyPinningTests(OracleTestCase):
    def test_the_oracle_cannot_be_made_to_sign_for_another_relying_party(self):
        """The property: there is no argument that changes the RP.

        `sign_assertion` takes the whole relying party as pinned configuration
        and looks the credential up by `(subject, config.rp_id)`. Handing it a
        different configuration finds no credential for that RP, so it refuses
        rather than signing something a foreign relying party would accept.
        """

        self.registered()
        self.release("t")
        with self.assertRaises(PermissionError):
            self.store.sign_assertion(
                subject_id=SUBJECT, challenge=self.rp.challenge(), config=OTHER_CONFIG,
                release_token="t", now=1001.0,
            )

    def test_an_assertion_for_one_rp_does_not_verify_at_another(self):
        self.registered()
        self.release("t")
        challenge = self.rp.challenge()
        assertion = self.store.sign_assertion(
            subject_id=SUBJECT, challenge=challenge, config=CONFIG,
            release_token="t", now=1001.0,
        )
        foreign = RelyingParty(config=OTHER_CONFIG)
        foreign.register(SUBJECT, self.store.register(SUBJECT, CONFIG))
        foreign.issued.add(challenge)
        with self.assertRaises(VerificationError):
            foreign.verify(SUBJECT, assertion, challenge)


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


class AuthentikClientTests(unittest.TestCase):
    """Request shapes, without a network. Registration is admin-only; the veto
    path can only revoke."""

    def setUp(self):
        self.calls: list[tuple[str, str, bytes | None]] = []

    def transport(self, responses):
        def _transport(method, url, headers, body):
            self.calls.append((method, url, body))
            self.assertEqual(headers["Authorization"], "Bearer token")
            return responses.pop(0)
        return _transport

    def test_registration_refuses_loudly_instead_of_pretending(self):
        """authentik's admin WebAuthn API cannot create a credential.

        Verified live against 2026.8.0 on 2026-09-02: the serializer has no
        `credential_id`/`public_key`/`rp_id` fields, but those are NOT NULL
        columns, so create answers HTTP 500 and no device is made.

        This test used to assert the request body. That was asserting a call
        that can only ever fail, which is worse than no test — it would have
        gone green forever while registration was impossible in production.
        What matters now is that the method refuses in a way a caller cannot
        mistake for success, and that it does not burn a network call
        discovering that. Registration is a hands-on `ak shell` step; see the
        method's docstring.
        """

        client = AuthentikClient(
            base_url="https://idp.example", token="token",
            transport=self.transport([]),
        )
        with self.assertRaises(NotImplementedError):
            client.register_webauthn_device(
                username="someone", name="face", credential_id="Y3JlZA", public_key="cHVi",
            )
        self.assertEqual(self.calls, [])

    def test_termination_is_a_delete(self):
        client = AuthentikClient(
            base_url="https://idp.example", token="token",
            transport=self.transport([(204, b"")]),
        )
        self.assertTrue(client.terminate_session("abc"))
        self.assertEqual(self.calls[-1][0], "DELETE")

    def test_an_unconfigured_client_refuses_rather_than_falling_back(self):
        with self.assertRaises(AuthentikError):
            AuthentikClient(base_url="", token="").user_id("someone")

    def test_an_error_status_raises_rather_than_returning_empty(self):
        client = AuthentikClient(
            base_url="https://idp.example", token="token",
            transport=self.transport([(500, b"{}")]),
        )
        with self.assertRaises(AuthentikError):
            client.user_id("someone")


if __name__ == "__main__":
    unittest.main()


class AssertionWireShapeTests(OracleTestCase):
    """The assertion is emitted in WebAuthn's own JSON shape.

    A relying party parses the structure before it looks the credential up, so
    a flat payload fails as "Invalid device" — the same error an unknown
    credential gives. That sent the first live ceremony chasing the
    registration when the payload was the problem.
    """

    def assertion(self):
        self.registered()
        self.release("wire-shape")
        return self.store.sign_assertion(
            subject_id=SUBJECT, challenge=self.rp.challenge(), config=CONFIG,
            release_token="wire-shape", now=1001.0,
        )

    def test_the_credential_uses_the_browser_wire_shape(self):
        credential = self.assertion()["credential"]
        self.assertEqual(
            sorted(credential), ["clientExtensionResults", "id", "rawId", "response", "type"]
        )
        self.assertEqual(credential["type"], "public-key")
        self.assertEqual(credential["id"], credential["rawId"])
        self.assertEqual(
            sorted(credential["response"]),
            ["authenticatorData", "clientDataJSON", "signature", "userHandle"],
        )

    def test_the_nested_response_matches_the_flat_aliases(self):
        assertion = self.assertion()
        for field in ("clientDataJSON", "authenticatorData", "signature", "userHandle"):
            self.assertEqual(assertion["credential"]["response"][field], assertion[field], field)
        self.assertEqual(assertion["credential"]["id"], assertion["credentialId"])

    def test_no_private_material_appears_anywhere_in_the_payload(self):
        blob = json.dumps(self.assertion()).lower()
        for forbidden in ("private", "sealed", "secret", "scalar", "dek"):
            self.assertNotIn(forbidden, blob, forbidden)
