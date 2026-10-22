import { Injectable, signal } from '@angular/core';

/** What the open step-up prompt is for (spliced into the dialog's intro sentence). */
export interface StepUpRequest {
  readonly action: string;
}

/**
 * The seam between a gated call and the dialog. {@link TubeService} calls
 * {@link challenge} when the gateway refuses a call for want of a fresh second factor;
 * the console's {@code hug-tube-step-up} component renders {@link request} while it is
 * set and reports back through {@link resolve}. One prompt at a time: a second gated
 * call that fails while the dialog is open waits on the SAME answer rather than
 * stacking another dialog.
 */
@Injectable({ providedIn: 'root' })
export class StepUpService {
  /** The open prompt, or null when none is showing. */
  readonly request = signal<StepUpRequest | null>(null);

  private pending: Promise<boolean> | null = null;
  private settle: ((satisfied: boolean) => void) | null = null;

  /** Show the dialog; resolves true once the challenge is satisfied, false if dismissed. */
  challenge(action: string): Promise<boolean> {
    if (this.pending) return this.pending;
    this.request.set({ action });
    this.pending = new Promise<boolean>((resolve) => {
      this.settle = resolve;
    });
    return this.pending;
  }

  /** The dialog's verdict: `true` = challenge satisfied, `false` = dismissed. */
  resolve(satisfied: boolean): void {
    const settle = this.settle;
    this.settle = null;
    this.pending = null;
    this.request.set(null);
    settle?.(satisfied);
  }
}
