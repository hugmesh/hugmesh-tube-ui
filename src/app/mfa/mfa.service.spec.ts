import { TestBed } from '@angular/core/testing';
import { MfaService } from './mfa.service';

describe('MfaService (the two /bff/mfa calls the step-up dialog makes)', () => {
  let svc: MfaService;
  let fetchSpy: jasmine.Spy;

  function reply(status: number, body?: unknown): void {
    fetchSpy.and.resolveTo(new Response(body === undefined ? null : JSON.stringify(body), { status }));
  }

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(MfaService);
    fetchSpy = spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    globalThis.__HUG_BFF_URL__ = undefined;
  });

  it('challenge → POST /bff/mfa/challenge with the factor, the credential and the session cookie', async () => {
    reply(200, { mfaSatisfied: true });
    const r = await svc.challenge('totp', '123456');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
    expect(url).toBe('/bff/mfa/challenge');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body as string)).toEqual({ factor: 'totp', credential: '123456' });
    expect(r).toEqual({ ok: true, dark: false, status: 200, data: { mfaSatisfied: true } });
  });

  it('assertWebauthnOptions → POST /bff/mfa/assert/webauthn/options', async () => {
    reply(200, { challenge: 'abc', rpId: 'x', rpName: 'y' });
    const r = await svc.assertWebauthnOptions();
    expect((fetchSpy.calls.mostRecent().args as [string])[0]).toBe('/bff/mfa/assert/webauthn/options');
    expect(r.data?.challenge).toBe('abc');
  });

  it('503 is DARK (MFA not launched), not an error', async () => {
    reply(503);
    expect(await svc.challenge('totp', '123456')).toEqual({ ok: false, dark: true, status: 503 });
  });

  it('a 401 carries the server error text and is not dark', async () => {
    reply(401, { error: 'bad code' });
    expect(await svc.challenge('totp', '000000')).toEqual({ ok: false, dark: false, status: 401, error: 'bad code' });
  });

  it('a network failure is a structured non-dark error, never a throw', async () => {
    fetchSpy.and.rejectWith(new TypeError('offline'));
    expect(await svc.challenge('totp', '123456')).toEqual({ ok: false, dark: false, status: 0, error: 'Network error' });
  });

  it('honours the host override __HUG_BFF_URL__', async () => {
    globalThis.__HUG_BFF_URL__ = 'https://bff.example';
    reply(200, { mfaSatisfied: true });
    await svc.challenge('recovery', 'AAAA-BBBB');
    expect((fetchSpy.calls.mostRecent().args as [string])[0]).toBe('https://bff.example/bff/mfa/challenge');
  });
});
