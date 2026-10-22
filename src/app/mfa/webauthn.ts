import { WebAuthnOptions } from './mfa.types';

/**
 * WebAuthn plumbing for the step-up dialog's passkey leg (the assertion half of
 * hugmesh-admin-ui `mfa/webauthn.ts`; Tube never enrols a factor, so registration is
 * not ported). The BFF runs its own ceremony: the UI turns its base64url challenge into
 * `PublicKeyCredentialRequestOptions`, calls `navigator.credentials.get()`, and sends the
 * serialised result back as a JSON string.
 */

/** Decode base64url (no padding) to bytes backed by a plain ArrayBuffer. */
export function base64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encode bytes to base64url (no padding), the form the BFF expects back. */
export function bytesToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Whether this browser exposes the WebAuthn API at all. */
export function webauthnSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.credentials?.get;
}

/** Serialise an assertion credential into the JSON string the BFF verifies. */
export function assertionToJson(credential: PublicKeyCredential): string {
  const response = credential.response as AuthenticatorAssertionResponse;
  const resp: Record<string, unknown> = {
    clientDataJSON: bytesToBase64url(response.clientDataJSON),
    authenticatorData: bytesToBase64url(response.authenticatorData),
    signature: bytesToBase64url(response.signature),
  };
  if (response.userHandle) resp['userHandle'] = bytesToBase64url(response.userHandle);
  return JSON.stringify({
    id: credential.id,
    rawId: bytesToBase64url(credential.rawId),
    type: credential.type,
    response: resp,
  });
}

/** Run a WebAuthn ASSERTION from the BFF's options; returns the JSON for the challenge. */
export async function getAssertion(opts: WebAuthnOptions): Promise<string> {
  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: base64urlToBytes(opts.challenge),
    rpId: opts.rpId,
    userVerification: 'preferred',
    timeout: 60_000,
  };
  const credential = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
  if (!credential) throw new Error('Passkey verification was cancelled.');
  return assertionToJson(credential);
}
