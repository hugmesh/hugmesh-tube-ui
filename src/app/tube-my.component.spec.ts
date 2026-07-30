import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TubeMyComponent } from './tube-my.component';
import {
  TubeService,
  DownloadJob,
  JobList,
  Subscription,
  SubscriptionList,
  SignedUrl,
  ConnectStatus,
  TubeApiError,
} from './tube.service';

function job(partial: Partial<DownloadJob>): DownloadJob {
  return {
    id: 'id', domain: 'd', userSubject: 's', channelId: 'c', videoId: 'v',
    title: 'Video', state: 'queued', claimedBy: null, claimedAt: null, attempts: 0,
    lastError: null, bytes: null, contentPath: null, createdAt: '', updatedAt: '',
    ...partial,
  };
}

function sub(partial: Partial<Subscription>): Subscription {
  return { channelId: 'chan', channelTitle: 'Channel', thumbnailUrl: null, syncedAt: null, ...partial };
}

describe('TubeMyComponent (My Tube user console)', () => {
  let fixture: ComponentFixture<TubeMyComponent>;
  let tube: jasmine.SpyObj<TubeService>;

  /**
   * Wire the component against a fully-stubbed TubeService.
   * `queue`:   the GET /bff/tube/downloads result (or a rejected promise for error paths).
   * `subs`:    the GET /bff/tube/subscriptions result (defaults to empty).
   * `connect`: the GET /bff/tube/google-connect/status result (defaults to
   *            not-connected; pass a rejected promise for the degraded envelope).
   */
  async function setup(
    queue: JobList | Promise<never>,
    subs: SubscriptionList | Promise<never> = { subscriptions: [] },
    connect: ConnectStatus | Promise<never> = { connected: false },
  ): Promise<void> {
    tube = jasmine.createSpyObj<TubeService>('TubeService', [
      'listQueue',
      'enqueueFromSubscriptions',
      'getSubscriptions',
      'signMedia',
      'googleConnectStatus',
      'googleAuthorizeUrl',
      'googleDisconnect',
      'syncSubscriptions',
    ]);
    if (queue instanceof Promise) tube.listQueue.and.returnValue(queue);
    else tube.listQueue.and.resolveTo(queue);
    if (subs instanceof Promise) tube.getSubscriptions.and.returnValue(subs);
    else tube.getSubscriptions.and.resolveTo(subs);
    if (connect instanceof Promise) tube.googleConnectStatus.and.returnValue(connect);
    else tube.googleConnectStatus.and.resolveTo(connect);
    await TestBed.configureTestingModule({
      imports: [TubeMyComponent],
      providers: [{ provide: TubeService, useValue: tube }],
    }).compileComponents();
    fixture = TestBed.createComponent(TubeMyComponent);
    fixture.detectChanges();
    // reload() awaits Promise.all([listQueue, getSubscriptions]); flush both settles
    // (whenStable twice covers the extra Promise.all microtask tick) then render.
    await fixture.whenStable();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('loads my queue on init (GET /bff/tube/downloads)', async () => {
    await setup({ jobs: [job({ id: 'a', state: 'done', bytes: 100, contentPath: '/d/s/a.mp4' })] });
    expect(tube.listQueue).toHaveBeenCalled();
    expect(el().querySelector('[data-testid="tube-job-a"]')).not.toBeNull();
  });

  // ── Subscriptions: REAL GET /bff/tube/subscriptions (single source of truth) ──

  it('lists subscriptions from GET /bff/tube/subscriptions, NOT derived from job channelIds', async () => {
    await setup(
      // The queue has channels chan-9 / chan-9 — if the old derive-from-jobs path were
      // still live the list would show chan-9. It must NOT: subscriptions come from the
      // real subscriptions endpoint.
      { jobs: [job({ id: 'a', channelId: 'chan-9' }), job({ id: 'b', channelId: 'chan-9' })] },
      { subscriptions: [sub({ channelId: 'chan-1', channelTitle: 'Cooking' }), sub({ channelId: 'chan-2', channelTitle: 'Music' })] },
    );
    expect(tube.getSubscriptions).toHaveBeenCalled();
    expect(fixture.componentInstance.subscriptions().map((s) => s.channelId)).toEqual(['chan-1', 'chan-2']);
    expect(el().querySelector('[data-testid="tube-sub-chan-1"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="tube-sub-chan-2"]')).not.toBeNull();
    // chan-9 (a queue channelId that is NOT in the subscriptions list) is NOT shown.
    expect(el().querySelector('[data-testid="tube-sub-chan-9"]')).toBeNull();
    // The channel title from the DTO is rendered.
    expect(el().querySelector('[data-testid="tube-sub-chan-1"]')!.textContent).toContain('Cooking');
  });

  it('an empty subscriptions list shows the subs empty state', async () => {
    await setup({ jobs: [job({ id: 'a' })] }, { subscriptions: [] });
    expect(el().querySelector('[data-testid="tube-subs-empty"]')).not.toBeNull();
  });

  it('CANONICAL GATE: when the budget is full (a skipped job), the enqueue button is DISABLED with the exact help-text', async () => {
    await setup({ jobs: [job({ id: 'a', state: 'skipped' })] });
    expect(fixture.componentInstance.budgetFull()).toBeTrue();
    const btn = el().querySelector<HTMLButtonElement>('[data-testid="tube-enqueue"]')!;
    expect(btn.disabled).withContext('enqueue disabled when budget full').toBeTrue();
    const help = el().querySelector('[data-testid="tube-enqueue-help"]')!;
    expect(help.textContent).toContain('Your storage budget is full — an admin can raise it');
    // The button references the help text for screen readers (disabled+helptext pairing).
    expect(btn.getAttribute('aria-describedby')).toBe('tube-enqueue-help');
  });

  it('does NOT POST enqueue when the budget is full (UI never claims success)', async () => {
    await setup({ jobs: [job({ state: 'skipped' })] });
    await fixture.componentInstance.enqueue();
    expect(tube.enqueueFromSubscriptions).not.toHaveBeenCalled();
  });

  it('enqueue happy path: button enabled, POSTs, refreshes the queue', async () => {
    await setup({ jobs: [job({ id: 'a', state: 'queued' })] });
    const btn = el().querySelector<HTMLButtonElement>('[data-testid="tube-enqueue"]')!;
    expect(btn.disabled).toBeFalse();
    tube.enqueueFromSubscriptions.and.resolveTo({ jobs: [job({ id: 'a' }), job({ id: 'b' })] });
    await fixture.componentInstance.enqueue();
    fixture.detectChanges();
    expect(tube.enqueueFromSubscriptions).toHaveBeenCalled();
    expect(el().querySelector('[data-testid="tube-my-notice"]')).not.toBeNull();
  });

  it('a 403 (default-deny use) shows the "access not yet granted" panel, not a generic error', async () => {
    await setup(Promise.reject(new TubeApiError(403, 'forbidden')) as Promise<never>);
    expect(fixture.componentInstance.accessDenied()).toBeTrue();
    expect(el().querySelector('[data-testid="tube-my-access-denied"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="tube-my-error"]')).toBeNull();
  });

  it('a non-403 error shows the generic error + a Retry', async () => {
    await setup(Promise.reject(new TubeApiError(500, 'boom')) as Promise<never>);
    expect(el().querySelector('[data-testid="tube-my-error"]')).not.toBeNull();
  });

  // ── Google connect / subscription sync panel ──────────────────────────────

  it('renders the Connect Google control for an eligible (granted, not-yet-connected) user', async () => {
    await setup({ jobs: [] }, { subscriptions: [] }, { connected: false });
    expect(tube.googleConnectStatus).toHaveBeenCalled();
    const btn = el().querySelector<HTMLButtonElement>('[data-testid="tube-google-connect"]')!;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBeFalse();
    expect(btn.textContent).toContain('Connect Google');
    // disabled+helptext pairing idiom: the control references its visible help text.
    expect(btn.getAttribute('aria-describedby')).toBe('tube-google-help');
    // Not connected → no sync/disconnect controls are offered.
    expect(el().querySelector('[data-testid="tube-google-sync"]')).toBeNull();
    expect(el().querySelector('[data-testid="tube-google-disconnect"]')).toBeNull();
  });

  it('ROLE GATE: the server-authoritative 403 (default-deny use) hides the connect control behind the access-denied panel', async () => {
    await setup(Promise.reject(new TubeApiError(403, 'forbidden')) as Promise<never>);
    expect(el().querySelector('[data-testid="tube-my-access-denied"]')).not.toBeNull();
    // No Google panel and no connect/sync control is rendered for a denied user.
    expect(el().querySelector('[data-testid="tube-google"]')).toBeNull();
    expect(el().querySelector('[data-testid="tube-google-connect"]')).toBeNull();
    expect(el().querySelector('[data-testid="tube-google-sync"]')).toBeNull();
  });

  it('connect wiring: the click fetches the consent URL from the BFF and full-page-navigates to EXACTLY that URL', async () => {
    await setup({ jobs: [] }, { subscriptions: [] }, { connected: false });
    tube.googleAuthorizeUrl.and.resolveTo({
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=signed-state',
    });
    const leave = spyOn(fixture.componentInstance as any, 'leaveFor');

    el().querySelector<HTMLButtonElement>('[data-testid="tube-google-connect"]')!.click();
    await fixture.whenStable();

    expect(tube.googleAuthorizeUrl).toHaveBeenCalled();
    expect(leave).toHaveBeenCalledOnceWith(
      'https://accounts.google.com/o/oauth2/v2/auth?state=signed-state',
    );
    // The UI's half of the OAuth hop never touches the callback (Google's redirect target).
    expect(el().querySelector('[data-testid="tube-google-error"]')).toBeNull();
  });

  it('HONEST DISCLOSURE: a 200 authorize response WITHOUT a consent URL (stubbed BFF) is surfaced as an error — no navigation, no fake progress', async () => {
    await setup({ jobs: [] }, { subscriptions: [] }, { connected: false });
    tube.googleAuthorizeUrl.and.resolveTo({}); // the stubbed/unconfigured envelope
    const leave = spyOn(fixture.componentInstance as any, 'leaveFor');

    await fixture.componentInstance.connectGoogle();
    fixture.detectChanges();

    expect(leave).not.toHaveBeenCalled();
    const err = el().querySelector('[data-testid="tube-google-error"]')!;
    expect(err).not.toBeNull();
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.textContent).toContain('no Google consent URL');
    expect(err.textContent).toContain('Nothing was changed');
  });

  it('a failed authorize fetch is disclosed truthfully and never navigates', async () => {
    await setup({ jobs: [] }, { subscriptions: [] }, { connected: false });
    tube.googleAuthorizeUrl.and.returnValue(Promise.reject(new TubeApiError(500, 'boom')));
    const leave = spyOn(fixture.componentInstance as any, 'leaveFor');

    await fixture.componentInstance.connectGoogle();
    fixture.detectChanges();

    expect(leave).not.toHaveBeenCalled();
    const err = el().querySelector('[data-testid="tube-google-error"]')!;
    expect(err.textContent).toContain('Could not reach the connect service');
  });

  it('DEGRADED ENVELOPE: a failed status read discloses the real failure and DISABLES connect — the rest of My Tube still renders', async () => {
    await setup(
      { jobs: [] },
      { subscriptions: [] },
      Promise.reject(new TubeApiError(503, 'unavailable')) as Promise<never>,
    );
    const alert = el().querySelector('[data-testid="tube-google-degraded"]')!;
    expect(alert).not.toBeNull();
    expect(alert.getAttribute('role')).toBe('alert');
    // The REAL failure is disclosed (status code), not a generic/fake state.
    expect(alert.textContent).toContain('HTTP 503');
    expect(alert.textContent).toContain('Connect and sync are disabled');
    // The control is present but DISABLED with visible helptext (disabled+helptext idiom).
    const btn = el().querySelector<HTMLButtonElement>('[data-testid="tube-google-connect"]')!;
    expect(btn.disabled).toBeTrue();
    expect(btn.getAttribute('aria-describedby')).toBe('tube-google-help');
    expect(el().querySelector('[data-testid="tube-google-degraded-help"]')).not.toBeNull();
    // No sync control is offered in the degraded state.
    expect(el().querySelector('[data-testid="tube-google-sync"]')).toBeNull();
    // Belt-and-braces: even a direct connectGoogle() call refuses to start a blind flow.
    await fixture.componentInstance.connectGoogle();
    expect(tube.googleAuthorizeUrl).not.toHaveBeenCalled();
    // The rest of My Tube is unaffected by the degraded connect panel.
    expect(el().querySelector('[data-testid="tube-subs-empty"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="tube-queue-empty"]')).not.toBeNull();
  });

  it('sync wiring: POSTs the sync, re-reads the subscriptions list, and reports the REAL synced count', async () => {
    await setup(
      { jobs: [] },
      { subscriptions: [] },
      { connected: true, googleEmail: 'alice@gmail.com' },
    );
    // Connected → the sync control is offered and enabled.
    const btn = el().querySelector<HTMLButtonElement>('[data-testid="tube-google-sync"]')!;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBeFalse();
    expect(el().querySelector('[data-testid="tube-google-connected"]')!.textContent).toContain(
      'alice@gmail.com',
    );

    tube.syncSubscriptions.and.resolveTo({ synced: 3 });
    tube.getSubscriptions.and.resolveTo({
      subscriptions: [sub({ channelId: 'chan-new', channelTitle: 'Fresh' })],
    });
    await fixture.componentInstance.sync();
    fixture.detectChanges();

    expect(tube.syncSubscriptions).toHaveBeenCalled();
    // The channel list is re-read from the source of truth after the upsert.
    expect(tube.getSubscriptions).toHaveBeenCalledTimes(2);
    expect(el().querySelector('[data-testid="tube-sub-chan-new"]')).not.toBeNull();
    const notice = el().querySelector('[data-testid="tube-my-notice"]')!;
    expect(notice.textContent).toContain('Synced 3 subscriptions');
  });

  it('a failed sync is disclosed (channels NOT updated) and the connect status is re-read — a server-marked reauth_required is surfaced', async () => {
    await setup({ jobs: [] }, { subscriptions: [] }, { connected: true });
    tube.syncSubscriptions.and.returnValue(Promise.reject(new TubeApiError(502, 'reauth_required')));
    // After the failure the BFF has marked reauth_required — the re-read must show it.
    tube.googleConnectStatus.and.resolveTo({ connected: true, reauthRequired: true });

    await fixture.componentInstance.sync();
    fixture.detectChanges();

    const err = el().querySelector('[data-testid="tube-google-error"]')!;
    expect(err).not.toBeNull();
    expect(err.textContent).toContain('NOT updated');
    // The status was re-read (initial load + the post-failure re-read).
    expect(tube.googleConnectStatus).toHaveBeenCalledTimes(2);
    // The surfaced truth: reauth required → sync disabled + helptext + reconnect offered.
    expect(el().querySelector('[data-testid="tube-google-reauth"]')).not.toBeNull();
    expect(
      el().querySelector<HTMLButtonElement>('[data-testid="tube-google-sync"]')!.disabled,
    ).toBeTrue();
  });

  it('REAUTH GATE: reauthRequired disables sync with visible helptext and offers Reconnect — a doomed sync is never claimed to work', async () => {
    await setup({ jobs: [] }, { subscriptions: [] }, { connected: true, reauthRequired: true });
    expect(el().querySelector('[data-testid="tube-google-reauth"]')).not.toBeNull();
    const syncBtn = el().querySelector<HTMLButtonElement>('[data-testid="tube-google-sync"]')!;
    expect(syncBtn.disabled).withContext('sync disabled when reauth required').toBeTrue();
    expect(syncBtn.getAttribute('aria-describedby')).toBe('tube-google-sync-help');
    const help = el().querySelector('[data-testid="tube-google-sync-help"]')!;
    expect(help.textContent).toContain('Sync is disabled until you reconnect');
    const reconnect = el().querySelector<HTMLButtonElement>('[data-testid="tube-google-connect"]')!;
    expect(reconnect.textContent).toContain('Reconnect Google');
    // Belt-and-braces: a direct sync() call never POSTs when the credential is known-bad.
    await fixture.componentInstance.sync();
    expect(tube.syncSubscriptions).not.toHaveBeenCalled();
  });

  it('disconnect wiring: POSTs the disconnect and the panel adopts the returned (not-connected) status', async () => {
    await setup({ jobs: [] }, { subscriptions: [] }, { connected: true, googleEmail: 'a@g' });
    tube.googleDisconnect.and.resolveTo({ connected: false });

    el().querySelector<HTMLButtonElement>('[data-testid="tube-google-disconnect"]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(tube.googleDisconnect).toHaveBeenCalled();
    // Back to the not-connected offer; the connected line is gone.
    expect(el().querySelector('[data-testid="tube-google-connected"]')).toBeNull();
    const btn = el().querySelector<HTMLButtonElement>('[data-testid="tube-google-connect"]')!;
    expect(btn.textContent).toContain('Connect Google');
    expect(el().querySelector('[data-testid="tube-my-notice"]')!.textContent).toContain(
      'disconnected',
    );
  });

  it('a failed disconnect is disclosed truthfully — the panel still shows the (unchanged) connected state', async () => {
    await setup({ jobs: [] }, { subscriptions: [] }, { connected: true, googleEmail: 'a@g' });
    tube.googleDisconnect.and.returnValue(Promise.reject(new TubeApiError(500, 'boom')));

    await fixture.componentInstance.disconnectGoogle();
    fixture.detectChanges();

    const err = el().querySelector('[data-testid="tube-google-error"]')!;
    expect(err.textContent).toContain('NOT changed');
    // Nothing was faked: the panel still shows connected.
    expect(el().querySelector('[data-testid="tube-google-connected"]')).not.toBeNull();
  });

  // ── In-platform player: sign-on-demand against the job's OWN contentPath ──

  it('a done job renders a watch card with a "Load video" control, NOT an immediate <video>', async () => {
    await setup({ jobs: [job({ id: 'a', state: 'done', contentPath: '/d/s/a.mp4', title: 'My Clip' })] });
    const card = el().querySelector('[data-testid="tube-watch-a"]')!;
    expect(card).not.toBeNull();
    // No signed URL has been requested yet, so no <video> is in the DOM (no broken element).
    expect(card.querySelector('video')).toBeNull();
    const load = card.querySelector<HTMLButtonElement>('[data-testid="tube-watch-load-a"]')!;
    expect(load).not.toBeNull();
    expect(load.getAttribute('aria-label')).toContain('My Clip');
    expect(tube.signMedia).not.toHaveBeenCalled();
  });

  it('play() signs the DONE job\'s OWN contentPath and sets the <video> src to the returned signed url', async () => {
    const signed: SignedUrl = {
      url: '/tube/content/d/s/a.mp4?sig=abc&exp=1&sub=s&domain=d',
      expiresAt: '2026-06-13T23:10:00Z',
    };
    await setup({ jobs: [job({ id: 'a', state: 'done', contentPath: '/d/s/a.mp4', title: 'My Clip' })] });
    tube.signMedia.and.resolveTo(signed);

    const theJob = fixture.componentInstance.jobs()[0];
    await fixture.componentInstance.play(theJob);
    fixture.detectChanges();

    // The sign call used EXACTLY the job's own contentPath (owner safety).
    expect(tube.signMedia).toHaveBeenCalledOnceWith('/d/s/a.mp4');
    const video = el().querySelector<HTMLVideoElement>('[data-testid="tube-watch-video-a"]')!;
    expect(video).not.toBeNull();
    expect(video.getAttribute('src')).toBe(signed.url);
    // Accessible name on the video control.
    expect(video.getAttribute('aria-label')).toContain('My Clip');
  });

  it('OWNER SAFETY: play() only ever signs a contentPath that is on the component\'s OWN queue rows', async () => {
    await setup({
      jobs: [
        job({ id: 'a', state: 'done', contentPath: '/d/s/a.mp4' }),
        job({ id: 'b', state: 'done', contentPath: '/d/s/b.mp4' }),
      ],
    });
    tube.signMedia.and.resolveTo({ url: '/tube/content/x?sig=1', expiresAt: '' });

    // Drive play() through every watchable card the component built from its own queue.
    for (const j of fixture.componentInstance.watchable()) {
      await fixture.componentInstance.play(j);
    }
    // Every signed path is one of the component's own queue contentPaths — never anything else.
    const ownPaths = fixture.componentInstance.jobs().map((j) => j.contentPath);
    for (const call of tube.signMedia.calls.allArgs()) {
      expect(ownPaths).toContain(call[0]);
    }
    expect(tube.signMedia.calls.allArgs().map((a) => a[0]).sort()).toEqual(['/d/s/a.mp4', '/d/s/b.mp4']);
  });

  it('OWNER SAFETY: play() refuses a non-done job (no player, no sign) even if called directly', async () => {
    await setup({ jobs: [job({ id: 'a', state: 'downloading', contentPath: '/d/s/a.mp4' })] });
    // A non-done job is never watchable...
    expect(fixture.componentInstance.watchable().length).toBe(0);
    expect(el().querySelector('[data-testid="tube-watch-a"]')).toBeNull();
    // ...and even a direct play() call is refused (belt-and-braces owner/state gate).
    await fixture.componentInstance.play(fixture.componentInstance.jobs()[0]);
    expect(tube.signMedia).not.toHaveBeenCalled();
  });

  it('a sign 403 shows an error + Retry for that card, NEVER a broken <video>', async () => {
    await setup({ jobs: [job({ id: 'a', state: 'done', contentPath: '/d/s/a.mp4', title: 'My Clip' })] });
    tube.signMedia.and.returnValue(Promise.reject(new TubeApiError(403, 'forbidden')));

    await fixture.componentInstance.play(fixture.componentInstance.jobs()[0]);
    fixture.detectChanges();

    const card = el().querySelector('[data-testid="tube-watch-a"]')!;
    // No <video> element at all — the broken-element case is impossible.
    expect(card.querySelector('video')).toBeNull();
    const err = el().querySelector('[data-testid="tube-watch-error-a"]')!;
    expect(err).not.toBeNull();
    expect(err.getAttribute('role')).toBe('alert');
    expect(el().querySelector('[data-testid="tube-watch-retry-a"]')).not.toBeNull();
  });

  it('the storage usage bar is a labelled progressbar', async () => {
    await setup({ jobs: [job({ id: 'a', state: 'done', bytes: 2048, contentPath: '/d/s/a.mp4' })] });
    const bar = el().querySelector('[role="progressbar"]')!;
    expect(bar).not.toBeNull();
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-label')).toBe('Storage usage');
  });

  it('empty queue shows the empty states (queue + watch)', async () => {
    await setup({ jobs: [] });
    expect(el().querySelector('[data-testid="tube-queue-empty"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="tube-watch-empty"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="tube-subs-empty"]')).not.toBeNull();
  });
});
