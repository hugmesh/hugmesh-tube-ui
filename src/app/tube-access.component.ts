import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { TubeService, TubeAccess, TubeApiError } from './tube.service';
import { SessionService } from './session.service';

type AccessAction = 'grant' | 'timeout' | 'ban';

/**
 * The "Tube Access" console — the grant / timeout / ban / restore overlay over
 * /bff/tube/admin/access/** (TubeAccessController). Manage-gated (tubeManageGuard:
 * TUBE_MANAGE = ADMIN|SUPERADMIN); a plain USER never reaches it.
 *
 *   grant   → POST /bff/tube/admin/access/grant   (a permanent may-use grant —
 *             the way to lift a user above the default-deny use floor)
 *   timeout → POST /bff/tube/admin/access/timeout (a bounded ban; auto-restores)
 *   ban     → POST /bff/tube/admin/access/ban     (a permanent ban; denies even
 *             an active grantee — ban>grant, the precedence the bff
 *             TubeAccessGuard enforces, surfaced clearly here)
 *   restore → DELETE /bff/tube/admin/access/banned/{user} (lift a ban)
 *   remove  → DELETE /bff/tube/admin/access/use/{user}    (remove a grant)
 *
 * SUPERADMIN additionally sees the LIST + HISTORY (manage-all) panel backed by
 * /bff/tube/superadmin/access (canManageAll). An ADMIN sees only the write form.
 *
 * a11y: a labelled fieldset for the action form; each control has a <label> +
 * aria-describedby help; the result/error is announced (role="status"/"alert");
 * a clear note that BAN takes precedence over any grant.
 */
@Component({
  selector: 'hug-tube-access',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './tube-access.component.html',
  styleUrl: './tube-access.component.scss',
})
export class TubeAccessComponent implements OnInit {
  private readonly tube = inject(TubeService);
  private readonly session = inject(SessionService);

  /** SUPERADMIN-only: the list-all + history (manage-all) panel. */
  readonly canManageAll = this.session.canManageAll;

  readonly action = signal<AccessAction>('grant');
  readonly userSubject = signal('');
  readonly reason = signal('');
  /** timeout duration in hours (converted to ttlSeconds on submit). */
  readonly timeoutHours = signal(24);

  readonly busy = signal(false);
  readonly error = signal('');
  readonly result = signal<TubeAccess | null>(null);
  readonly notice = signal('');
  readonly touched = signal(false);

  // ── manage-all (superadmin) state ──
  readonly active = signal<TubeAccess[]>([]);
  readonly activeLoading = signal(false);
  readonly activeError = signal('');
  readonly historyUser = signal('');
  readonly history = signal<TubeAccess[]>([]);
  readonly historyLoaded = signal(false);

  readonly actions: ReadonlyArray<{ value: AccessAction; label: string; help: string }> = [
    { value: 'grant', label: 'Grant use', help: 'Give a user permanent permission to use Tube (lifts them above the default-deny use floor).' },
    { value: 'timeout', label: 'Time out', help: 'Block a user from using Tube for a bounded window; access auto-restores when it expires.' },
    { value: 'ban', label: 'Ban', help: 'Permanently block a user from using Tube. A ban takes precedence over any grant.' },
  ];

  ngOnInit(): void {
    // Eagerly load the active-access list for superadmins so the panel is
    // pre-populated when the view renders (admins skip this — no list panel).
    if (this.canManageAll()) void this.loadActive();
  }

  /** Switch the active action and clear the previous result/error/notice. */
  setAction(a: string): void {
    this.action.set((a as AccessAction) ?? 'grant');
    this.result.set(null);
    this.error.set('');
    this.notice.set('');
  }

  /** True when the user-subject field is empty after the form was touched
   *  (drives the aria-invalid + validation-message binding). */
  userInvalid(): boolean {
    return this.touched() && this.userSubject().trim().length === 0;
  }
  /** True when the timeout-hours field is invalid after the form was touched
   *  (must be > 0 for a timeout action). */
  ttlInvalid(): boolean {
    return this.action() === 'timeout' && this.touched() && !(this.timeoutHours() > 0);
  }
  /** Overall form validity — gates the submit call (also checked in submit()
   *  after marking touched, as a belt-and-braces check). */
  formValid(): boolean {
    if (this.userSubject().trim().length === 0) return false;
    if (this.action() === 'timeout' && !(this.timeoutHours() > 0)) return false;
    return true;
  }

  async submit(): Promise<void> {
    this.touched.set(true);
    this.error.set('');
    this.notice.set('');
    this.result.set(null);
    if (!this.formValid()) return;
    this.busy.set(true);
    const user = this.userSubject().trim();
    const reason = this.reason().trim() || undefined;
    try {
      let row: TubeAccess;
      switch (this.action()) {
        case 'grant':
          row = await this.tube.grant({ userSubject: user, reason });
          break;
        case 'ban':
          row = await this.tube.ban({ userSubject: user, reason });
          break;
        case 'timeout':
        default:
          row = await this.tube.timeout({
            userSubject: user,
            ttlSeconds: Math.round(this.timeoutHours() * 3600),
            reason,
          });
          break;
      }
      this.result.set(row);
      if (this.canManageAll()) void this.loadActive();
    } catch (e) {
      this.error.set(this.message(e));
    } finally {
      this.busy.set(false);
    }
  }

  /** Lift a ban (restore use). */
  async restore(user: string): Promise<void> {
    await this.runRevoke('banned', user, `Ban lifted for ${user} — Tube use restored.`);
  }
  /** Remove a grant. */
  async removeGrant(user: string): Promise<void> {
    await this.runRevoke('use', user, `Use grant removed for ${user}.`);
  }

  private async runRevoke(type: 'use' | 'banned', user: string, ok: string): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await this.tube.revoke(type, user);
      this.notice.set(ok);
      this.result.set(null);
      if (this.canManageAll()) void this.loadActive();
    } catch (e) {
      this.error.set(this.message(e));
    } finally {
      this.busy.set(false);
    }
  }

  // ── manage-all (superadmin) ──

  async loadActive(): Promise<void> {
    this.activeLoading.set(true);
    this.activeError.set('');
    try {
      const res = await this.tube.listActiveAccess();
      this.active.set(res.access ?? []);
    } catch (e) {
      this.activeError.set(this.message(e));
    } finally {
      this.activeLoading.set(false);
    }
  }

  async loadHistory(): Promise<void> {
    const user = this.historyUser().trim();
    if (!user) return;
    this.activeError.set('');
    try {
      const res = await this.tube.accessHistory(user);
      this.history.set(res.access ?? []);
      this.historyLoaded.set(true);
    } catch (e) {
      this.activeError.set(this.message(e));
    }
  }

  trackId = (_: number, a: TubeAccess): string => a.id;

  private message(e: unknown): string {
    if (e instanceof TubeApiError && e.isForbidden) {
      return 'The server denied this action — your role does not permit managing Tube access.';
    }
    return 'Could not apply the access change. Please try again.';
  }
}
