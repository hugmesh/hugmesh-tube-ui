import { Injectable } from '@angular/core';
import { ChallengeFactor, MfaResult, WebAuthnOptions } from './mfa.types';

/** The HTTP status every `/bff/mfa/*` call answers while MFA ships dark. */
const DARK_STATUS = 503;

/**
 * Client for the two `/bff/mfa/*` calls the step-up dialog needs (ported from
 * hugmesh-admin-ui `mfa/mfa.service.ts`, which carries the full enrol/list/remove set
 * Tube does not use). Same-origin by default: the fe-gateway routes `/bff/mfa/**` to the
 * platform BFF. `globalThis.__HUG_BFF_URL__` is the host's override, the same global
 * admin-ui reads, so a standalone dev shell can point at a remote BFF.
 *
 * Plain `fetch` with `credentials: 'include'` (the HttpOnly `bff_` cookie; the gateway
 * turns it into the bearer). It never throws: a network failure is a structured
 * non-dark error result. The owner is always the authenticated session, never a body field.
 */
@Injectable({ providedIn: 'root' })
export class MfaService {
  private get base(): string {
    return globalThis.__HUG_BFF_URL__ ?? '';
  }

  /** Request a WebAuthn assertion challenge for the step-up. */
  assertWebauthnOptions(): Promise<MfaResult<WebAuthnOptions>> {
    return this.post<WebAuthnOptions>('/bff/mfa/assert/webauthn/options');
  }

  /**
   * Satisfy the step-up with a TOTP code, a recovery code, or a WebAuthn assertion
   * (`credential` is the 6-digit code, the recovery code, or the assertion JSON). On
   * success the BFF stamps the caller's own session `mfa_satisfied`, which is what the
   * gateway's `MFA_SATISFIED` authority is derived from, so the retried call needs no token.
   */
  challenge(factor: ChallengeFactor, credential: string): Promise<MfaResult<{ mfaSatisfied: boolean }>> {
    return this.post('/bff/mfa/challenge', { factor, credential });
  }

  private async post<T>(path: string, body?: unknown): Promise<MfaResult<T>> {
    const headers: Record<string, string> = { accept: 'application/json' };
    const init: RequestInit = { method: 'POST', headers, credentials: 'include' };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let r: Response;
    try {
      r = await fetch(`${this.base}${path}`, init);
    } catch {
      return { ok: false, dark: false, status: 0, error: 'Network error' };
    }
    if (r.status === DARK_STATUS) return { ok: false, dark: true, status: DARK_STATUS };
    const data = (await r.json().catch(() => undefined)) as
      | (T & { error?: string })
      | undefined;
    if (!r.ok) {
      return { ok: false, dark: false, status: r.status, error: data?.error || `HTTP ${r.status}` };
    }
    return { ok: true, dark: false, status: r.status, data: data as T };
  }
}
