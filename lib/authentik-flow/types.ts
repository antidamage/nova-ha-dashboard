export type FlowFieldError = { string?: string; code?: string };

export type DeviceChallenge = {
  device_class: string;
  device_uid: string;
  challenge: Record<string, unknown>;
  last_used?: string | null;
};

/**
 * One executor challenge. Deliberately loose: authentik adds fields between
 * versions, and a client that fails on an unrecognised key would break on
 * upgrade. The fields named here are the ones the surface actually reads.
 */
export type FlowChallenge = {
  component: string;
  flow_info?: { title?: string; cancel_url?: string; layout?: string };
  response_errors?: Record<string, FlowFieldError[]>;

  // ak-stage-identification
  user_fields?: string[];
  password_fields?: boolean;
  passwordless_url?: string | null;
  primary_action?: string;
  application_pre?: string;

  // ak-stage-authenticator-validate
  device_challenges?: DeviceChallenge[];
  pending_user?: string;

  // ak-stage-access-denied
  error_message?: string;

  // xak-flow-redirect
  to?: string;

  [key: string]: unknown;
};

/**
 * The JSON shape authentik's `validate_challenge_webauthn` feeds to
 * py_webauthn's `parse_authentication_credential_json` — read from the running
 * container rather than guessed.
 */
export type AssertionPayload = {
  id: string;
  rawId: string;
  type: string;
  clientExtensionResults: Record<string, unknown>;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle: string | null;
  };
};
