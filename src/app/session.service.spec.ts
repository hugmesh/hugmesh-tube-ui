import { TestBed } from '@angular/core/testing';
import { SessionService, HugSession } from './session.service';

/** Exercise the Casdoor-role → capability derivation for EACH role tier, since
 *  the guards + the console nav gate on these signals (defence-in-depth mirror of
 *  the tube-bff SecurityConfig). */
describe('SessionService (tube role composites)', () => {
  let service: SessionService;

  function login(roles: string[]): void {
    const s: HugSession = {
      id: 'google:alice@gmail.com',
      label: 'alice',
      provider: 'google',
      roles,
      registrationComplete: true,
    };
    localStorage.setItem('hug.session', JSON.stringify(s));
    service.set(s);
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [SessionService] });
    service = TestBed.inject(SessionService);
  });
  afterEach(() => localStorage.clear());

  it('logged-out: no capabilities', () => {
    expect(service.loggedIn()).toBeFalse();
    expect(service.canUse()).toBeFalse();
    expect(service.canManage()).toBeFalse();
    expect(service.canManageAll()).toBeFalse();
  });

  it('a plain USER (no tube role): cannot use, cannot manage', () => {
    login(['user']);
    expect(service.canUse()).toBeFalse();
    expect(service.canManage()).toBeFalse();
    expect(service.canManageAll()).toBeFalse();
  });

  it('a granted ROLE_TUBE user: CAN use, cannot manage', () => {
    login(['user', 'tube']);
    expect(service.hasTubeRole()).toBeTrue();
    expect(service.canUse()).toBeTrue();
    expect(service.canManage()).toBeFalse();
    expect(service.canManageAll()).toBeFalse();
  });

  it('an ADMIN: can use (self-serve) + can manage, NOT manage-all', () => {
    login(['user', 'admin']);
    expect(service.isAdmin()).toBeTrue();
    expect(service.canUse()).toBeTrue();
    expect(service.canManage()).toBeTrue();
    expect(service.canManageAll()).toBeFalse();
  });

  it('a SUPERADMIN: can use + manage + manage-all', () => {
    login(['user', 'superadmin']);
    expect(service.isSuperadmin()).toBeTrue();
    expect(service.canUse()).toBeTrue();
    expect(service.canManage()).toBeTrue();
    expect(service.canManageAll()).toBeTrue();
  });

  it('persists + clears the session over localStorage', () => {
    login(['tube']);
    expect(service.loggedIn()).toBeTrue();
    service.clear();
    expect(service.loggedIn()).toBeFalse();
    expect(localStorage.getItem('hug.session')).toBeNull();
  });

  it('never persists a homeserver access token (Matrix/Mastodon go via the bff hsproxy)', () => {
    login(['tube']);
    const raw = localStorage.getItem('hug.session') ?? '';
    // The browser must hold ONLY non-secret metadata; the server-held homeserver
    // token is injected by the user-bff hsproxy (/bff/user/matrix|mastodon/**).
    expect(raw).not.toContain('matrix');
    expect(raw).not.toContain('mastodon');
    expect(raw).not.toContain('token');
  });
});
