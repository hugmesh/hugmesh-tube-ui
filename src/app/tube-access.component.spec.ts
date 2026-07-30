import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { TubeAccessComponent } from './tube-access.component';
import { TubeService, TubeAccess, TubeApiError } from './tube.service';
import { SessionService } from './session.service';

function access(partial: Partial<TubeAccess>): TubeAccess {
  return {
    id: 'id', domain: 'd', userSubject: 'u', accessType: 'use', state: 'active',
    grantedBySubject: 'admin', reason: null, createdAt: '', expiresAt: null, revokedAt: null,
    ...partial,
  };
}

describe('TubeAccessComponent (Tube Access overlay console)', () => {
  let fixture: ComponentFixture<TubeAccessComponent>;
  let tube: jasmine.SpyObj<TubeService>;
  const canManageAll = signal(false);

  async function setup(): Promise<void> {
    tube = jasmine.createSpyObj<TubeService>('TubeService', [
      'grant', 'timeout', 'ban', 'revoke', 'listActiveAccess', 'accessHistory',
    ]);
    tube.listActiveAccess.and.resolveTo({ access: [] });
    await TestBed.configureTestingModule({
      imports: [TubeAccessComponent],
      providers: [
        { provide: TubeService, useValue: tube },
        { provide: SessionService, useValue: { canManageAll } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(TubeAccessComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => canManageAll.set(false));

  it('does not submit with an empty user subject (client validation)', async () => {
    await setup();
    await fixture.componentInstance.submit();
    expect(tube.grant).not.toHaveBeenCalled();
    fixture.detectChanges();
    expect(el().querySelector('#tube-access-user-err')).not.toBeNull();
  });

  it('GRANT → POSTs the grant; result is shown with type "use"', async () => {
    await setup();
    tube.grant.and.resolveTo(access({ accessType: 'use', state: 'active' }));
    fixture.componentInstance.userSubject.set('google:bob@x.com');
    fixture.componentInstance.setAction('grant');
    await fixture.componentInstance.submit();
    fixture.detectChanges();
    expect(tube.grant).toHaveBeenCalledWith({ userSubject: 'google:bob@x.com', reason: undefined });
    expect(el().querySelector('[data-testid="tube-access-result"]')).not.toBeNull();
  });

  it('TIMEOUT → converts hours to ttlSeconds', async () => {
    await setup();
    tube.timeout.and.resolveTo(access({ accessType: 'banned', expiresAt: '2030-01-01' }));
    fixture.componentInstance.userSubject.set('u');
    fixture.componentInstance.setAction('timeout');
    fixture.componentInstance.timeoutHours.set(2);
    await fixture.componentInstance.submit();
    expect(tube.timeout).toHaveBeenCalledWith({ userSubject: 'u', ttlSeconds: 7200, reason: undefined });
  });

  it('BAN → shows the ban-precedence note + POSTs the ban', async () => {
    await setup();
    fixture.componentInstance.setAction('ban');
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="tube-access-ban-note"]')).not.toBeNull();
    tube.ban.and.resolveTo(access({ accessType: 'banned' }));
    fixture.componentInstance.userSubject.set('u');
    await fixture.componentInstance.submit();
    expect(tube.ban).toHaveBeenCalled();
  });

  it('restore → DELETE banned; removeGrant → DELETE use', async () => {
    await setup();
    tube.revoke.and.resolveTo({ state: 'revoked' });
    await fixture.componentInstance.restore('u');
    expect(tube.revoke).toHaveBeenCalledWith('banned', 'u');
    await fixture.componentInstance.removeGrant('u');
    expect(tube.revoke).toHaveBeenCalledWith('use', 'u');
  });

  it('a 403 from the server is surfaced as an explanatory role-denied error', async () => {
    await setup();
    tube.grant.and.rejectWith(new TubeApiError(403, 'forbidden'));
    fixture.componentInstance.userSubject.set('u');
    await fixture.componentInstance.submit();
    fixture.detectChanges();
    const err = el().querySelector('[data-testid="tube-access-error"]')!;
    expect(err.textContent).toContain('does not permit managing Tube access');
  });

  it('an ADMIN (not superadmin) does NOT see the manage-all list/history panel', async () => {
    canManageAll.set(false);
    await setup();
    expect(el().querySelector('[data-testid="tube-access-manage"]')).toBeNull();
    expect(tube.listActiveAccess).not.toHaveBeenCalled();
  });

  it('a SUPERADMIN sees the manage-all panel + loads active overrides on init', async () => {
    canManageAll.set(true);
    tube = jasmine.createSpyObj<TubeService>('TubeService', [
      'grant', 'timeout', 'ban', 'revoke', 'listActiveAccess', 'accessHistory',
    ]);
    tube.listActiveAccess.and.resolveTo({ access: [access({ userSubject: 'x' })] });
    await TestBed.configureTestingModule({
      imports: [TubeAccessComponent],
      providers: [
        { provide: TubeService, useValue: tube },
        { provide: SessionService, useValue: { canManageAll } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(TubeAccessComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(tube.listActiveAccess).toHaveBeenCalled();
    expect(el().querySelector('[data-testid="tube-access-manage"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="tube-access-row-x"]')).not.toBeNull();
  });
});
