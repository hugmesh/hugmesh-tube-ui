import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';

import { TubeConsoleComponent } from './tube-console.component';
import { SessionService } from './session.service';
import { StepUpService } from './mfa/step-up.service';

/** A stub SessionService with settable capability signals so each role scenario
 *  is exercised by flipping canUse/canManage. */
function sessionStub() {
  return {
    canUse: signal(false),
    canManage: signal(false),
  };
}

describe('TubeConsoleComponent (role-gated nav)', () => {
  let fixture: ComponentFixture<TubeConsoleComponent>;
  let session: ReturnType<typeof sessionStub>;

  beforeEach(async () => {
    session = sessionStub();
    await TestBed.configureTestingModule({
      imports: [TubeConsoleComponent],
      providers: [provideRouter([]), { provide: SessionService, useValue: session }],
    }).compileComponents();
    fixture = TestBed.createComponent(TubeConsoleComponent);
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }
  function navTestIds(): string[] {
    return Array.from(el().querySelectorAll('[data-testid^="tube-nav-"]')).map(
      (n) => n.getAttribute('data-testid')!,
    );
  }

  it('a NON-role user sees NOTHING (empty menubar)', () => {
    fixture.detectChanges();
    expect(navTestIds()).toEqual([]);
    expect(el().querySelector('[role="menubar"]')).withContext('no menubar when no items').toBeNull();
  });

  it('a granted ROLE_TUBE user sees ONLY My Tube (no Access/Budgets)', () => {
    session.canUse.set(true); // canManage stays false
    fixture.detectChanges();
    expect(navTestIds()).toEqual(['tube-nav-my']);
  });

  it('an ADMIN sees My Tube + Tube Access + Storage Budgets', () => {
    session.canUse.set(true);
    session.canManage.set(true);
    fixture.detectChanges();
    expect(navTestIds()).toEqual(['tube-nav-my', 'tube-nav-access', 'tube-nav-budgets']);
  });

  it('a SUPERADMIN sees all views', () => {
    session.canUse.set(true);
    session.canManage.set(true);
    fixture.detectChanges();
    expect(navTestIds()).toEqual(['tube-nav-my', 'tube-nav-access', 'tube-nav-budgets']);
  });

  it('renders the menubar with roving tabindex + arrow-key roving (a11y)', () => {
    session.canUse.set(true);
    session.canManage.set(true);
    fixture.detectChanges();
    const menubar = el().querySelector('[role="menubar"]')!;
    expect(menubar).not.toBeNull();
    const items = Array.from(el().querySelectorAll('[role="menuitem"]')) as HTMLElement[];
    // Exactly one item is tabbable (tabindex=0); the rest are -1.
    expect(items.map((i) => i.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);

    const component = fixture.componentInstance;
    component.onKey(new KeyboardEvent('keydown', { key: 'ArrowRight' }), 0);
    fixture.detectChanges();
    expect(component.active).toBe(1);
    component.onKey(new KeyboardEvent('keydown', { key: 'End' }), 1);
    expect(component.active).toBe(2);
    component.onKey(new KeyboardEvent('keydown', { key: 'Home' }), 2);
    expect(component.active).toBe(0);
  });

  it('every nav link carries an accessibleName + describedby help (a11y)', () => {
    session.canUse.set(true);
    session.canManage.set(true);
    fixture.detectChanges();
    const links = Array.from(el().querySelectorAll('[role="menuitem"]')) as HTMLElement[];
    for (const link of links) {
      expect(link.getAttribute('aria-label')).withContext('accessibleName').toBeTruthy();
      const describedby = link.getAttribute('aria-describedby');
      expect(describedby).toBeTruthy();
      expect(el().querySelector('#' + describedby)).withContext('help element exists').not.toBeNull();
    }
  });
  it('hosts the step-up dialog: absent until a gated call asks, shown while it is pending', () => {
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="tube-stepup"]')).toBeNull();
    void TestBed.inject(StepUpService).challenge('Banning a user');
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="tube-stepup"]')).not.toBeNull();
  });
});
