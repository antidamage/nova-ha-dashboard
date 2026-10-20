"""Signing-oracle ceremony, token lifecycle and relying-party pinning tests."""

from __future__ import annotations

import json
import sqlite3
import unittest

from authenticator import AuthenticatorConfig, CredentialStore, ctap
from authenticator.harness import RelyingParty, VerificationError
from authenticator_fixtures import CONFIG, OTHER_CONFIG, SUBJECT, OracleTestCase


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


if __name__ == "__main__":
    unittest.main()
