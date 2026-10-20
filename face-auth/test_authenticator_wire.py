"""Assertion wire-shape and authentik client request tests."""

from __future__ import annotations

import json
import unittest

from authenticator.authentik import AuthentikClient, AuthentikError
from authenticator_fixtures import CONFIG, SUBJECT, OracleTestCase


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
