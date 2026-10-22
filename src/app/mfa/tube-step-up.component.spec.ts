import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TubeStepUpComponent } from './tube-step-up.component';
import { StepUpService } from './step-up.service';
import { MfaService } from './mfa.service';
import { MfaResult } from './mfa.types';

describe('TubeStepUpComponent (the inline MFA challenge)', () => {
  let fixture: ComponentFixture<TubeStepUpComponent>;
  let stepUp: StepUpService;
  let mfa: jasmine.SpyObj<MfaService>;

  beforeEach(async () => {
    mfa = jasmine.createSpyObj<MfaService>('MfaService', ['challenge', 'assertWebauthnOptions']);
    await TestBed.configureTestingModule({
      imports: [TubeStepUpComponent],
      providers: [{ provide: MfaService, useValue: mfa }],
    }).compileComponents();
    stepUp = TestBed.inject(StepUpService);
    fixture = TestBed.createComponent(TubeStepUpComponent);
    fixture.detectChanges();
  });

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = (id: string): HTMLElement | null => el().querySelector(`[data-testid="${id}"]`);
  const ok = (): MfaResult<{ mfaSatisfied: boolean }> => ({ ok: true, dark: false, status: 200, data: { mfaSatisfied: true } });

  function open(action = 'Banning a user'): Promise<boolean> {
    const p = stepUp.challenge(action);
    fixture.detectChanges();
    return p;
  }

  it('renders nothing while no step-up is pending', () => {
    expect(q('tube-stepup')).toBeNull();
  });

  it('opens when a gated call asks, naming the action', () => {
    void open('Banning a user');
    expect(q('tube-stepup')).not.toBeNull();
    expect(q('tube-stepup-intro')!.textContent).toContain('Banning a user');
  });

  it('the Verify button is disabled until the TOTP code is 6 digits', () => {
    void open();
    const submit = q('tube-stepup-submit') as HTMLButtonElement;
    expect(submit.disabled).toBeTrue();
    fixture.componentInstance.code = '12345';
    expect(fixture.componentInstance.codeValid()).toBeFalse();
    fixture.componentInstance.code = '123456';
    expect(fixture.componentInstance.codeValid()).toBeTrue();
  });

  it('a satisfied TOTP challenge posts the code and settles the pending call TRUE', async () => {
    mfa.challenge.and.resolveTo(ok());
    const p = open();
    fixture.componentInstance.code = ' 123456 ';
    await fixture.componentInstance.submitCode();
    expect(mfa.challenge).toHaveBeenCalledOnceWith('totp', '123456');
    expect(await p).toBeTrue();
    fixture.detectChanges();
    expect(q('tube-stepup')).toBeNull();
  });

  it('a recovery code is sent as the recovery factor', async () => {
    mfa.challenge.and.resolveTo(ok());
    const p = open();
    fixture.componentInstance.setMethod('recovery');
    fixture.componentInstance.code = 'AAAA-BBBB-CCCC-DDDD';
    await fixture.componentInstance.submitCode();
    expect(mfa.challenge).toHaveBeenCalledOnceWith('recovery', 'AAAA-BBBB-CCCC-DDDD');
    expect(await p).toBeTrue();
  });

  it('a wrong code shows an alert, stays open and does NOT settle the call', async () => {
    mfa.challenge.and.resolveTo({ ok: false, dark: false, status: 401, error: 'bad' });
    let settled = false;
    void open().then(() => (settled = true));
    fixture.componentInstance.code = '000000';
    await fixture.componentInstance.submitCode();
    fixture.detectChanges();
    expect(q('tube-stepup-error')!.getAttribute('role')).toBe('alert');
    expect(q('tube-stepup')).not.toBeNull();
    await Promise.resolve();
    expect(settled).toBeFalse();
  });

  it('an ok reply that does not say mfaSatisfied is NOT treated as satisfied', async () => {
    mfa.challenge.and.resolveTo({ ok: true, dark: false, status: 200, data: { mfaSatisfied: false } });
    let settled = false;
    void open().then(() => (settled = true));
    fixture.componentInstance.code = '123456';
    await fixture.componentInstance.submitCode();
    await Promise.resolve();
    expect(settled).toBeFalse();
    expect(fixture.componentInstance.error()).toContain('did not verify');
  });

  it('MFA shipping dark (503) shows the terminal not-enabled state; Close settles FALSE', async () => {
    mfa.challenge.and.resolveTo({ ok: false, dark: true, status: 503 });
    const p = open();
    fixture.componentInstance.code = '123456';
    await fixture.componentInstance.submitCode();
    fixture.detectChanges();
    expect(q('tube-stepup-dark')).not.toBeNull();
    expect(q('tube-stepup-code')).toBeNull();
    (q('tube-stepup-close') as HTMLButtonElement).click();
    expect(await p).toBeFalse();
  });

  it('Cancel settles FALSE and closes, and the next prompt starts clean', async () => {
    const p = open();
    fixture.componentInstance.code = '12';
    (q('tube-stepup-cancel') as HTMLButtonElement).click();
    expect(await p).toBeFalse();
    fixture.detectChanges();
    expect(q('tube-stepup')).toBeNull();
    void open();
    expect(fixture.componentInstance.code).toBe('');
    expect(fixture.componentInstance.dark()).toBeFalse();
  });

  it('each method input has a visible label and described-by help (a11y)', () => {
    void open();
    const input = q('tube-stepup-code') as HTMLInputElement;
    expect(el().querySelector(`label[for="${input.id}"]`)).not.toBeNull();
    expect(el().querySelector(`#${input.getAttribute('aria-describedby')}`)).not.toBeNull();
    expect(el().querySelector('fieldset legend')).not.toBeNull();
  });
});
