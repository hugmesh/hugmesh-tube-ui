import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TubeBudgetsComponent } from './tube-budgets.component';
import { TubeService, Usage, TubeApiError } from './tube.service';

describe('TubeBudgetsComponent (Storage Budgets console)', () => {
  let fixture: ComponentFixture<TubeBudgetsComponent>;
  let tube: jasmine.SpyObj<TubeService>;

  async function setup(): Promise<void> {
    tube = jasmine.createSpyObj<TubeService>('TubeService', ['setBudget']);
    await TestBed.configureTestingModule({
      imports: [TubeBudgetsComponent],
      providers: [{ provide: TubeService, useValue: tube }],
    }).compileComponents();
    fixture = TestBed.createComponent(TubeBudgetsComponent);
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('does not submit with an empty user subject', async () => {
    await setup();
    await fixture.componentInstance.submit();
    expect(tube.setBudget).not.toHaveBeenCalled();
    fixture.detectChanges();
    expect(el().querySelector('#tube-budget-user-err')).not.toBeNull();
  });

  it('converts GB → bytes and POSTs the budget', async () => {
    await setup();
    const row: Usage = { domain: 'd', userSubject: 'u', usedBytes: 0, budgetBytes: 10 * 1024 ** 3, updatedAt: '' };
    tube.setBudget.and.resolveTo(row);
    fixture.componentInstance.userSubject.set('google:bob@x.com');
    fixture.componentInstance.budgetGb.set(10);
    await fixture.componentInstance.submit();
    expect(tube.setBudget).toHaveBeenCalledWith({
      userSubject: 'google:bob@x.com',
      budgetBytes: 10 * 1024 ** 3,
    });
  });

  it('appends the applied budget to the current budgets/usage list', async () => {
    await setup();
    tube.setBudget.and.resolveTo({ domain: 'd', userSubject: 'u', usedBytes: 5, budgetBytes: 100, updatedAt: '' });
    fixture.componentInstance.userSubject.set('u');
    await fixture.componentInstance.submit();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="tube-budget-row-u"]')).not.toBeNull();
  });

  it('a re-set for the same user replaces the prior row (de-dup)', async () => {
    await setup();
    tube.setBudget.and.resolveTo({ domain: 'd', userSubject: 'u', usedBytes: 0, budgetBytes: 1, updatedAt: '' });
    fixture.componentInstance.userSubject.set('u');
    await fixture.componentInstance.submit();
    await fixture.componentInstance.submit();
    expect(fixture.componentInstance.applied().length).toBe(1);
  });

  it('usagePercent clamps to 100 and computes the ratio', async () => {
    await setup();
    expect(fixture.componentInstance.usagePercent({ usedBytes: 50, budgetBytes: 100 } as Usage)).toBe(50);
    expect(fixture.componentInstance.usagePercent({ usedBytes: 200, budgetBytes: 100 } as Usage)).toBe(100);
    expect(fixture.componentInstance.usagePercent({ usedBytes: 5, budgetBytes: 0 } as Usage)).toBe(100);
  });

  it('a 403 is surfaced as an explanatory role-denied error', async () => {
    await setup();
    tube.setBudget.and.rejectWith(new TubeApiError(403, 'forbidden'));
    fixture.componentInstance.userSubject.set('u');
    await fixture.componentInstance.submit();
    fixture.detectChanges();
    const err = el().querySelector('[data-testid="tube-budget-error"]')!;
    expect(err.textContent).toContain('does not permit setting storage budgets');
  });

  it('formatBytes renders human-readable sizes', async () => {
    await setup();
    expect(fixture.componentInstance.formatBytes(0)).toBe('0 B');
    expect(fixture.componentInstance.formatBytes(1024)).toBe('1.0 KB');
    expect(fixture.componentInstance.formatBytes(1024 ** 3)).toBe('1.0 GB');
  });
});

describe('TubeBudgetsComponent step-up message', () => {
  it('a step-up refusal that stayed unconfirmed says so, NOT that the role is not permitted', async () => {
    const tube = jasmine.createSpyObj<TubeService>('TubeService', ['setBudget']);
    await TestBed.configureTestingModule({
      imports: [TubeBudgetsComponent],
      providers: [{ provide: TubeService, useValue: tube }],
    }).compileComponents();
    const fixture = TestBed.createComponent(TubeBudgetsComponent);
    fixture.detectChanges();
    tube.setBudget.and.rejectWith(new TubeApiError(403, '', true));
    fixture.componentInstance.userSubject.set('google:bob@x.com');
    await fixture.componentInstance.submit();
    const msg = fixture.componentInstance.error();
    expect(msg).toContain('fresh security check');
    expect(msg).not.toContain('role does not permit');
  });
});
