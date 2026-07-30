import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import {
  TubeService,
  DownloadJob,
  Subscription,
  ConnectStatus,
  TubeApiError,
} from './tube.service';
import { formatBytes } from './format-bytes';

/** The per-done-job player state. The signed URL is requested on demand from
 *  GET /bff/tube/media/sign for THAT JOB'S own contentPath (never an arbitrary
 *  path), so each watchable card tracks its own request:
 *    'idle'    — not yet requested,
 *    'loading' — sign request in flight,
 *    'ready'   — `url` holds the short-TTL signed media URL → <video src>,
 *    'error'   — the sign failed (403/expired/400); show an error + retry, no <video>. */
interface PlayerState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  url: string | null;
  message: string;
}

/** The Google-connect panel state. `known` is the ONLY state that offers the
 *  connect/sync/disconnect controls — it holds the ConnectStatus the BFF
 *  actually returned. `degraded` is the honest-disclosure envelope: the status
 *  read FAILED (BFF unreachable/erroring/stubbed), so the panel discloses the
 *  real failure and DISABLES the controls — it never guesses "not connected"
 *  and never lets a control pretend it will succeed. */
type ConnectPanel =
  | { kind: 'loading' }
  | { kind: 'known'; status: ConnectStatus }
  | { kind: 'degraded'; message: string };

/**
 * The "My Tube" user console — the TUBE_USE surface (tubeReadGuard: ROLE_TUBE).
 * Wires the user half of hugmesh-tube-bff-api:
 *   GET  /bff/tube/downloads      → my download queue (each job: video + state)
 *   POST /bff/tube/downloads      → enqueue jobs from my subscriptions
 *   GET  /bff/tube/subscriptions  → my mirrored subscribed channels (source of truth)
 *   POST /bff/tube/subscriptions/sync        → mirror my YouTube subs from Google
 *   GET  /bff/tube/google-connect/status     → my Google connection status
 *   GET  /bff/tube/google-connect/authorize  → the Google consent URL (connect)
 *   POST /bff/tube/google-connect/disconnect → revoke + soft-delete my connection
 *   GET  /bff/tube/media/sign     → a short-TTL signed URL for MY OWN done contentPath
 *
 * GOOGLE CONNECT (the OAuth hop): "Connect Google" fetches the consent URL from
 * the BFF (/google-connect/authorize — it carries a signed CSRF state binding
 * this principal) and FULL-PAGE-NAVIGATES to it. Google then sends the browser
 * to the BFF's own callback (GET /bff/tube/google-connect/callback?code&state —
 * a hop this component NEVER makes itself; the state, not a bearer,
 * authenticates it). Back on My Tube the panel re-reads /status. HONEST
 * DISCLOSURE: if the status read fails the panel goes DEGRADED — it shows the
 * real failure and disables connect/sync (never guessing "not connected", never
 * letting a control claim it will succeed); if /authorize answers without a
 * consent URL (unconfigured/stubbed BFF) the click surfaces that as an error
 * and does NOT navigate. `reauthRequired` (a failed refresh server-side)
 * disables sync with visible help-text and offers a re-connect instead.
 *
 * It shows:
 *   - my subscribed channels (the OWNER-SCOPED GET /bff/tube/subscriptions list — the
 *     single source of truth; NOT derived from distinct job channelIds),
 *   - my download queue (each job's title + state: queued|claimed|downloading|
 *     done|failed|skipped),
 *   - a storage-usage bar (used bytes from the bytes of my downloaded jobs),
 *   - an "Enqueue from subscriptions" action, and
 *   - in-platform viewing: a <video> player card for each `done` job. The player
 *     requests a short-TTL signed URL from GET /bff/tube/media/sign for THAT JOB'S
 *     OWN contentPath (which came from my owner-scoped queue), then sets <video src>
 *     to the returned signed URL. Only `done` jobs get a player; a sign 403/expired
 *     shows an error + retry, never a broken <video>.
 *
 * OWNER SAFETY: the player only ever signs a contentPath that came from a row in MY
 * OWN owner-scoped queue response. There is no user-typed path and no path borrowed
 * from another list; play(job) reads job.contentPath off the queue row it was given,
 * so a caller can never request another user's contentPath. (The BFF re-checks the
 * path embeds the caller's own /<domain>/<subject>/ prefix and 403s otherwise.)
 *
 * The STORAGE-BUDGET-FULL gate (the canonical disabled+helptext case): the BFF's
 * pause-on-full marks NEW enqueued work `skipped` when the user's storage budget
 * is full. When the queue contains `skipped` jobs, the budget is full, so the
 * "Enqueue from subscriptions" button is DISABLED and paired with the visible
 * help-text "Your storage budget is full — an admin can raise it". The UI never
 * claims the action will succeed when the budget is full.
 *
 * Default-deny use: a ROLE_TUBE user without an active tube_access use grant (or
 * under a ban) gets a 403 from the BFF TubeAccessGuard; this surfaces it as an
 * explanatory "access not yet granted" message rather than a generic error.
 *
 * a11y: h2 region headings; loading/empty/error states announced
 * (role="status"/role="alert"); the usage bar is a labelled role="progressbar"
 * with aria-valuenow/min/max; the disabled enqueue button keeps a visible
 * describedby help reason; each video player carries an accessibleName.
 */
@Component({
  selector: 'hug-tube-my',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './tube-my.component.html',
  styleUrl: './tube-my.component.scss',
})
export class TubeMyComponent implements OnInit {
  private readonly tube = inject(TubeService);

  readonly jobs = signal<DownloadJob[]>([]);
  /** The caller's OWN subscribed channels from GET /bff/tube/subscriptions — the
   *  single source of truth (no longer derived from distinct job channelIds). */
  readonly subscriptions = signal<Subscription[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  /** Set when the BFF returns 403 — the default-deny use floor (no grant / banned). */
  readonly accessDenied = signal(false);
  readonly enqueuing = signal(false);
  readonly notice = signal('');

  /** Per-done-job player state, keyed by job id. A card's <video> is only shown once
   *  its entry is 'ready' (it holds the signed URL); 'error' shows a retry instead. */
  readonly players = signal<Record<string, PlayerState>>({});

  // ── Google connect panel ──────────────────────────────────────────────────

  /** The connect panel state (see ConnectPanel — 'degraded' is the honest
   *  disclosure envelope when the status read failed). */
  readonly connect = signal<ConnectPanel>({ kind: 'loading' });
  /** The /authorize fetch is in flight (the click before the OAuth hop). */
  readonly connectBusy = signal(false);
  /** POST /bff/tube/subscriptions/sync in flight. */
  readonly syncing = signal(false);
  /** POST /bff/tube/google-connect/disconnect in flight. */
  readonly disconnecting = signal(false);
  /** A connect/sync/disconnect ACTION failure (the panel-level alert). */
  readonly connectError = signal('');

  /** The ConnectStatus the BFF actually returned (null while loading/degraded). */
  readonly connectStatus = computed<ConnectStatus | null>(() => {
    const c = this.connect();
    return c.kind === 'known' ? c.status : null;
  });
  /** The degraded-envelope disclosure ('' unless the status read failed). */
  readonly connectDegraded = computed(() => {
    const c = this.connect();
    return c.kind === 'degraded' ? c.message : '';
  });
  readonly googleConnected = computed(() => this.connectStatus()?.connected === true);
  readonly reauthRequired = computed(() => this.connectStatus()?.reauthRequired === true);
  /** Sync is only offered when the BFF says connected AND the credential is not
   *  known-bad — a reauth-required sync WILL be stopped server-side, so the UI
   *  never claims it can succeed. */
  readonly canSync = computed(() => this.googleConnected() && !this.reauthRequired());

  /** The completed jobs that have a contentPath = watchable in-platform. */
  readonly watchable = computed(() =>
    this.jobs().filter((j) => j.state === 'done' && !!j.contentPath),
  );

  /** Bytes the user is currently using = the sum of completed jobs' bytes. */
  readonly usedBytes = computed(() =>
    this.jobs().reduce((sum, j) => sum + (j.state === 'done' ? j.bytes ?? 0 : 0), 0),
  );

  /** The budget is FULL when the BFF's pause-on-full has marked new work
   *  `skipped` — the authoritative signal that the user's storage budget cap was
   *  hit (the user-facing surface has no budget GET; `skipped` jobs ARE the
   *  budget-full indicator). */
  readonly budgetFull = computed(() => this.jobs().some((j) => j.state === 'skipped'));

  /** A rough usage fraction for the bar. With no user budget GET, we show the
   *  bar as FULL (100%) when the budget is full, else a relative fill against
   *  the largest single completed download as a coarse indicator. */
  readonly usagePercent = computed(() => {
    if (this.budgetFull()) return 100;
    const used = this.usedBytes();
    if (used === 0) return 0;
    // Coarse indicator only — clamp to <100 so a non-full state never reads full.
    return Math.min(95, Math.max(5, Math.round((used / (used + 1)) * 50)));
  });

  /** Stable @for trackBy for the jobs list. */
  trackId = (_: number, j: DownloadJob): string => j.id;
  /** Stable @for trackBy for the subscriptions list. */
  trackChannel = (_: number, s: Subscription): string => s.channelId;

  ngOnInit(): void {
    void this.reload();
  }

  /** Load (or refresh) the caller's download queue from
   *  `GET /bff/tube/downloads`. A 403 from the BFF TubeAccessGuard
   *  (default-deny use floor) is surfaced as {@link accessDenied} rather
   *  than a generic error so the UI can explain the grant requirement. */
  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    this.accessDenied.set(false);
    this.players.set({}); // drop stale signed URLs; re-sign on demand for the fresh queue
    // The connect status loads in parallel and NEVER breaks the page — its own
    // failure becomes the panel's degraded envelope (loadConnectStatus never throws).
    const connectLoad = this.loadConnectStatus();
    try {
      // Both are owner-scoped server-side. The queue is the source of truth for the
      // watchable contentPaths; the subscriptions list is the source of truth for the
      // subscribed channels (no longer derived from job channelIds).
      const [queue, subs] = await Promise.all([
        this.tube.listQueue(),
        this.tube.getSubscriptions(),
      ]);
      this.jobs.set(queue.jobs ?? []);
      this.subscriptions.set(subs.subscriptions ?? []);
    } catch (e) {
      this.handle(e);
    } finally {
      this.loading.set(false);
    }
    await connectLoad;
  }

  /** Read GET /bff/tube/google-connect/status into the panel. Never throws: a
   *  failure becomes the DEGRADED envelope — the panel discloses the real
   *  failure and the controls are disabled. The UI never guesses a connection
   *  state it could not read, and never fakes a healthy panel. */
  private async loadConnectStatus(): Promise<void> {
    this.connect.set({ kind: 'loading' });
    try {
      const status = await this.tube.googleConnectStatus();
      this.connect.set({ kind: 'known', status: status ?? {} });
    } catch (e) {
      const detail =
        e instanceof TubeApiError
          ? e.isForbidden
            ? 'the BFF denied access (403)'
            : e.status > 0
              ? `the connect endpoint failed (HTTP ${e.status})`
              : 'the connect endpoint did not respond'
          : 'the connect endpoint did not respond';
      this.connect.set({
        kind: 'degraded',
        message:
          `Google connection status is unavailable — ${detail}. ` +
          'Connect and sync are disabled until it recovers; your already-synced channels below are unaffected.',
      });
    }
  }

  /** The player state for a job (defaults to idle = "not requested yet"). */
  playerFor(jobId: string): PlayerState {
    return this.players()[jobId] ?? { status: 'idle', url: null, message: '' };
  }

  /**
   * Request a signed media URL for a DONE job's OWN contentPath and, on success, expose
   * it as the <video src>.
   *
   * OWNER SAFETY: the only path ever signed is `job.contentPath` read off the queue row
   * passed in — a row from MY OWN owner-scoped GET /bff/tube/downloads response. There is
   * no parameter for an arbitrary/typed path, and the queue is owner-scoped server-side,
   * so this can never sign another user's content. A non-done job (or one without a
   * contentPath) is refused here as belt-and-braces (the template never offers it either).
   */
  async play(job: DownloadJob): Promise<void> {
    if (job.state !== 'done' || !job.contentPath) return; // only own, completed jobs
    this.setPlayer(job.id, { status: 'loading', url: null, message: '' });
    try {
      const signed = await this.tube.signMedia(job.contentPath);
      this.setPlayer(job.id, { status: 'ready', url: signed.url, message: '' });
    } catch (e) {
      // 403 = expired/cross-user (the BFF re-checks owner); 400 = malformed; anything
      // else = transient. Never leave a broken <video> — show an error + retry.
      const msg =
        e instanceof TubeApiError && e.isForbidden
          ? 'This video link expired or is not available. Try again.'
          : 'Could not load this video. Try again.';
      this.setPlayer(job.id, { status: 'error', url: null, message: msg });
    }
  }

  private setPlayer(jobId: string, state: PlayerState): void {
    this.players.update((m) => ({ ...m, [jobId]: state }));
  }

  /**
   * Enqueue new downloads from the caller's subscriptions via
   * `POST /bff/tube/downloads`. Belt-and-braces guard: never POSTs when
   * {@link budgetFull} is true (the button is also disabled in the template
   * when the budget is full). Updates the jobs list from the response (the
   * BFF returns the full updated queue including new `queued` entries).
   */
  async enqueue(): Promise<void> {
    if (this.budgetFull()) return;
    this.enqueuing.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      const res = await this.tube.enqueueFromSubscriptions();
      this.jobs.set(res.jobs ?? []);
      this.players.set({}); // re-sign on demand against the refreshed queue rows
      this.notice.set('Enqueued new downloads from your subscriptions.');
    } catch (e) {
      this.handle(e);
    } finally {
      this.enqueuing.set(false);
    }
  }

  // ── Google connect actions ────────────────────────────────────────────────

  /**
   * Start (or restart, when reauthRequired) the Google connect flow: fetch the
   * consent URL from GET /bff/tube/google-connect/authorize and FULL-PAGE-NAVIGATE
   * to it. Google later redirects the browser to the BFF's own callback
   * (?code&state — the signed state binds this principal; this component never
   * calls the callback itself).
   *
   * HONEST DISCLOSURE: only offered from a 'known' panel (belt-and-braces — the
   * template hides it otherwise). If the BFF errors, or answers WITHOUT a consent
   * URL (unconfigured/stubbed), the click surfaces the real failure and does NOT
   * navigate — it never pretends the flow started.
   */
  async connectGoogle(): Promise<void> {
    if (this.connect().kind !== 'known') return; // degraded/loading: never start a blind flow
    this.connectBusy.set(true);
    this.connectError.set('');
    try {
      const res = await this.tube.googleAuthorizeUrl();
      const url = res?.authorizeUrl;
      if (!url) {
        // The BFF answered 200 but built no consent URL — a stubbed/unconfigured
        // connect backend. Disclose exactly that; do not navigate anywhere.
        this.connectError.set(
          'The connect service returned no Google consent URL (it may not be configured yet) — the connection cannot be started. Nothing was changed.',
        );
        return;
      }
      this.leaveFor(url);
    } catch (e) {
      this.connectError.set(
        e instanceof TubeApiError && e.isForbidden
          ? 'The BFF refused to start the Google connect flow (403 — no active Tube use grant, or banned).'
          : 'Could not reach the connect service to start the Google flow. Nothing was changed — try again.',
      );
    } finally {
      this.connectBusy.set(false);
    }
  }

  /** The full-page navigation that leaves the SPA for Google's consent screen.
   *  A seam so unit tests can observe the exact URL without navigating Karma away. */
  protected leaveFor(url: string): void {
    window.location.assign(url);
  }

  /**
   * POST /bff/tube/subscriptions/sync → mirror my YouTube subscriptions, then
   * re-read the (owner-scoped) subscriptions list so the panel below reflects
   * the upserted rows. Only offered when canSync() (connected and NOT
   * reauth-required — a known-bad credential WILL be stopped server-side, so the
   * button is disabled with help-text instead of claiming it can succeed).
   * On failure the connect status is re-read: a failed Google refresh marks
   * reauth_required server-side and the panel must show that truth.
   */
  async sync(): Promise<void> {
    if (!this.canSync()) return; // belt-and-braces: never POST a sync that cannot succeed
    this.syncing.set(true);
    this.connectError.set('');
    this.notice.set('');
    try {
      const res = await this.tube.syncSubscriptions();
      const subs = await this.tube.getSubscriptions();
      this.subscriptions.set(subs.subscriptions ?? []);
      const n = res?.synced ?? 0;
      this.notice.set(`Synced ${n} subscription${n === 1 ? '' : 's'} from YouTube.`);
    } catch (e) {
      if (e instanceof TubeApiError && e.isForbidden) {
        this.handle(e); // the default-deny use floor — the page-level denied panel
      } else {
        this.connectError.set(
          'Subscription sync failed — your channels were NOT updated. If Google rejected the stored credential, reconnect below.',
        );
      }
      // The BFF marks reauth_required on a failed refresh — surface the truth.
      await this.loadConnectStatus();
    } finally {
      this.syncing.set(false);
    }
  }

  /** POST /bff/tube/google-connect/disconnect — best-effort revoke at Google +
   *  soft-revoke the stored connection. The panel adopts the status the BFF
   *  returns; a failure is disclosed (the connection state is then whatever the
   *  BFF still holds — nothing is faked as disconnected). */
  async disconnectGoogle(): Promise<void> {
    if (this.connect().kind !== 'known') return;
    this.disconnecting.set(true);
    this.connectError.set('');
    this.notice.set('');
    try {
      const status = await this.tube.googleDisconnect();
      this.connect.set({ kind: 'known', status: status ?? {} });
      this.notice.set('Google account disconnected.');
    } catch {
      this.connectError.set(
        'Disconnect failed — your Google connection was NOT changed. Try again.',
      );
    } finally {
      this.disconnecting.set(false);
    }
  }

  /**
   * Human-readable byte count using binary prefixes (1 KB = 1024 B).
   * Used in the usage bar label and per-job size display.
   *
   * @param n - Byte count, or null/undefined (treated as 0 B).
   * @returns Human-readable string, e.g. `'1.5 GB'`.
   */
  formatBytes(n: number | null | undefined): string {
    return formatBytes(n);
  }

  /**
   * Central error handler for the reload and enqueue paths. A 403 from
   * the BFF TubeAccessGuard (default-deny use floor: the user holds
   * ROLE_TUBE but has no active tube_access use grant, or is banned) is
   * surfaced as {@link accessDenied} with an explanatory message rather
   * than a generic error — the tube model distinguishes "no role" (blocked
   * by the route guard) from "has role but no grant" (a 403 at request time).
   */
  private handle(e: unknown): void {
    if (e instanceof TubeApiError && e.isForbidden) {
      this.accessDenied.set(true);
      this.jobs.set([]);
      return;
    }
    this.error.set('Could not load your Tube downloads. Please try again.');
  }
}
