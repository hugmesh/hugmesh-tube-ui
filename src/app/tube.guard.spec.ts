import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { tubeReadGuard, tubeManageGuard } from './tube.guard';
import { SessionService } from './session.service';

type Caps = Pick<SessionService, 'canUse' | 'canManage'>;

/**
 * Guard ALLOW + DENY for EACH role, and the critical forbidden-redirect TARGET.
 *
 * The DENY target MUST be the in-remote federated mount path
 * `router.parseUrl('/tube/forbidden')` — NOT '/forbidden', NOT '/login'. This is
 * the load-bearing correctness lesson the sibling wiki-ui learned the hard way
 * (it originally shipped '/forbidden' and that was a bug); we assert the exact
 * string here so a regression fails the build.
 */
describe('tube guards (per-view role gating)', () => {
  let session: jasmine.SpyObj<Caps>;
  let parseUrlSpy: jasmine.Spy;

  beforeEach(() => {
    session = jasmine.createSpyObj<Caps>('SessionService', ['canUse', 'canManage']);
    parseUrlSpy = jasmine.createSpy('parseUrl').and.callFake((u: string) => ({ url: u } as unknown as UrlTree));
    TestBed.configureTestingModule({
      providers: [
        { provide: SessionService, useValue: session },
        { provide: Router, useValue: { parseUrl: parseUrlSpy } },
      ],
    });
  });

  function run(guard: typeof tubeReadGuard) {
    return TestBed.runInInjectionContext(() => guard(null as never, null as never));
  }

  describe('tubeReadGuard (TUBE_USE = ROLE_TUBE) — the My Tube user console', () => {
    it('ALLOWS a ROLE_TUBE user (canUse)', () => {
      session.canUse.and.returnValue(true);
      expect(run(tubeReadGuard)).toBeTrue();
      expect(parseUrlSpy).not.toHaveBeenCalled();
    });
    it('DENIES a plain USER without ROLE_TUBE → /tube/forbidden', () => {
      session.canUse.and.returnValue(false);
      const r = run(tubeReadGuard) as UrlTree;
      expect((r as unknown as { url: string }).url).toBe('/tube/forbidden');
      expect(parseUrlSpy).toHaveBeenCalledWith('/tube/forbidden');
    });
  });

  describe('tubeManageGuard (TUBE_MANAGE = ADMIN|SUPERADMIN) — Tube Access + Storage Budgets', () => {
    it('ALLOWS an ADMIN/SUPERADMIN (canManage)', () => {
      session.canManage.and.returnValue(true);
      expect(run(tubeManageGuard)).toBeTrue();
      expect(parseUrlSpy).not.toHaveBeenCalled();
    });
    it('DENIES a plain USER → /tube/forbidden', () => {
      session.canManage.and.returnValue(false);
      const r = run(tubeManageGuard) as UrlTree;
      expect((r as unknown as { url: string }).url).toBe('/tube/forbidden');
      expect(parseUrlSpy).toHaveBeenCalledWith('/tube/forbidden');
    });
    it('DENIES a ROLE_TUBE-only user (use but NOT manage) → /tube/forbidden', () => {
      session.canManage.and.returnValue(false); // a granted USER can use, cannot manage
      const r = run(tubeManageGuard) as UrlTree;
      expect((r as unknown as { url: string }).url).toBe('/tube/forbidden');
    });
  });

  it('the DENY target is the federated mount path (NOT /forbidden, NOT /login)', () => {
    session.canUse.and.returnValue(false);
    session.canManage.and.returnValue(false);
    (run(tubeReadGuard) as UrlTree);
    (run(tubeManageGuard) as UrlTree);
    for (const call of parseUrlSpy.calls.allArgs()) {
      expect(call[0]).toBe('/tube/forbidden');
      expect(call[0]).not.toBe('/forbidden');
      expect(call[0]).not.toBe('/login');
    }
  });
});
