import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';

import { TubeForbiddenComponent } from './tube-forbidden.component';
import { SessionService } from './session.service';

describe('TubeForbiddenComponent', () => {
  const canUse = signal(false);

  async function setup(): Promise<ComponentFixture<TubeForbiddenComponent>> {
    await TestBed.configureTestingModule({
      imports: [TubeForbiddenComponent],
      providers: [provideRouter([]), { provide: SessionService, useValue: { canUse } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(TubeForbiddenComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('announces the denial in a role="alert" and explains the missing role', async () => {
    const fixture = await setup();
    const el = fixture.nativeElement as HTMLElement;
    const alert = el.querySelector('[role="alert"]')!;
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain('access');
  });

  it('offers a Back-to-My-Tube link only when the user can use Tube', async () => {
    canUse.set(false);
    let fixture = await setup();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="tube-forbidden-back"]')).toBeNull();

    TestBed.resetTestingModule();
    canUse.set(true);
    fixture = await setup();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="tube-forbidden-back"]')).not.toBeNull();
  });
});
