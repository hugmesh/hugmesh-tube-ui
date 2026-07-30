import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import {
  TubeService,
  TubeApiError,
  TUBE_BASE_URL,
  JobList,
  TubeAccess,
  Usage,
  SubscriptionList,
  SignedUrl,
  ConnectStatus,
} from './tube.service';
import { authInterceptor } from './auth.interceptor';
import { SessionService } from './session.service';

/** Drive the service against Angular's HttpTestingController so the EXACT
 *  path/method/body/credentials for each bff endpoint is asserted (the load-bearing
 *  endpoint-consumption contract against hugmesh-tube-bff-api). Post the
 *  ng-openapi-gen migration TubeService DELEGATES to the generated typed clients
 *  (rootUrl '' = same origin) and the shared authInterceptor sends the HttpOnly
 *  `bff_` cookie (withCredentials) — the gateway mints the Bearer server-side — so
 *  the wire calls (URL/method/body) are unchanged from the previous hand-rolled
 *  `fetch` implementation and now carry credentials instead of an Authorization
 *  header. */
describe('TubeService (BFF endpoint contract)', () => {
  let service: TubeService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.setItem(
      'hug.session',
      JSON.stringify({ roles: ['tube'] }),
    );
    TestBed.configureTestingModule({
      providers: [
        TubeService,
        SessionService,
        { provide: TUBE_BASE_URL, useValue: '' },
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(TubeService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  /** Expect exactly one request to `url` with `method`, assert it carries the
   *  HttpOnly `bff_` cookie (withCredentials, set by the authInterceptor) and NO
   *  browser-held Bearer, and return it for body/flush. */
  function expectOne(method: string, url: string): TestRequest {
    const req = httpMock.expectOne(url);
    expect(req.request.method).toBe(method);
    expect(req.request.withCredentials).toBeTrue();
    expect(req.request.headers.has('Authorization')).toBeFalse();
    return req;
  }

  // ── USER queue ──────────────────────────────────────────────────────────

  it('listQueue → GET /bff/tube/downloads with credentials (bff_ cookie)', async () => {
    const list: JobList = {
      jobs: [
        {
          id: '1', domain: 'd', userSubject: 's', channelId: 'c', videoId: 'v',
          title: 'V', state: 'queued', claimedBy: null, claimedAt: null, attempts: 0,
          lastError: null, bytes: null, contentPath: null, createdAt: '', updatedAt: '',
        },
      ],
    };
    const p = service.listQueue();
    expectOne('GET', '/bff/tube/downloads').flush(list);
    const res = await p;
    expect(res.jobs.length).toBe(1);
  });

  it('enqueueFromSubscriptions → POST /bff/tube/downloads', async () => {
    const p = service.enqueueFromSubscriptions();
    expectOne('POST', '/bff/tube/downloads').flush({ jobs: [] });
    await p;
  });

  // ── USER subscriptions (real GET /bff/tube/subscriptions) ─────────────────

  it('getSubscriptions → GET /bff/tube/subscriptions (the owner-scoped list) and maps the DTO', async () => {
    const list: SubscriptionList = {
      subscriptions: [
        { channelId: 'chan-1', channelTitle: 'Cooking', thumbnailUrl: 'http://t/1.jpg', syncedAt: '2026-01-01T00:00:00Z' },
      ],
    };
    const p = service.getSubscriptions();
    // EXACT endpoint the BFF TubeSubscriptionsController.list serves.
    expectOne('GET', '/bff/tube/subscriptions').flush(list);
    const res = await p;
    expect(res.subscriptions.length).toBe(1);
    expect(res.subscriptions[0].channelId).toBe('chan-1');
    expect(res.subscriptions[0].channelTitle).toBe('Cooking');
  });

  // ── USER Google connect + subscription sync ───────────────────────────────

  it('googleConnectStatus → GET /bff/tube/google-connect/status (display-safe; no token in the envelope)', async () => {
    const status: ConnectStatus = {
      connected: true,
      connectedAt: '2026-07-01T00:00:00Z',
      googleEmail: 'alice@gmail.com',
      reauthRequired: false,
      scopes: 'https://www.googleapis.com/auth/youtube.readonly',
    };
    const p = service.googleConnectStatus();
    expectOne('GET', '/bff/tube/google-connect/status').flush(status);
    const res = await p;
    expect(res.connected).toBeTrue();
    expect(res.googleEmail).toBe('alice@gmail.com');
  });

  it('googleAuthorizeUrl → GET /bff/tube/google-connect/authorize and returns the consent URL', async () => {
    const p = service.googleAuthorizeUrl();
    expectOne('GET', '/bff/tube/google-connect/authorize').flush({
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=signed',
    });
    const res = await p;
    expect(res.authorizeUrl).toBe('https://accounts.google.com/o/oauth2/v2/auth?state=signed');
  });

  it('googleDisconnect → POST /bff/tube/google-connect/disconnect and returns the post-disconnect status', async () => {
    const p = service.googleDisconnect();
    expectOne('POST', '/bff/tube/google-connect/disconnect').flush({ connected: false });
    const res = await p;
    expect(res.connected).toBeFalse();
  });

  it('syncSubscriptions → POST /bff/tube/subscriptions/sync and returns the synced count', async () => {
    const p = service.syncSubscriptions();
    expectOne('POST', '/bff/tube/subscriptions/sync').flush({ synced: 7 });
    const res = await p;
    expect(res.synced).toBe(7);
  });

  it('syncSubscriptions surfaces the BFF reauth-stop (a 5xx after a failed Google refresh) as a rejection, never a fake success', async () => {
    const p = service.syncSubscriptions();
    httpMock
      .expectOne('/bff/tube/subscriptions/sync')
      .flush({ error: 'reauth_required' }, { status: 502, statusText: 'Bad Gateway' });
    try {
      await p;
      fail('expected rejection');
    } catch (e) {
      expect(e instanceof TubeApiError).toBeTrue();
      expect((e as TubeApiError).status).toBe(502);
      expect((e as TubeApiError).isForbidden).toBeFalse();
    }
  });

  it('googleConnectStatus surfaces a 403 (default-deny use) as TubeApiError.isForbidden', async () => {
    const p = service.googleConnectStatus();
    httpMock
      .expectOne('/bff/tube/google-connect/status')
      .flush({ error: 'forbidden' }, { status: 403, statusText: 'Forbidden' });
    try {
      await p;
      fail('expected rejection');
    } catch (e) {
      expect(e instanceof TubeApiError).toBeTrue();
      expect((e as TubeApiError).isForbidden).toBeTrue();
    }
  });

  // ── USER media signing (real GET /bff/tube/media/sign) ────────────────────

  it('signMedia → GET /bff/tube/media/sign?path=<contentPath> and returns the signed url', async () => {
    const signed: SignedUrl = {
      url: '/tube/content/default/alice/videos/vid.mp4?sig=abc&exp=123&sub=alice&domain=default',
      expiresAt: '2026-06-13T23:10:00Z',
    };
    const p = service.signMedia('/default/alice/videos/vid.mp4');
    // EXACT endpoint + query param name the BFF TubeMediaController.sign expects.
    const req = httpMock.expectOne(
      '/bff/tube/media/sign?path=%2Fdefault%2Falice%2Fvideos%2Fvid.mp4',
    );
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('path')).toBe('/default/alice/videos/vid.mp4');
    expect(req.request.withCredentials).toBeTrue();
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush(signed);
    const res = await p;
    expect(res.url).toBe(signed.url);
  });

  it('signMedia surfaces a 403 (expired/cross-user) as TubeApiError.isForbidden — the player renders an error, never a broken <video>', async () => {
    const p = service.signMedia('/default/alice/videos/vid.mp4');
    httpMock
      .expectOne('/bff/tube/media/sign?path=%2Fdefault%2Falice%2Fvideos%2Fvid.mp4')
      .flush({ error: 'path subject does not match the caller' }, { status: 403, statusText: 'Forbidden' });
    try {
      await p;
      fail('expected rejection');
    } catch (e) {
      expect(e instanceof TubeApiError).toBeTrue();
      expect((e as TubeApiError).isForbidden).toBeTrue();
    }
  });

  // ── ADMIN budget ──────────────────────────────────────────────────────────

  it('setBudget → POST /bff/tube/admin/storage-budget with the body', async () => {
    const usage: Usage = { domain: 'd', userSubject: 'u', usedBytes: 0, budgetBytes: 1024, updatedAt: '' };
    const p = service.setBudget({ userSubject: 'u', budgetBytes: 1024 });
    const req = expectOne('POST', '/bff/tube/admin/storage-budget');
    expect(req.request.body).toEqual({ userSubject: 'u', budgetBytes: 1024 });
    req.flush(usage);
    await p;
  });

  // ── ADMIN use-access overlay ──────────────────────────────────────────────

  it('grant/timeout/ban → POST the right /bff/tube/admin/access/* endpoints', async () => {
    const row = { accessType: 'use', state: 'active' } as TubeAccess;
    const g = service.grant({ userSubject: 'u' });
    expectOne('POST', '/bff/tube/admin/access/grant').flush(row);
    await g;
    const t = service.timeout({ userSubject: 'u', ttlSeconds: 3600 });
    expectOne('POST', '/bff/tube/admin/access/timeout').flush(row);
    await t;
    const b = service.ban({ userSubject: 'u' });
    expectOne('POST', '/bff/tube/admin/access/ban').flush(row);
    await b;
  });

  it('revoke → DELETE /bff/tube/admin/access/{type}/{user} (use|banned)', async () => {
    const r1 = service.revoke('banned', 'google:bob@x.com');
    expectOne('DELETE', '/bff/tube/admin/access/banned/google%3Abob%40x.com').flush({ state: 'revoked' });
    await r1;
    const r2 = service.revoke('use', 'u');
    expectOne('DELETE', '/bff/tube/admin/access/use/u').flush({ state: 'revoked' });
    await r2;
  });

  // ── SUPERADMIN manage-all ─────────────────────────────────────────────────

  it('listActiveAccess + accessHistory → the superadmin endpoints', async () => {
    const l = service.listActiveAccess();
    expectOne('GET', '/bff/tube/superadmin/access').flush({ access: [] });
    await l;
    const h = service.accessHistory('u');
    expectOne('GET', '/bff/tube/superadmin/access/u/history').flush({ access: [] });
    await h;
  });

  // ── error paths ───────────────────────────────────────────────────────────

  it('surfaces a 403 as TubeApiError.isForbidden (the bff @PreAuthorize / TubeAccessGuard denial)', async () => {
    const p = service.listQueue();
    httpMock
      .expectOne('/bff/tube/downloads')
      .flush({ error: 'forbidden' }, { status: 403, statusText: 'Forbidden' });
    try {
      await p;
      fail('expected rejection');
    } catch (e) {
      expect(e instanceof TubeApiError).toBeTrue();
      expect((e as TubeApiError).isForbidden).toBeTrue();
      expect((e as TubeApiError).isNotFound).toBeFalse();
    }
  });

  it('surfaces a 404 as TubeApiError.isNotFound', async () => {
    const p = service.accessHistory('ghost');
    httpMock
      .expectOne('/bff/tube/superadmin/access/ghost/history')
      .flush({ error: 'not found' }, { status: 404, statusText: 'Not Found' });
    try {
      await p;
      fail('expected rejection');
    } catch (e) {
      expect(e instanceof TubeApiError).toBeTrue();
      expect((e as TubeApiError).isNotFound).toBeTrue();
      expect((e as TubeApiError).isForbidden).toBeFalse();
    }
  });

  it('NEVER calls the internal worker seam (/bff/tube/internal/**)', async () => {
    const a = service.listQueue();
    const reqA = httpMock.expectOne('/bff/tube/downloads');
    expect(reqA.request.url).not.toContain('/internal/');
    reqA.flush({ jobs: [] });
    await a;
    const b = service.enqueueFromSubscriptions();
    const reqB = httpMock.expectOne('/bff/tube/downloads');
    expect(reqB.request.url).not.toContain('/internal/');
    reqB.flush({ jobs: [] });
    await b;
  });
});
