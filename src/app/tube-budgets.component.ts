import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { TubeService, Usage, TubeApiError } from './tube.service';
import { formatBytes } from './format-bytes';

/**
 * The "Storage Budgets" console — set a per-user download storage budget over
 * POST /bff/tube/admin/storage-budget (TubeStorageBudgetController). Manage-gated
 * (tubeManageGuard: TUBE_MANAGE = ADMIN|SUPERADMIN); a plain USER never reaches it.
 *
 *   set → POST /bff/tube/admin/storage-budget { userSubject, budgetBytes } → Usage
 *
 * The admin enters the budget in gigabytes (converted to bytes on submit). The
 * response Usage row (used / budget bytes) is shown so the admin sees the
 * applied budget and the user's current usage. Each set appends to a local
 * "current budgets/usage" list so the admin can review what they've applied this
 * session.
 *
 * a11y: a labelled form; each control has a <label> + aria-describedby help;
 * the result/error is announced (role="status"/"alert"); the budget input has a
 * non-negative constraint hint.
 */
@Component({
  selector: 'hug-tube-budgets',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './tube-budgets.component.html',
  styleUrl: './tube-budgets.component.scss',
})
export class TubeBudgetsComponent {
  private readonly tube = inject(TubeService);

  readonly userSubject = signal('');
  readonly budgetGb = signal(10);

  readonly busy = signal(false);
  readonly error = signal('');
  readonly touched = signal(false);
  /** The budgets/usage rows applied this session (most-recent first). */
  readonly applied = signal<Usage[]>([]);

  private readonly GB = 1024 * 1024 * 1024;

  /** True when the user-subject field is empty after the form was touched. */
  userInvalid(): boolean {
    return this.touched() && this.userSubject().trim().length === 0;
  }
  /** True when the budget field is negative after the form was touched
   *  (0 is allowed — it clears the budget). */
  budgetInvalid(): boolean {
    return this.touched() && !(this.budgetGb() >= 0);
  }
  /** Overall form validity — gates the submit call. */
  formValid(): boolean {
    return this.userSubject().trim().length > 0 && this.budgetGb() >= 0;
  }

  /**
   * POST the budget to `POST /bff/tube/admin/storage-budget`. On success,
   * upserts the returned {@link Usage} row into {@link applied} (de-duped by
   * user so a re-set replaces the prior row, most-recent first).
   */
  async submit(): Promise<void> {
    this.touched.set(true);
    this.error.set('');
    if (!this.formValid()) return;
    this.busy.set(true);
    try {
      const row = await this.tube.setBudget({
        userSubject: this.userSubject().trim(),
        budgetBytes: Math.round(this.budgetGb() * this.GB),
      });
      // De-dup by user (a re-set replaces the prior row), most-recent first.
      this.applied.update((list) => [
        row,
        ...list.filter((r) => r.userSubject !== row.userSubject),
      ]);
    } catch (e) {
      this.error.set(this.message(e));
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Human-readable byte count, e.g. `'1.5 GB'`. Handles null/undefined
   * (treated as 0 B). Uses binary prefixes (1 KB = 1024 B).
   *
   * @param n - Byte count, or null/undefined.
   * @returns Human-readable string.
   */
  formatBytes(n: number | null | undefined): string {
    return formatBytes(n);
  }

  /**
   * Usage percentage for the per-user usage bar (0–100, integer).
   * Returns 100 (full) when `budgetBytes <= 0` and the user has used
   * something; returns 0 when both are 0.
   *
   * @param u - The {@link Usage} row as returned by the budget-set response.
   */
  usagePercent(u: Usage): number {
    if (u.budgetBytes <= 0) return u.usedBytes > 0 ? 100 : 0;
    return Math.min(100, Math.round((u.usedBytes / u.budgetBytes) * 100));
  }

  /** Stable @for trackBy for the applied-budgets list. */
  trackUser = (_: number, u: Usage): string => u.userSubject;

  private message(e: unknown): string {
    if (e instanceof TubeApiError && e.isForbidden) {
      return 'The server denied this action — your role does not permit setting storage budgets.';
    }
    return 'Could not set the storage budget. Please try again.';
  }
}
