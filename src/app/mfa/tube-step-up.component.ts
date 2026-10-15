import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MfaService } from './mfa.service';
import { StepUpService } from './step-up.service';
import { ChallengeFactor } from './mfa.types';
import { getAssertion, webauthnSupported } from './webauthn';

type Method = 'totp' | 'recovery' | 'webauthn';

/**
 * The inline MFA step-up dialog for the Tube admin consoles. Ported from
 * hugmesh-admin-ui `MfaStepUpDialogComponent`, with two differences: it is driven by
 * {@link StepUpService} instead of inputs/outputs (the gated call is deep inside
 * {@link TubeService}, so there is no parent template to bind to), and it is mounted ONCE
 * in the console shell rather than beside each form.
 *
 * Collects a TOTP code, a recovery code or a passkey assertion, submits it to
 * `POST /bff/mfa/challenge`, and on success settles the pending promise `true` so the
 * original call is retried once. A 503 means MFA ships dark on this deployment: a terminal
 * "not enabled yet" state with only Close, settling `false` (the original 403 then
 * surfaces; it is never retried blind).
 *
 * a11y: a fieldset/legend chooses the method, each input has a visible label and
 * aria-describedby helptext, and the verdict is announced via role="alert". A plain
 * in-flow region rather than a modal overlay, so the form it gates stays reachable.
 */
@Component({
  selector: 'hug-tube-step-up',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './tube-step-up.component.html',
  styleUrl: './tube-step-up.component.scss',
})
export class TubeStepUpComponent {
  private readonly mfa = inject(MfaService);
  private readonly stepUp = inject(StepUpService);

  /** The open prompt (null = nothing to render). */
  readonly request = this.stepUp.request;

  readonly method = signal<Method>('totp');
  readonly error = signal('');
  readonly busy = signal(false);
  /** Set when the BFF answered 503: MFA is not launched on this deployment. */
  readonly dark = signal(false);

  /** The TOTP or recovery code typed by the user (plain ngModel field). */
  code = '';

  readonly webauthnAvailable = webauthnSupported();

  /** A TOTP code is 6 digits; a recovery code is non-blank. */
  codeValid(): boolean {
    const v = this.code.trim();
    if (this.method() === 'totp') return /^\d{6}$/.test(v);
    return v.length > 0;
  }

  setMethod(m: Method): void {
    this.method.set(m);
    this.code = '';
    this.error.set('');
  }

  async submitCode(): Promise<void> {
    if (!this.codeValid()) {
      this.error.set(
        this.method() === 'totp'
          ? 'Enter the 6-digit code from your authenticator app.'
          : 'Enter one of your recovery codes.',
      );
      return;
    }
    await this.send(this.method() as ChallengeFactor, this.code.trim());
  }

  async useWebauthn(): Promise<void> {
    if (!this.webauthnAvailable) {
      this.error.set('This browser does not support passkeys. Use a code instead.');
      return;
    }
    this.error.set('');
    this.busy.set(true);
    const opts = await this.mfa.assertWebauthnOptions();
    if (opts.dark) {
      this.busy.set(false);
      this.dark.set(true);
      return;
    }
    if (!opts.ok || !opts.data) {
      this.busy.set(false);
      this.error.set(opts.error || 'Could not start passkey verification.');
      return;
    }
    let assertion: string;
    try {
      assertion = await getAssertion(opts.data);
    } catch (e) {
      this.busy.set(false);
      this.error.set(this.passkeyError(e));
      return;
    }
    await this.send('webauthn', assertion, true);
  }

  /** Dismiss without retrying; the original 403 is what the console then shows. */
  cancel(): void {
    this.reset();
    this.stepUp.resolve(false);
  }

  private async send(factor: ChallengeFactor, credential: string, alreadyBusy = false): Promise<void> {
    this.error.set('');
    if (!alreadyBusy) this.busy.set(true);
    const r = await this.mfa.challenge(factor, credential);
    this.busy.set(false);
    if (r.dark) {
      this.dark.set(true);
      return;
    }
    if (!r.ok || !r.data?.mfaSatisfied) {
      this.error.set('That did not verify. Try again with a current code or your passkey.');
      return;
    }
    this.reset();
    this.stepUp.resolve(true);
  }

  private reset(): void {
    this.code = '';
    this.error.set('');
    this.dark.set(false);
    this.method.set('totp');
  }

  private passkeyError(e: unknown): string {
    const name = (e as { name?: string })?.name;
    if (name === 'NotAllowedError') return 'Passkey verification was cancelled or timed out.';
    return (e as { message?: string })?.message || 'Could not verify with a passkey.';
  }
}
