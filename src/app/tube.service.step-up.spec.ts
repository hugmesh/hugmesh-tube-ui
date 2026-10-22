import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { TubeService, TubeApiError, TUBE_BASE_URL } from './tube.service';
import { StepUpService } from './mfa/step-up.service';
import { SessionService } from './session.service';
import { authInterceptor } from './auth.interceptor';

const SIGNAL = { 'X-Step-Up-Required': 'X-Mfa-StepUp', 'X-Route-Denied': 'hugmesh-fe-gateway:/x' };
const FORBIDDEN = { status: 403, statusText: 'Forbidden' };

/** The gateway's step-up refusal (empty body + the signal) and its plain role denial. */
const stepUpRefusal = { ...FORBIDDEN, headers: SIGNAL };

/** Let the service's promise chain run (response -> catch -> challenge -> retry). */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r));
const roleDenial = { ...FORBIDDEN, headers: { 'X-Route-Denied': 'hugmesh-fe-gateway:/x' } };

/**
 * The step-up seam in TubeService: the gateway refuses the privileged WRITE calls
 * (grant / timeout / ban / revoke / storage budget) with 403 + X-Step-Up-Required when
 * the admin has no fresh second factor. The service must show the challenge and retry the
 * SAME call exactly once when it is satisfied, and in no other case.
 */
describe('TubeService step-up (gateway X-Step-Up-Required on the admin write calls)', () => {
  let service: TubeService;
  let http: HttpTestingController;
  let stepUp: StepUpService;

  beforeEach(() => {
    localStorage.setItem('hug.session', JSON.stringify({ roles: ['admin'] }));
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
    http = TestBed.inject(HttpTestingController);
    stepUp = TestBed.inject(StepUpService);
  });
  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  /** Every gated call: how to invoke it, where it goes, and a body the reply can carry. */
  const gated: ReadonlyArray<{ name: string; method: string; url: string; call: () => Promise<unknown>; ok: object }> = [
    { name: 'grant', method: 'POST', url: '/bff/tube/admin/access/grant', call: () => service.grant({ userSubject: 'u' }), ok: { id: 'a1' } },
    { name: 'timeout', method: 'POST', url: '/bff/tube/admin/access/timeout', call: () => service.timeout({ userSubject: 'u', ttlSeconds: 60 }), ok: { id: 'a2' } },
    { name: 'ban', method: 'POST', url: '/bff/tube/admin/access/ban', call: () => service.ban({ userSubject: 'u' }), ok: { id: 'a3' } },
    { name: 'revoke (lift a ban)', method: 'DELETE', url: '/bff/tube/admin/access/banned/u', call: () => service.revoke('banned', 'u'), ok: { state: 'revoked' } },
    { name: 'revoke (remove a grant)', method: 'DELETE', url: '/bff/tube/admin/access/use/u', call: () => service.revoke('use', 'u'), ok: { state: 'revoked' } },
    { name: 'storage budget', method: 'POST', url: '/bff/tube/admin/storage-budget', call: () => service.setBudget({ userSubject: 'u', budgetBytes: 1 }), ok: { userSubject: 'u' } },
  ];

  for (const g of gated) {
    describe(g.name, () => {
      it('on the signal, shows the challenge and retries the SAME call once it is satisfied', async () => {
        const p = g.call();
        const first = http.expectOne(g.url);
        expect(first.request.method).toBe(g.method);
        first.flush(null, stepUpRefusal);
        await settle();
        expect(stepUp.request()).withContext('the dialog is requested').not.toBeNull();
        http.expectNone(g.url); // not retried before the user confirms

        stepUp.resolve(true);
        await settle();
        const retry = http.expectOne(g.url);
        expect(retry.request.method).toBe(g.method);
        retry.flush(g.ok);
        expect(await p).toEqual(g.ok as never);
      });

      it('a dismissed challenge is NOT retried and surfaces the step-up error', async () => {
        const p = g.call();
        http.expectOne(g.url).flush(null, stepUpRefusal);
        await settle();
        stepUp.resolve(false);
        const err = await p.then(() => null, (e) => e);
        expect(err).toBeInstanceOf(TubeApiError);
        expect((err as TubeApiError).status).toBe(403);
        expect((err as TubeApiError).stepUp).toBeTrue();
        http.expectNone(g.url);
      });

      it('retries ONCE: a second step-up refusal after a satisfied challenge surfaces, with no further dialog or request', async () => {
        const p = g.call();
        http.expectOne(g.url).flush(null, stepUpRefusal);
        await settle();
        stepUp.resolve(true);
        await settle();
        http.expectOne(g.url).flush(null, stepUpRefusal);
        const err = await p.then(() => null, (e) => e);
        expect((err as TubeApiError).stepUp).toBeTrue();
        expect(stepUp.request()).withContext('no second dialog').toBeNull();
        http.expectNone(g.url);
      });

      it('a plain role denial (no signal) is never offered a challenge', async () => {
        const p = g.call();
        http.expectOne(g.url).flush(null, roleDenial);
        const err = await p.then(() => null, (e) => e);
        expect((err as TubeApiError).isForbidden).toBeTrue();
        expect((err as TubeApiError).stepUp).toBeFalse();
        expect(stepUp.request()).toBeNull();
        http.expectNone(g.url);
      });
    });
  }

  it('a non-403 failure on a gated call is not a step-up', async () => {
    const p = service.ban({ userSubject: 'u' });
    http.expectOne('/bff/tube/admin/access/ban').flush({ error: 'boom' }, { status: 500, statusText: 'x', headers: SIGNAL });
    const err = await p.then(() => null, (e) => e);
    expect((err as TubeApiError).stepUp).toBeFalse();
    expect(stepUp.request()).toBeNull();
  });

  it('the READ calls are not gated: a signal on a read surfaces as an error without a dialog or retry', async () => {
    const p = service.listQueue();
    http.expectOne('/bff/tube/downloads').flush(null, stepUpRefusal);
    const err = await p.then(() => null, (e) => e);
    expect(err).toBeInstanceOf(TubeApiError);
    expect(stepUp.request()).toBeNull();
    http.expectNone('/bff/tube/downloads');
  });

  it('a successful call never touches the dialog', async () => {
    const p = service.ban({ userSubject: 'u' });
    http.expectOne('/bff/tube/admin/access/ban').flush({ id: 'ok' });
    await p;
    expect(stepUp.request()).toBeNull();
  });
});
