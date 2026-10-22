/**
 * The slice of the `/bff/mfa/*` contract the Tube step-up dialog uses (ported from
 * hugmesh-admin-ui `mfa/mfa.types.ts`). The server is the shared hugmesh-auth-core
 * `MfaChallengeController`; the UI never invents shapes it does not return.
 */

/** WebAuthn assertion options returned by `POST /bff/mfa/assert/webauthn/options`. */
export interface WebAuthnOptions {
  challenge: string;
  rpId: string;
  rpName: string;
}

/** The factor kinds accepted by `POST /bff/mfa/challenge`. */
export type ChallengeFactor = 'totp' | 'webauthn' | 'recovery';

/**
 * Outcome wrapper. Every `/bff/mfa/*` call answers 503 while MFA ships dark
 * (`app.casdoor.mfa.enabled=false`); that is `dark`, not an error.
 */
export interface MfaResult<T> {
  ok: boolean;
  /** True only when the server answered 503. */
  dark: boolean;
  /** HTTP status (0 on a network failure). */
  status: number;
  data?: T;
  error?: string;
}
